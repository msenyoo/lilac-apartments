-- 037: Apply collections to arrears first (oldest debt first)
--   Previously every maintenance payment counted toward the current tracking
--   period, so arrears stayed frozen even after the flat paid them off and the
--   residue showed under an old FY label instead of the current month.
--   Net total_outstanding is unchanged; only the attribution moves.
--   advance_fiscal_year now materializes the settlements (reduce/delete
--   arrears rows) before snapshotting, since the collection window resets.

-- 1. v_dues_tracker — collections settle arrears before current dues
DROP VIEW IF EXISTS public.v_dues_tracker;
CREATE VIEW public.v_dues_tracker
  WITH (security_invoker = true)
AS
WITH settings AS (
  SELECT
    (SELECT value::integer FROM public.app_settings WHERE key = 'dues_start_fiscal_year') AS start_fy
),
tracking AS (
  SELECT
    s.start_fy,
    MAKE_DATE(s.start_fy, 4, 1)                                             AS track_start,
    DATE_TRUNC('month', CURRENT_DATE + INTERVAL '1 month')::date            AS track_end_excl
  FROM settings s
),
flat_rate_periods AS (
  SELECT
    mrh.flat_id,
    mrh.monthly_rate,
    GREATEST(
      DATE_TRUNC('month', mrh.effective_from)::date,
      t.track_start
    )                                                                        AS period_start,
    LEAST(
      DATE_TRUNC('month', COALESCE(mrh.effective_to, CURRENT_DATE) + INTERVAL '1 month')::date,
      t.track_end_excl
    )                                                                        AS period_end_excl
  FROM public.maintenance_rate_history mrh
  CROSS JOIN tracking t
  WHERE DATE_TRUNC('month', mrh.effective_from)::date < t.track_end_excl
    AND DATE_TRUNC('month', COALESCE(mrh.effective_to, CURRENT_DATE) + INTERVAL '1 month')::date > t.track_start
),
flat_dues AS (
  SELECT
    frp.flat_id,
    SUM(
      frp.monthly_rate * GREATEST(0,
        EXTRACT(YEAR  FROM AGE(frp.period_end_excl, frp.period_start))::integer * 12 +
        EXTRACT(MONTH FROM AGE(frp.period_end_excl, frp.period_start))::integer
      )
    )::integer AS annual_due
  FROM flat_rate_periods frp
  GROUP BY frp.flat_id
),
flat_arrears_agg AS (
  SELECT flat_id, COALESCE(SUM(amount), 0)::integer AS arrears_original
  FROM public.flat_arrears
  WHERE arrears_type = 'maintenance'
  GROUP BY flat_id
),
flat_credits_agg AS (
  SELECT flat_id, COALESCE(SUM(amount), 0)::integer AS advance_credits
  FROM public.flat_arrears
  WHERE arrears_type = 'credit'
  GROUP BY flat_id
),
base AS (
  SELECT
    f.code, f.block, f.flat_type, f.bhk_type, f.maintenance_amt,
    tr.start_fy,
    COALESCE(fd.annual_due, 0)                                               AS annual_due,
    COALESCE(SUM(t.amount) FILTER (
      WHERE t.fiscal_year >= tr.start_fy
        AND t.cr_dr      = 'CR'
        AND t.category   = 'Maintenance'
        AND t.row_type  != 'VOIDED'
    ), 0)::integer                                                           AS collected_raw,
    COALESCE(faa.arrears_original, 0)                                        AS arrears_original,
    COALESCE(fca.advance_credits, 0)                                         AS advance_credits
  FROM public.flats f
  CROSS JOIN tracking tr
  LEFT JOIN flat_dues fd           ON fd.flat_id = f.id
  LEFT JOIN flat_arrears_agg faa   ON faa.flat_id = f.id
  LEFT JOIN flat_credits_agg fca   ON fca.flat_id = f.id
  LEFT JOIN public.transactions t  ON t.flat_code = f.code
  GROUP BY
    f.id, f.code, f.block, f.flat_type, f.bhk_type, f.maintenance_amt,
    tr.start_fy, fd.annual_due, faa.arrears_original, fca.advance_credits
)
SELECT
  b.code                                                                     AS flat_code,
  b.block,
  b.flat_type,
  b.bhk_type,
  b.maintenance_amt,
  CASE WHEN EXTRACT(MONTH FROM CURRENT_DATE) >= 4
    THEN EXTRACT(YEAR FROM CURRENT_DATE)::integer
    ELSE EXTRACT(YEAR FROM CURRENT_DATE)::integer - 1
  END                                                                        AS fiscal_year,
  b.start_fy                                                                 AS start_fiscal_year,
  b.annual_due,
  b.collected_raw - LEAST(b.arrears_original, b.collected_raw)               AS collected_fy,
  b.annual_due - (b.collected_raw - LEAST(b.arrears_original, b.collected_raw)) AS pending,
  b.arrears_original - LEAST(b.arrears_original, b.collected_raw)            AS arrears_maintenance,
  b.arrears_original,
  LEAST(b.arrears_original, b.collected_raw)                                 AS arrears_paid,
  b.advance_credits,
  b.annual_due + b.arrears_original - b.collected_raw - b.advance_credits    AS total_outstanding,
  CASE
    WHEN b.collected_raw - LEAST(b.arrears_original, b.collected_raw) >= b.annual_due THEN 'Clear'
    WHEN b.collected_raw > 0 THEN 'Partial'
    ELSE 'Due'
  END                                                                        AS status
FROM base b
ORDER BY b.code;

-- 2. advance_fiscal_year — settle arrears rows, then carry forward remainder
CREATE OR REPLACE FUNCTION public.advance_fiscal_year()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  old_fy    integer;
  new_fy    integer;
  n         integer;
  rec       record;
  arow      record;
  remaining integer;
BEGIN
  IF public.get_my_role() <> 'admin' THEN
    RAISE EXCEPTION 'permission denied: admin only';
  END IF;

  SELECT value::integer INTO old_fy
    FROM app_settings WHERE key = 'dues_start_fiscal_year';

  IF old_fy IS NULL THEN
    RAISE EXCEPTION 'app_settings key dues_start_fiscal_year is missing';
  END IF;

  new_fy := old_fy + 1;

  -- Snapshot first: the view recomputes as arrears rows are mutated below
  CREATE TEMP TABLE _fy_snap ON COMMIT DROP AS
  SELECT f.id AS flat_id, vdt.pending, vdt.arrears_paid
  FROM v_dues_tracker vdt
  JOIN flats f ON f.code = vdt.flat_code;

  -- Materialize settlements: collections already applied to arrears
  -- reduce/delete the stored rows, oldest first
  FOR rec IN SELECT flat_id, arrears_paid FROM _fy_snap WHERE arrears_paid > 0 LOOP
    remaining := rec.arrears_paid;
    FOR arow IN SELECT id, amount FROM flat_arrears
                WHERE flat_id = rec.flat_id AND arrears_type = 'maintenance'
                ORDER BY created_at, id LOOP
      EXIT WHEN remaining <= 0;
      IF arow.amount <= remaining THEN
        DELETE FROM flat_arrears WHERE id = arow.id;
        remaining := remaining - arow.amount;
      ELSE
        UPDATE flat_arrears SET amount = amount - remaining WHERE id = arow.id;
        remaining := 0;
      END IF;
    END LOOP;
  END LOOP;

  -- Carry the closing window's unpaid dues forward
  INSERT INTO flat_arrears (flat_id, arrears_type, source_label, amount, created_by)
  SELECT
    flat_id,
    'maintenance',
    'FY ' || old_fy || '-' || RIGHT((old_fy + 1)::text, 2),
    pending,
    auth.uid()
  FROM _fy_snap
  WHERE pending > 0
  ON CONFLICT (flat_id, arrears_type, source_label) DO NOTHING;

  GET DIAGNOSTICS n = ROW_COUNT;

  UPDATE app_settings SET value = new_fy::text
    WHERE key = 'dues_start_fiscal_year';

  DROP TABLE _fy_snap;

  RETURN json_build_object('new_fy', new_fy, 'arrears_created', n);
END;
$$;
