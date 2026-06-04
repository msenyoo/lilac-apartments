-- 007: Rewrite v_dues_tracker to use maintenance_rate_history
-- Rate changes now affect due calculations (forward-only from effective_from date)

CREATE OR REPLACE VIEW public.v_dues_tracker AS
WITH settings AS (
  SELECT
    (SELECT value::integer FROM public.app_settings WHERE key = 'dues_start_fiscal_year') AS start_fy
),
tracking AS (
  SELECT
    s.start_fy,
    MAKE_DATE(s.start_fy, 4, 1)                                             AS track_start,
    -- Exclusive end: first day of NEXT month so current month is included
    DATE_TRUNC('month', CURRENT_DATE + INTERVAL '1 month')::date            AS track_end_excl
  FROM settings s
),
-- For each flat × rate period, clip to tracking window
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
  -- Only include periods that overlap the tracking window
  WHERE DATE_TRUNC('month', mrh.effective_from)::date < t.track_end_excl
    AND DATE_TRUNC('month', COALESCE(mrh.effective_to, CURRENT_DATE) + INTERVAL '1 month')::date > t.track_start
),
-- Sum expected dues per flat across all overlapping rate periods
flat_dues AS (
  SELECT
    frp.flat_id,
    SUM(
      frp.monthly_rate * GREATEST(0,
        (
          EXTRACT(YEAR  FROM AGE(frp.period_end_excl, frp.period_start))::integer * 12 +
          EXTRACT(MONTH FROM AGE(frp.period_end_excl, frp.period_start))::integer
        )
      )
    )::integer                                                               AS annual_due
  FROM flat_rate_periods frp
  GROUP BY frp.flat_id
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
LEFT JOIN flat_dues fd          ON fd.flat_id = f.id
LEFT JOIN public.transactions t ON t.flat_code = f.code
GROUP BY
  f.id, f.code, f.block, f.flat_type, f.bhk_type, f.maintenance_amt,
  tr.start_fy, fd.annual_due
ORDER BY f.code;
