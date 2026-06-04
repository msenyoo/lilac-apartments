-- 005: Corpus plan lifecycle — multi-plan support, flexible installments, carry-forward

-- 1. Extend corpus_plans: add draft status, close tracking
ALTER TABLE public.corpus_plans
  ADD COLUMN IF NOT EXISTS closed_at    timestamptz,
  ADD COLUMN IF NOT EXISTS close_notes  text;

ALTER TABLE public.corpus_plans DROP CONSTRAINT IF EXISTS corpus_plans_status_check;
ALTER TABLE public.corpus_plans
  ADD CONSTRAINT corpus_plans_status_check
  CHECK (status IN ('draft', 'active', 'completed', 'cancelled'));

-- 2. Add carry-forward columns to corpus_plan_flats
ALTER TABLE public.corpus_plan_flats
  ADD COLUMN IF NOT EXISTS carry_forward_amount  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS carry_forward_plan_id uuid REFERENCES public.corpus_plans(id);

-- 3. Flexible installment schedule (replaces 3 fixed installment columns)
CREATE TABLE IF NOT EXISTS public.corpus_plan_installments (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id         uuid NOT NULL REFERENCES public.corpus_plans(id) ON DELETE CASCADE,
  installment_no  integer NOT NULL,
  label           text NOT NULL,
  due_date        date,
  default_amount  integer NOT NULL DEFAULT 0,
  UNIQUE(plan_id, installment_no)
);

CREATE TABLE IF NOT EXISTS public.corpus_plan_flat_installments (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id         uuid NOT NULL REFERENCES public.corpus_plans(id) ON DELETE CASCADE,
  flat_id         uuid NOT NULL REFERENCES public.flats(id) ON DELETE CASCADE,
  installment_no  integer NOT NULL,
  amount          integer NOT NULL,
  UNIQUE(plan_id, flat_id, installment_no)
);

-- 4. Migrate Corpus 2025 installment_1/2/3 columns → new tables
INSERT INTO public.corpus_plan_installments (plan_id, installment_no, label, default_amount)
SELECT cp.id, inst.no, 'Installment ' || inst.no, 0
FROM public.corpus_plans cp
CROSS JOIN (VALUES (1), (2), (3)) AS inst(no)
WHERE cp.name = 'Corpus 2025'
ON CONFLICT DO NOTHING;

INSERT INTO public.corpus_plan_flat_installments (plan_id, flat_id, installment_no, amount)
SELECT cpf.plan_id, cpf.flat_id, 1, cpf.installment_1
FROM public.corpus_plan_flats cpf
JOIN public.corpus_plans cp ON cp.id = cpf.plan_id AND cp.name = 'Corpus 2025'
WHERE cpf.installment_1 IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.corpus_plan_flat_installments (plan_id, flat_id, installment_no, amount)
SELECT cpf.plan_id, cpf.flat_id, 2, cpf.installment_2
FROM public.corpus_plan_flats cpf
JOIN public.corpus_plans cp ON cp.id = cpf.plan_id AND cp.name = 'Corpus 2025'
WHERE cpf.installment_2 IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.corpus_plan_flat_installments (plan_id, flat_id, installment_no, amount)
SELECT cpf.plan_id, cpf.flat_id, 3, cpf.installment_3
FROM public.corpus_plan_flats cpf
JOIN public.corpus_plans cp ON cp.id = cpf.plan_id AND cp.name = 'Corpus 2025'
WHERE cpf.installment_3 IS NOT NULL
ON CONFLICT DO NOTHING;

-- 5. Rewrite v_corpus_tracker: multi-plan aware, carry-forward in effective target
CREATE OR REPLACE VIEW public.v_corpus_tracker AS
SELECT
  f.code                                                              AS flat_code,
  f.block,
  f.flat_type,
  cp.id                                                               AS plan_id,
  cp.name                                                             AS plan_name,
  cp.status                                                           AS plan_status,
  cp.start_fiscal_year,
  cp.end_fiscal_year,
  cpf.target_amount                                                   AS corpus_target,
  cpf.pre_payment,
  cpf.carry_forward_amount,
  cpf.target_amount + cpf.carry_forward_amount                        AS effective_target,
  cpf.pre_payment + COALESCE(SUM(t.amount) FILTER (
    WHERE t.corpus = 'YES' AND t.cr_dr = 'CR'
      AND t.row_type != 'VOIDED'
      AND t.fiscal_year BETWEEN cp.start_fiscal_year AND cp.end_fiscal_year
  ), 0)                                                               AS collected,
  (cpf.target_amount + cpf.carry_forward_amount)
    - cpf.pre_payment
    - COALESCE(SUM(t.amount) FILTER (
        WHERE t.corpus = 'YES' AND t.cr_dr = 'CR'
          AND t.row_type != 'VOIDED'
          AND t.fiscal_year BETWEEN cp.start_fiscal_year AND cp.end_fiscal_year
      ), 0)                                                           AS balance,
  ROUND((cpf.pre_payment + COALESCE(SUM(t.amount) FILTER (
    WHERE t.corpus = 'YES' AND t.cr_dr = 'CR'
      AND t.row_type != 'VOIDED'
      AND t.fiscal_year BETWEEN cp.start_fiscal_year AND cp.end_fiscal_year
  ), 0)) * 100.0
    / NULLIF(cpf.target_amount + cpf.carry_forward_amount, 0), 1)    AS pct_paid,
  MAX(t.value_date) FILTER (
    WHERE t.corpus = 'YES' AND t.cr_dr = 'CR'
      AND t.row_type != 'VOIDED'
      AND t.fiscal_year BETWEEN cp.start_fiscal_year AND cp.end_fiscal_year
  )                                                                   AS last_payment_date,
  CASE
    WHEN cpf.pre_payment + COALESCE(SUM(t.amount) FILTER (
      WHERE t.corpus = 'YES' AND t.cr_dr = 'CR'
        AND t.row_type != 'VOIDED'
        AND t.fiscal_year BETWEEN cp.start_fiscal_year AND cp.end_fiscal_year
    ), 0) >= cpf.target_amount + cpf.carry_forward_amount THEN 'Done'
    WHEN cpf.pre_payment + COALESCE(SUM(t.amount) FILTER (
      WHERE t.corpus = 'YES' AND t.cr_dr = 'CR'
        AND t.row_type != 'VOIDED'
        AND t.fiscal_year BETWEEN cp.start_fiscal_year AND cp.end_fiscal_year
    ), 0) > 0 THEN 'Partial'
    ELSE 'Pending'
  END                                                                 AS status
FROM public.corpus_plans cp
JOIN public.corpus_plan_flats cpf ON cpf.plan_id = cp.id
JOIN public.flats f               ON f.id = cpf.flat_id
LEFT JOIN public.transactions t   ON t.flat_code = f.code
WHERE cp.status IN ('active', 'draft')
GROUP BY
  f.code, f.block, f.flat_type,
  cp.id, cp.name, cp.status, cp.start_fiscal_year, cp.end_fiscal_year,
  cpf.target_amount, cpf.pre_payment, cpf.carry_forward_amount
ORDER BY cp.name, f.code;
