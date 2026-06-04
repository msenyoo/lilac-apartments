-- 004: Corpus plan scoping — fix v_corpus_tracker to be plan-aware

-- 1. Add fiscal year range to corpus_plans
ALTER TABLE public.corpus_plans
  ADD COLUMN IF NOT EXISTS start_fiscal_year integer,
  ADD COLUMN IF NOT EXISTS end_fiscal_year   integer;

-- Set range for existing Corpus 2025 plan (Apr-25 to Mar-27 = FY 2025 + FY 2026)
UPDATE public.corpus_plans
SET start_fiscal_year = 2025,
    end_fiscal_year   = 2026
WHERE name = 'Corpus 2025';

-- 2. Rewrite v_corpus_tracker — uses active plan's per-flat targets,
--    scopes collected to the plan's fiscal year range
CREATE OR REPLACE VIEW public.v_corpus_tracker AS
SELECT
  f.code                                                  AS flat_code,
  f.block,
  f.flat_type,
  cpf.target_amount                                       AS corpus_target,
  cpf.pre_payment,
  cp.name                                                 AS plan_name,
  cp.start_fiscal_year,
  cp.end_fiscal_year,
  -- collected = pre_payment (collected before plan started, not a transaction) +
  --            corpus CRs within the plan period
  cpf.pre_payment + COALESCE(SUM(t.amount) FILTER (
    WHERE t.corpus = 'YES' AND t.cr_dr = 'CR'
      AND t.row_type != 'VOIDED'
      AND t.fiscal_year BETWEEN cp.start_fiscal_year AND cp.end_fiscal_year
  ), 0)                                                   AS collected,
  cpf.target_amount - cpf.pre_payment - COALESCE(SUM(t.amount) FILTER (
    WHERE t.corpus = 'YES' AND t.cr_dr = 'CR'
      AND t.row_type != 'VOIDED'
      AND t.fiscal_year BETWEEN cp.start_fiscal_year AND cp.end_fiscal_year
  ), 0)                                                   AS balance,
  ROUND((cpf.pre_payment + COALESCE(SUM(t.amount) FILTER (
    WHERE t.corpus = 'YES' AND t.cr_dr = 'CR'
      AND t.row_type != 'VOIDED'
      AND t.fiscal_year BETWEEN cp.start_fiscal_year AND cp.end_fiscal_year
  ), 0)) * 100.0 / NULLIF(cpf.target_amount, 0), 1)      AS pct_paid,
  MAX(t.value_date) FILTER (
    WHERE t.corpus = 'YES' AND t.cr_dr = 'CR'
      AND t.row_type != 'VOIDED'
      AND t.fiscal_year BETWEEN cp.start_fiscal_year AND cp.end_fiscal_year
  )                                                       AS last_payment_date,
  CASE
    WHEN cpf.pre_payment + COALESCE(SUM(t.amount) FILTER (
      WHERE t.corpus = 'YES' AND t.cr_dr = 'CR'
        AND t.row_type != 'VOIDED'
        AND t.fiscal_year BETWEEN cp.start_fiscal_year AND cp.end_fiscal_year
    ), 0) >= cpf.target_amount THEN 'Done'
    WHEN cpf.pre_payment + COALESCE(SUM(t.amount) FILTER (
      WHERE t.corpus = 'YES' AND t.cr_dr = 'CR'
        AND t.row_type != 'VOIDED'
        AND t.fiscal_year BETWEEN cp.start_fiscal_year AND cp.end_fiscal_year
    ), 0) > 0 THEN 'Partial'
    ELSE 'Pending'
  END                                                     AS status
FROM public.corpus_plans cp
JOIN public.corpus_plan_flats cpf ON cpf.plan_id = cp.id
JOIN public.flats f               ON f.id = cpf.flat_id
LEFT JOIN public.transactions t   ON t.flat_code = f.code
WHERE cp.status = 'active'
GROUP BY
  f.code, f.block, f.flat_type,
  cpf.target_amount, cpf.pre_payment,
  cp.name, cp.start_fiscal_year, cp.end_fiscal_year
ORDER BY f.code;
