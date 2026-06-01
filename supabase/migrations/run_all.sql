-- ============================================================
-- LILAC APARTMENTS — Full migration (002 + 003 + 004 combined)
-- Paste into Supabase Dashboard → SQL Editor → Run
-- Safe to re-run: uses IF NOT EXISTS / ON CONFLICT DO NOTHING
-- ============================================================


-- ── 1. Flat metadata ─────────────────────────────────────────
ALTER TABLE public.flats
  ADD COLUMN IF NOT EXISTS bhk_type           text,
  ADD COLUMN IF NOT EXISTS has_private_terrace boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS flat_notes         text;

UPDATE public.flats SET bhk_type = CASE code
  WHEN 'AG1' THEN '3BHK'       WHEN 'AF1' THEN '3BHK'       WHEN 'AF2' THEN '2BHK'       WHEN 'AP1' THEN '2BHK+P.T'
  WHEN 'BG1' THEN '1BHK'       WHEN 'BG2' THEN '1BHK+Study'
  WHEN 'BF1' THEN '1BHK'       WHEN 'BF2' THEN '2BHK'       WHEN 'BF3' THEN '2BHK'
  WHEN 'BF4' THEN '2BHK'       WHEN 'BF5' THEN '2BHK'       WHEN 'BF6' THEN '1BHK+Study'
  WHEN 'BP1' THEN '2BHK+P.T'   WHEN 'BP2' THEN '2BHK+P.T'
  WHEN 'BS1' THEN '2BHK'       WHEN 'BS2' THEN '2BHK'
  WHEN 'CG1' THEN '1BHK'       WHEN 'CG2' THEN '1BHK+Study'
  WHEN 'CF1' THEN '1BHK'       WHEN 'CF2' THEN '2BHK'       WHEN 'CF3' THEN '2BHK'
  WHEN 'CF4' THEN '3BHK'       WHEN 'CF5' THEN '2BHK'       WHEN 'CF6' THEN '1BHK+Study'
  WHEN 'CP1' THEN '2BHK+P.T'   WHEN 'CP2' THEN '2BHK+P.T'
  WHEN 'CS1' THEN '2BHK'       WHEN 'CS2' THEN '3BHK'
  WHEN 'DG1' THEN '2BHK'       WHEN 'DG2' THEN '2BHK'
  WHEN 'DF1' THEN '2BHK'       WHEN 'DF2' THEN '2BHK'       WHEN 'DF3' THEN '2BHK'       WHEN 'DF4' THEN '2BHK'
  WHEN 'DP1' THEN '2BHK+P.T'   WHEN 'DP2' THEN '2BHK+P.T'
  WHEN 'EG1' THEN '2BHK'       WHEN 'EG2' THEN '2BHK'
  WHEN 'EF1' THEN '2BHK'       WHEN 'EF2' THEN '2BHK'       WHEN 'EF3' THEN '2BHK'       WHEN 'EF4' THEN '2BHK'
  WHEN 'EP1' THEN '2BHK+P.T'   WHEN 'EP2' THEN '2BHK+P.T'
  ELSE '2BHK'
END;

UPDATE public.flats SET has_private_terrace = true
  WHERE code IN ('AP1','BP1','BP2','CP1','CP2','DP1','DP2','EP1','EP2');


-- ── 2. Residents ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.residents (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  flat_id       uuid NOT NULL REFERENCES public.flats(id) ON DELETE CASCADE,
  name          text NOT NULL,
  type          text NOT NULL CHECK (type IN ('Owner','Tenant')),
  phone         text,
  email         text,
  upi_ids       text[] DEFAULT '{}',
  moved_in      date,
  moved_out     date,
  is_active     boolean DEFAULT true,
  notes         text,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_residents_flat_id ON public.residents(flat_id);
CREATE INDEX IF NOT EXISTS idx_residents_active  ON public.residents(is_active);


-- ── 3. Maintenance rate history ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.maintenance_rate_history (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  flat_id        uuid NOT NULL REFERENCES public.flats(id) ON DELETE CASCADE,
  monthly_rate   integer NOT NULL,
  effective_from date NOT NULL,
  effective_to   date,
  notes          text,
  created_at     timestamptz DEFAULT now(),
  created_by     uuid REFERENCES public.profiles(id)
);
CREATE INDEX IF NOT EXISTS idx_rate_hist_flat ON public.maintenance_rate_history(flat_id);

INSERT INTO public.maintenance_rate_history (flat_id, monthly_rate, effective_from, notes)
SELECT id, maintenance_amt, '2024-04-01', 'Initial rate — revised Mar-24'
FROM public.flats
ON CONFLICT DO NOTHING;


-- ── 4. Corpus plans ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.corpus_plans (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name               text NOT NULL,
  description        text,
  total_target       integer NOT NULL DEFAULT 0,
  pre_payments       integer DEFAULT 0,
  planned_budget     jsonb   DEFAULT '[]',
  status             text    DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
  start_fiscal_year  integer,
  end_fiscal_year    integer,
  created_at         timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.corpus_plan_flats (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id       uuid NOT NULL REFERENCES public.corpus_plans(id) ON DELETE CASCADE,
  flat_id       uuid NOT NULL REFERENCES public.flats(id) ON DELETE CASCADE,
  target_amount integer NOT NULL,
  pre_payment   integer DEFAULT 0,
  installment_1 integer,
  installment_2 integer,
  installment_3 integer,
  UNIQUE(plan_id, flat_id)
);

-- Seed Corpus 2025 plan (skip if already exists)
WITH plan AS (
  INSERT INTO public.corpus_plans
    (name, description, total_target, pre_payments, planned_budget, status, start_fiscal_year, end_fiscal_year)
  VALUES (
    'Corpus 2025',
    'Major renovation: civil works and painting',
    2430000, 285000,
    '[{"category":"Civil","budget":250000},{"category":"Painting","budget":1700000},{"category":"Buffer","budget":50000}]',
    'active', 2025, 2026
  )
  ON CONFLICT DO NOTHING
  RETURNING id
)
INSERT INTO public.corpus_plan_flats
  (plan_id, flat_id, target_amount, pre_payment, installment_1, installment_2, installment_3)
SELECT
  plan.id, f.id,
  CASE f.code
    WHEN 'AG1' THEN 60000  WHEN 'AF1' THEN 60000  WHEN 'AF2' THEN 55000  WHEN 'AP1' THEN 65000
    WHEN 'BG1' THEN 40000  WHEN 'BG2' THEN 45000  WHEN 'BF1' THEN 40000  WHEN 'BF2' THEN 55000
    WHEN 'BF3' THEN 55000  WHEN 'BF4' THEN 55000  WHEN 'BF5' THEN 55000  WHEN 'BF6' THEN 45000
    WHEN 'BP1' THEN 65000  WHEN 'BP2' THEN 65000  WHEN 'BS1' THEN 55000  WHEN 'BS2' THEN 55000
    WHEN 'CG1' THEN 40000  WHEN 'CG2' THEN 45000  WHEN 'CF1' THEN 40000  WHEN 'CF2' THEN 55000
    WHEN 'CF3' THEN 55000  WHEN 'CF4' THEN 60000  WHEN 'CF5' THEN 55000  WHEN 'CF6' THEN 45000
    WHEN 'CP1' THEN 65000  WHEN 'CP2' THEN 65000  WHEN 'CS1' THEN 55000  WHEN 'CS2' THEN 60000
    WHEN 'DG1' THEN 55000  WHEN 'DG2' THEN 55000  WHEN 'DF1' THEN 55000  WHEN 'DF2' THEN 55000
    WHEN 'DF3' THEN 55000  WHEN 'DF4' THEN 55000  WHEN 'DP1' THEN 65000  WHEN 'DP2' THEN 65000
    WHEN 'EG1' THEN 55000  WHEN 'EG2' THEN 55000  WHEN 'EF1' THEN 55000  WHEN 'EF2' THEN 55000
    WHEN 'EF3' THEN 55000  WHEN 'EF4' THEN 55000  WHEN 'EP1' THEN 65000  WHEN 'EP2' THEN 65000
    ELSE 55000 END,
  CASE f.code
    WHEN 'CF3' THEN 15000  WHEN 'CP1' THEN 20000  WHEN 'CP2' THEN 20000
    WHEN 'CS1' THEN 20000  WHEN 'CS2' THEN 20000  WHEN 'DP1' THEN 30000
    WHEN 'EG1' THEN 20000  WHEN 'EG2' THEN 20000  WHEN 'EF1' THEN 10000
    WHEN 'EF2' THEN 20000  WHEN 'EF3' THEN 20000  WHEN 'EP1' THEN 20000  WHEN 'EP2' THEN 50000
    ELSE 0 END,
  CASE f.code
    WHEN 'AG1' THEN 20000  WHEN 'AF1' THEN 20000  WHEN 'AF2' THEN 19000  WHEN 'AP1' THEN 22000
    WHEN 'BG1' THEN 14000  WHEN 'BG2' THEN 15000  WHEN 'BF1' THEN 14000  WHEN 'BF2' THEN 19000
    WHEN 'BF3' THEN 19000  WHEN 'BF4' THEN 19000  WHEN 'BF5' THEN 19000  WHEN 'BF6' THEN 15000
    WHEN 'BP1' THEN 22000  WHEN 'BP2' THEN 22000  WHEN 'BS1' THEN 19000  WHEN 'BS2' THEN 19000
    WHEN 'CG1' THEN 14000  WHEN 'CG2' THEN 15000  WHEN 'CF1' THEN 14000  WHEN 'CF2' THEN 19000
    WHEN 'CF3' THEN 14000  WHEN 'CF4' THEN 20000  WHEN 'CF5' THEN 19000  WHEN 'CF6' THEN 15000
    WHEN 'CP1' THEN 15000  WHEN 'CP2' THEN 15000  WHEN 'CS1' THEN 12000  WHEN 'CS2' THEN 14000
    WHEN 'DG1' THEN 19000  WHEN 'DG2' THEN 19000  WHEN 'DF1' THEN 19000  WHEN 'DF2' THEN 19000
    WHEN 'DF3' THEN 19000  WHEN 'DF4' THEN 19000  WHEN 'DP1' THEN 12000  WHEN 'DP2' THEN 22000
    WHEN 'EG1' THEN 12000  WHEN 'EG2' THEN 12000  WHEN 'EF1' THEN 15000  WHEN 'EF2' THEN 12000
    WHEN 'EF3' THEN 12000  WHEN 'EF4' THEN 19000  WHEN 'EP1' THEN 15000  WHEN 'EP2' THEN 5000
    ELSE 19000 END,
  CASE f.code
    WHEN 'AG1' THEN 20000  WHEN 'AF1' THEN 20000  WHEN 'AF2' THEN 18000  WHEN 'AP1' THEN 21500
    WHEN 'BG1' THEN 13000  WHEN 'BG2' THEN 15000  WHEN 'BF1' THEN 13000  WHEN 'BF2' THEN 18000
    WHEN 'BF3' THEN 18000  WHEN 'BF4' THEN 18000  WHEN 'BF5' THEN 18000  WHEN 'BF6' THEN 15000
    WHEN 'BP1' THEN 21500  WHEN 'BP2' THEN 21500  WHEN 'BS1' THEN 18000  WHEN 'BS2' THEN 18000
    WHEN 'CG1' THEN 13000  WHEN 'CG2' THEN 15000  WHEN 'CF1' THEN 13000  WHEN 'CF2' THEN 18000
    WHEN 'CF3' THEN 13000  WHEN 'CF4' THEN 20000  WHEN 'CF5' THEN 18000  WHEN 'CF6' THEN 15000
    WHEN 'CP1' THEN 15000  WHEN 'CP2' THEN 15000  WHEN 'CS1' THEN 11500  WHEN 'CS2' THEN 13000
    WHEN 'DG1' THEN 18000  WHEN 'DG2' THEN 18000  WHEN 'DF1' THEN 18000  WHEN 'DF2' THEN 18000
    WHEN 'DF3' THEN 18000  WHEN 'DF4' THEN 18000  WHEN 'DP1' THEN 11500  WHEN 'DP2' THEN 21500
    WHEN 'EG1' THEN 11500  WHEN 'EG2' THEN 11500  WHEN 'EF1' THEN 15000  WHEN 'EF2' THEN 11500
    WHEN 'EF3' THEN 11500  WHEN 'EF4' THEN 18000  WHEN 'EP1' THEN 15000  WHEN 'EP2' THEN 5000
    ELSE 18000 END,
  CASE f.code
    WHEN 'AG1' THEN 20000  WHEN 'AF1' THEN 20000  WHEN 'AF2' THEN 18000  WHEN 'AP1' THEN 21500
    WHEN 'BG1' THEN 13000  WHEN 'BG2' THEN 15000  WHEN 'BF1' THEN 13000  WHEN 'BF2' THEN 18000
    WHEN 'BF3' THEN 18000  WHEN 'BF4' THEN 18000  WHEN 'BF5' THEN 18000  WHEN 'BF6' THEN 15000
    WHEN 'BP1' THEN 21500  WHEN 'BP2' THEN 21500  WHEN 'BS1' THEN 18000  WHEN 'BS2' THEN 18000
    WHEN 'CG1' THEN 13000  WHEN 'CG2' THEN 15000  WHEN 'CF1' THEN 13000  WHEN 'CF2' THEN 18000
    WHEN 'CF3' THEN 13000  WHEN 'CF4' THEN 20000  WHEN 'CF5' THEN 18000  WHEN 'CF6' THEN 15000
    WHEN 'CP1' THEN 15000  WHEN 'CP2' THEN 15000  WHEN 'CS1' THEN 11500  WHEN 'CS2' THEN 13000
    WHEN 'DG1' THEN 18000  WHEN 'DG2' THEN 18000  WHEN 'DF1' THEN 18000  WHEN 'DF2' THEN 18000
    WHEN 'DF3' THEN 18000  WHEN 'DF4' THEN 18000  WHEN 'DP1' THEN 11500  WHEN 'DP2' THEN 21500
    WHEN 'EG1' THEN 11500  WHEN 'EG2' THEN 11500  WHEN 'EF1' THEN 15000  WHEN 'EF2' THEN 11500
    WHEN 'EF3' THEN 11500  WHEN 'EF4' THEN 18000  WHEN 'EP1' THEN 15000  WHEN 'EP2' THEN 5000
    ELSE 18000 END
FROM public.flats f, plan;


-- ── 5. App settings ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.app_settings (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz DEFAULT now()
);

INSERT INTO public.app_settings (key, value) VALUES
  ('dues_start_fiscal_year', '2025')
ON CONFLICT (key) DO NOTHING;


-- ── 6. v_dues_tracker (date-based current FY, carry-forward) ──
CREATE OR REPLACE VIEW public.v_dues_tracker AS
WITH settings AS (
  SELECT
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
  f.maintenance_amt * 12 * (s.current_fy - s.start_fy + 1) AS annual_due,
  COALESCE(SUM(t.amount) FILTER (
    WHERE t.fiscal_year >= s.start_fy AND t.cr_dr = 'CR'
      AND t.category = 'Maintenance' AND t.row_type != 'VOIDED'
  ), 0)                                              AS collected_fy,
  f.maintenance_amt * 12 * (s.current_fy - s.start_fy + 1)
    - COALESCE(SUM(t.amount) FILTER (
        WHERE t.fiscal_year >= s.start_fy AND t.cr_dr = 'CR'
          AND t.category = 'Maintenance' AND t.row_type != 'VOIDED'
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


-- ── 7. v_corpus_tracker (plan-scoped) ────────────────────────
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
  COALESCE(SUM(t.amount) FILTER (
    WHERE t.corpus = 'YES' AND t.cr_dr = 'CR'
      AND t.row_type != 'VOIDED'
      AND t.fiscal_year BETWEEN cp.start_fiscal_year AND cp.end_fiscal_year
  ), 0)                                                   AS collected,
  cpf.target_amount - COALESCE(SUM(t.amount) FILTER (
    WHERE t.corpus = 'YES' AND t.cr_dr = 'CR'
      AND t.row_type != 'VOIDED'
      AND t.fiscal_year BETWEEN cp.start_fiscal_year AND cp.end_fiscal_year
  ), 0)                                                   AS balance,
  ROUND(COALESCE(SUM(t.amount) FILTER (
    WHERE t.corpus = 'YES' AND t.cr_dr = 'CR'
      AND t.row_type != 'VOIDED'
      AND t.fiscal_year BETWEEN cp.start_fiscal_year AND cp.end_fiscal_year
  ), 0) * 100.0 / NULLIF(cpf.target_amount, 0), 1)       AS pct_paid,
  MAX(t.value_date) FILTER (
    WHERE t.corpus = 'YES' AND t.cr_dr = 'CR'
      AND t.row_type != 'VOIDED'
      AND t.fiscal_year BETWEEN cp.start_fiscal_year AND cp.end_fiscal_year
  )                                                       AS last_payment_date,
  CASE
    WHEN COALESCE(SUM(t.amount) FILTER (
      WHERE t.corpus = 'YES' AND t.cr_dr = 'CR'
        AND t.row_type != 'VOIDED'
        AND t.fiscal_year BETWEEN cp.start_fiscal_year AND cp.end_fiscal_year
    ), 0) >= cpf.target_amount THEN 'Done'
    WHEN COALESCE(SUM(t.amount) FILTER (
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


-- ── 8. RLS policies ──────────────────────────────────────────
ALTER TABLE public.residents                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_rate_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corpus_plans             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corpus_plan_flats        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings             ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'auth_read_residents'   AND tablename = 'residents') THEN
    CREATE POLICY "auth_read_residents"   ON public.residents FOR SELECT TO authenticated USING (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'auth_write_residents'  AND tablename = 'residents') THEN
    CREATE POLICY "auth_write_residents"  ON public.residents FOR ALL    TO authenticated USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'auth_read_rate_hist'   AND tablename = 'maintenance_rate_history') THEN
    CREATE POLICY "auth_read_rate_hist"   ON public.maintenance_rate_history FOR SELECT TO authenticated USING (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'auth_write_rate_hist'  AND tablename = 'maintenance_rate_history') THEN
    CREATE POLICY "auth_write_rate_hist"  ON public.maintenance_rate_history FOR ALL    TO authenticated USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'auth_all_corpus_plans' AND tablename = 'corpus_plans') THEN
    CREATE POLICY "auth_all_corpus_plans"      ON public.corpus_plans      FOR ALL TO authenticated USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'auth_all_corpus_plan_flats' AND tablename = 'corpus_plan_flats') THEN
    CREATE POLICY "auth_all_corpus_plan_flats" ON public.corpus_plan_flats FOR ALL TO authenticated USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'auth_all_app_settings' AND tablename = 'app_settings') THEN
    CREATE POLICY "auth_all_app_settings"      ON public.app_settings      FOR ALL TO authenticated USING (true) WITH CHECK (true); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'auth_update_flats'     AND tablename = 'flats') THEN
    CREATE POLICY "auth_update_flats" ON public.flats FOR UPDATE TO authenticated USING (true); END IF;
END $$;
