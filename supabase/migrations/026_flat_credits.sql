-- 026: Allow 'credit' arrears type (advance payments carried across FY)
-- Credits reduce total_outstanding; stored as positive amounts with arrears_type = 'credit'.

ALTER TABLE public.flat_arrears DROP CONSTRAINT flat_arrears_arrears_type_check;
ALTER TABLE public.flat_arrears ADD CONSTRAINT flat_arrears_arrears_type_check
  CHECK (arrears_type IN ('maintenance', 'corpus', 'credit'));

-- Rebuild v_dues_tracker to expose advance_credits and subtract from total_outstanding
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
  SELECT flat_id, COALESCE(SUM(amount), 0)::integer AS arrears_maintenance
  FROM public.flat_arrears
  WHERE arrears_type = 'maintenance'
  GROUP BY flat_id
),
flat_credits_agg AS (
  SELECT flat_id, COALESCE(SUM(amount), 0)::integer AS advance_credits
  FROM public.flat_arrears
  WHERE arrears_type = 'credit'
  GROUP BY flat_id
)
SELECT
  f.code                                                                     AS flat_code,
  f.block,
  f.flat_type,
  f.bhk_type,
  f.maintenance_amt,
  CASE WHEN EXTRACT(MONTH FROM CURRENT_DATE) >= 4
    THEN EXTRACT(YEAR FROM CURRENT_DATE)::integer
    ELSE EXTRACT(YEAR FROM CURRENT_DATE)::integer - 1
  END                                                                        AS fiscal_year,
  tr.start_fy                                                                AS start_fiscal_year,
  COALESCE(fd.annual_due, 0)                                                 AS annual_due,
  COALESCE(SUM(t.amount) FILTER (
    WHERE t.fiscal_year >= tr.start_fy
      AND t.cr_dr      = 'CR'
      AND t.category   = 'Maintenance'
      AND t.row_type  != 'VOIDED'
  ), 0)::integer                                                             AS collected_fy,
  COALESCE(fd.annual_due, 0) - COALESCE(SUM(t.amount) FILTER (
    WHERE t.fiscal_year >= tr.start_fy
      AND t.cr_dr      = 'CR'
      AND t.category   = 'Maintenance'
      AND t.row_type  != 'VOIDED'
  ), 0)                                                                      AS pending,
  COALESCE(faa.arrears_maintenance, 0)                                       AS arrears_maintenance,
  COALESCE(fca.advance_credits, 0)                                           AS advance_credits,
  COALESCE(fd.annual_due, 0) - COALESCE(SUM(t.amount) FILTER (
    WHERE t.fiscal_year >= tr.start_fy
      AND t.cr_dr      = 'CR'
      AND t.category   = 'Maintenance'
      AND t.row_type  != 'VOIDED'
  ), 0) + COALESCE(faa.arrears_maintenance, 0)
       - COALESCE(fca.advance_credits, 0)                                   AS total_outstanding,
  CASE
    WHEN COALESCE(SUM(t.amount) FILTER (
      WHERE t.fiscal_year >= tr.start_fy AND t.cr_dr = 'CR'
        AND t.category = 'Maintenance'   AND t.row_type != 'VOIDED'
    ), 0) >= COALESCE(fd.annual_due, 0) THEN 'Clear'
    WHEN COALESCE(SUM(t.amount) FILTER (
      WHERE t.fiscal_year >= tr.start_fy AND t.cr_dr = 'CR'
        AND t.category = 'Maintenance'   AND t.row_type != 'VOIDED'
    ), 0) > 0 THEN 'Partial'
    ELSE 'Due'
  END                                                                        AS status
FROM public.flats f
CROSS JOIN tracking tr
LEFT JOIN flat_dues fd           ON fd.flat_id = f.id
LEFT JOIN flat_arrears_agg faa   ON faa.flat_id = f.id
LEFT JOIN flat_credits_agg fca   ON fca.flat_id = f.id
LEFT JOIN public.transactions t  ON t.flat_code = f.code
GROUP BY
  f.id, f.code, f.block, f.flat_type, f.bhk_type, f.maintenance_amt,
  tr.start_fy, fd.annual_due, faa.arrears_maintenance, fca.advance_credits
ORDER BY f.code;
