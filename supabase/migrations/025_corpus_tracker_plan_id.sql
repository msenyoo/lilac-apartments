-- Migration 025: Update v_corpus_tracker to respect plan_id on transactions
-- When t.plan_id IS NOT NULL, attribute to that plan only.
-- When t.plan_id IS NULL, fall back to FY-range scoping (existing behaviour).
-- This prevents double-counting when two active corpus plans share overlapping FY ranges.

CREATE OR REPLACE VIEW public.v_corpus_tracker
WITH (security_invoker = true)
AS
SELECT
  f.code                         AS flat_code,
  f.block,
  f.flat_type,
  cp.id                          AS plan_id,
  cp.name                        AS plan_name,
  cp.status                      AS plan_status,
  cp.start_fiscal_year,
  cp.end_fiscal_year,
  cpf.target_amount              AS corpus_target,
  cpf.pre_payment,
  cpf.carry_forward_amount,
  cpf.target_amount + cpf.carry_forward_amount AS effective_target,

  -- collected
  cpf.pre_payment::numeric
    + COALESCE(
        SUM(t.amount) FILTER (
          WHERE t.corpus = 'YES'
            AND t.cr_dr = 'CR'
            AND t.row_type <> 'VOIDED'
            AND (
              (t.plan_id = cp.id)
              OR (t.plan_id IS NULL
                  AND t.fiscal_year >= cp.start_fiscal_year
                  AND t.fiscal_year <= cp.end_fiscal_year)
            )
        ),
        0::numeric
      )                          AS collected,

  -- balance
  (cpf.target_amount + cpf.carry_forward_amount - cpf.pre_payment)::numeric
    - COALESCE(
        SUM(t.amount) FILTER (
          WHERE t.corpus = 'YES'
            AND t.cr_dr = 'CR'
            AND t.row_type <> 'VOIDED'
            AND (
              (t.plan_id = cp.id)
              OR (t.plan_id IS NULL
                  AND t.fiscal_year >= cp.start_fiscal_year
                  AND t.fiscal_year <= cp.end_fiscal_year)
            )
        ),
        0::numeric
      )                          AS balance,

  -- pct_paid
  ROUND(
    (
      cpf.pre_payment::numeric
      + COALESCE(
          SUM(t.amount) FILTER (
            WHERE t.corpus = 'YES'
              AND t.cr_dr = 'CR'
              AND t.row_type <> 'VOIDED'
              AND (
                (t.plan_id = cp.id)
                OR (t.plan_id IS NULL
                    AND t.fiscal_year >= cp.start_fiscal_year
                    AND t.fiscal_year <= cp.end_fiscal_year)
              )
          ),
          0::numeric
        )
    ) * 100.0
    / NULLIF(cpf.target_amount + cpf.carry_forward_amount, 0)::numeric,
    1
  )                              AS pct_paid,

  -- last_payment_date
  MAX(t.value_date) FILTER (
    WHERE t.corpus = 'YES'
      AND t.cr_dr = 'CR'
      AND t.row_type <> 'VOIDED'
      AND (
        (t.plan_id = cp.id)
        OR (t.plan_id IS NULL
            AND t.fiscal_year >= cp.start_fiscal_year
            AND t.fiscal_year <= cp.end_fiscal_year)
      )
  )                              AS last_payment_date,

  -- status
  CASE
    WHEN (
      cpf.pre_payment::numeric
      + COALESCE(
          SUM(t.amount) FILTER (
            WHERE t.corpus = 'YES'
              AND t.cr_dr = 'CR'
              AND t.row_type <> 'VOIDED'
              AND (
                (t.plan_id = cp.id)
                OR (t.plan_id IS NULL
                    AND t.fiscal_year >= cp.start_fiscal_year
                    AND t.fiscal_year <= cp.end_fiscal_year)
              )
          ),
          0::numeric
        )
    ) >= (cpf.target_amount + cpf.carry_forward_amount)::numeric
      THEN 'Done'
    WHEN (
      cpf.pre_payment::numeric
      + COALESCE(
          SUM(t.amount) FILTER (
            WHERE t.corpus = 'YES'
              AND t.cr_dr = 'CR'
              AND t.row_type <> 'VOIDED'
              AND (
                (t.plan_id = cp.id)
                OR (t.plan_id IS NULL
                    AND t.fiscal_year >= cp.start_fiscal_year
                    AND t.fiscal_year <= cp.end_fiscal_year)
              )
          ),
          0::numeric
        )
    ) > 0::numeric
      THEN 'Partial'
    ELSE 'Pending'
  END                            AS status

FROM corpus_plans cp
JOIN corpus_plan_flats cpf ON cpf.plan_id = cp.id
JOIN flats f               ON f.id = cpf.flat_id
LEFT JOIN transactions t   ON t.flat_code = f.code
WHERE cp.status = ANY (ARRAY['active'::text, 'draft'::text])
GROUP BY
  f.code, f.block, f.flat_type,
  cp.id, cp.name, cp.status, cp.start_fiscal_year, cp.end_fiscal_year,
  cpf.target_amount, cpf.pre_payment, cpf.carry_forward_amount
ORDER BY cp.name, f.code;
