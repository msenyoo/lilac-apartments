-- 003: Dues carry-forward — configurable start FY

-- 1. Add dues_start_fiscal_year to app_settings (default Apr-25 = FY 2025)
INSERT INTO public.app_settings (key, value)
VALUES ('dues_start_fiscal_year', '2025')
ON CONFLICT (key) DO NOTHING;

-- 2. Rewrite v_dues_tracker: current FY auto-computed from date; start FY from app_settings
CREATE OR REPLACE VIEW public.v_dues_tracker AS
WITH settings AS (
  SELECT
    -- Current FY: Apr onwards = this year, Jan-Mar = previous year
    CASE WHEN EXTRACT(MONTH FROM CURRENT_DATE) >= 4
      THEN EXTRACT(YEAR FROM CURRENT_DATE)::integer
      ELSE EXTRACT(YEAR FROM CURRENT_DATE)::integer - 1
    END AS current_fy,
    (SELECT value::integer FROM public.app_settings WHERE key = 'dues_start_fiscal_year') AS start_fy
)
SELECT
  f.code                                             AS flat_code,
  f.block,
  f.flat_type,
  f.bhk_type,
  f.maintenance_amt,
  s.current_fy                                       AS fiscal_year,
  s.start_fy                                         AS start_fiscal_year,
  -- Total due spans all FYs from start_fy to current_fy (inclusive)
  f.maintenance_amt * 12 * (s.current_fy - s.start_fy + 1) AS annual_due,
  -- Collected = all maintenance CRs from start_fy onwards
  COALESCE(SUM(t.amount) FILTER (
    WHERE t.fiscal_year >= s.start_fy
      AND t.cr_dr = 'CR'
      AND t.category = 'Maintenance'
      AND t.row_type != 'VOIDED'
  ), 0)                                              AS collected_fy,
  -- Pending = total due minus total collected
  f.maintenance_amt * 12 * (s.current_fy - s.start_fy + 1)
    - COALESCE(SUM(t.amount) FILTER (
        WHERE t.fiscal_year >= s.start_fy
          AND t.cr_dr = 'CR'
          AND t.category = 'Maintenance'
          AND t.row_type != 'VOIDED'
      ), 0)                                          AS pending,
  CASE
    WHEN COALESCE(SUM(t.amount) FILTER (
      WHERE t.fiscal_year >= s.start_fy AND t.cr_dr = 'CR'
        AND t.category = 'Maintenance' AND t.row_type != 'VOIDED'
    ), 0) >= f.maintenance_amt * 12 * (s.current_fy - s.start_fy + 1) THEN 'Clear'
    WHEN COALESCE(SUM(t.amount) FILTER (
      WHERE t.fiscal_year >= s.start_fy AND t.cr_dr = 'CR'
        AND t.category = 'Maintenance' AND t.row_type != 'VOIDED'
    ), 0) > 0 THEN 'Partial'
    ELSE 'Due'
  END                                                AS status
FROM public.flats f
CROSS JOIN settings s
LEFT JOIN public.transactions t ON t.flat_code = f.code
GROUP BY f.code, f.block, f.flat_type, f.bhk_type, f.maintenance_amt, s.current_fy, s.start_fy
ORDER BY f.code;
