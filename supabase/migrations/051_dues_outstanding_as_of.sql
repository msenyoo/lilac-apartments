-- 051: Point-in-time dues outstanding, mirroring fn_bank_balance_as_of's pattern.
--
-- v_dues_tracker is always "as of today" (CURRENT_DATE decides both the accrual window's
-- end and the fiscal_year label). The Cash Book's monthly PDF needs "outstanding as of
-- that month" instead, so a report generated later for a past month doesn't silently pick
-- up dues/collections that happened after that month closed.
--
-- Caveat (documented on the function): flat_arrears (both 'maintenance' carry-forward and
-- 'credit' rows) is a manually-managed ledger with no audit trail — advance_fiscal_year()
-- mutates/deletes rows in place at FY close, and admins can add/edit/delete rows freely via
-- the Dues page. There is no way to reconstruct what a row's amount was on an arbitrary past
-- date. This function includes a row whenever created_at <= p_date, which is exactly correct
-- for any p_date up to today as long as no FY-close (advance_fiscal_year()) has happened yet
-- (true today — dues_start_fiscal_year is still its original 2025 seed) — once one does,
-- reports for months before that closure, if regenerated afterward, would reflect the
-- post-closure state rather than the true historical figure. Same limitation v_dues_tracker
-- already has for "today"; this just makes it explicit for arbitrary past dates too.

CREATE OR REPLACE FUNCTION public.fn_dues_outstanding_as_of(p_date date)
RETURNS TABLE (
  flat_code text,
  block text,
  fiscal_year integer,
  start_fiscal_year integer,
  annual_due integer,
  collected_fy integer,
  pending integer,
  arrears_maintenance integer,
  advance_credits integer,
  total_outstanding integer,
  status text
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  WITH settings AS (
    SELECT (SELECT value::integer FROM app_settings WHERE key = 'dues_start_fiscal_year') AS start_fy
  ),
  tracking AS (
    SELECT
      s.start_fy,
      MAKE_DATE(s.start_fy, 4, 1)                              AS track_start,
      DATE_TRUNC('month', p_date + INTERVAL '1 month')::date   AS track_end_excl
    FROM settings s
  ),
  flat_rate_periods AS (
    SELECT
      mrh.flat_id,
      mrh.monthly_rate,
      GREATEST(
        DATE_TRUNC('month', mrh.effective_from)::date,
        t.track_start
      )                                                          AS period_start,
      LEAST(
        DATE_TRUNC('month', COALESCE(mrh.effective_to, p_date) + INTERVAL '1 month')::date,
        t.track_end_excl
      )                                                          AS period_end_excl
    FROM public.maintenance_rate_history mrh
    CROSS JOIN tracking t
    WHERE DATE_TRUNC('month', mrh.effective_from)::date < t.track_end_excl
      AND DATE_TRUNC('month', COALESCE(mrh.effective_to, p_date) + INTERVAL '1 month')::date > t.track_start
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
    WHERE arrears_type = 'maintenance' AND created_at::date <= p_date
    GROUP BY flat_id
  ),
  flat_credits_agg AS (
    SELECT flat_id, COALESCE(SUM(amount), 0)::integer AS advance_credits
    FROM public.flat_arrears
    WHERE arrears_type = 'credit' AND created_at::date <= p_date
    GROUP BY flat_id
  ),
  base AS (
    SELECT
      f.code, f.block,
      tr.start_fy,
      COALESCE(fd.annual_due, 0)                                               AS annual_due,
      COALESCE(SUM(t.amount) FILTER (
        WHERE t.fiscal_year >= tr.start_fy
          AND t.cr_dr      = 'CR'
          AND t.category   = 'Maintenance'
          AND t.row_type  != 'VOIDED'
          AND t.value_date <= p_date
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
      f.id, f.code, f.block,
      tr.start_fy, fd.annual_due, faa.arrears_original, fca.advance_credits
  )
  SELECT
    b.code AS flat_code,
    b.block,
    CASE WHEN EXTRACT(MONTH FROM p_date) >= 4
      THEN EXTRACT(YEAR FROM p_date)::integer
      ELSE EXTRACT(YEAR FROM p_date)::integer - 1
    END                                                                        AS fiscal_year,
    b.start_fy                                                                 AS start_fiscal_year,
    b.annual_due,
    b.collected_raw - LEAST(b.arrears_original, b.collected_raw)               AS collected_fy,
    b.annual_due - (b.collected_raw - LEAST(b.arrears_original, b.collected_raw)) AS pending,
    b.arrears_original - LEAST(b.arrears_original, b.collected_raw)            AS arrears_maintenance,
    b.advance_credits,
    b.annual_due + b.arrears_original - b.collected_raw - b.advance_credits    AS total_outstanding,
    CASE
      WHEN b.collected_raw - LEAST(b.arrears_original, b.collected_raw) >= b.annual_due THEN 'Clear'
      WHEN b.collected_raw > 0 THEN 'Partial'
      ELSE 'Due'
    END                                                                        AS status
  FROM base b
  ORDER BY b.code;
$$;

GRANT EXECUTE ON FUNCTION public.fn_dues_outstanding_as_of(date) TO authenticated;
COMMENT ON FUNCTION public.fn_dues_outstanding_as_of(date) IS
  'Point-in-time equivalent of v_dues_tracker, dated by p_date instead of CURRENT_DATE. See migration 051 for the flat_arrears audit-trail caveat.';
