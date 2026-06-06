-- ============================================================
-- Migration 020: Owner role + privacy-correct RLS
--
-- Adds 'owner' role (flat resident self-service) and tightens
-- SELECT policies so owners see only their own flat's data,
-- and fixes overly-broad FOR ALL policies from migration 002
-- that were defeating the admin-write guards added in 013.
-- ============================================================

-- 1. Allow 'owner' in user_roles ─────────────────────────────
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_role_check
  CHECK (role IN ('admin', 'committee', 'auditor', 'owner'));

-- 2. Helper: owner's linked flat_id (UUID) ───────────────────
CREATE OR REPLACE FUNCTION public.get_my_flat_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT flat_id FROM public.profiles WHERE id = auth.uid()
$$;

-- 3. Helper: owner's flat code (text, for transactions join) ──
CREATE OR REPLACE FUNCTION public.get_my_flat_code()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT f.code
  FROM public.flats f
  JOIN public.profiles p ON p.flat_id = f.id AND p.id = auth.uid()
  LIMIT 1
$$;

-- 4. FLATS ────────────────────────────────────────────────────
-- Owner sees only their own flat; committee/auditor see all.
DROP POLICY IF EXISTS "Authenticated read flats" ON public.flats;
CREATE POLICY "flats_read" ON public.flats
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'committee', 'auditor')
    OR id = public.get_my_flat_id()
  );

-- 5. TRANSACTIONS ─────────────────────────────────────────────
-- Owner sees only their flat's CR transactions (so v_dues_tracker
-- and v_corpus_tracker views work correctly via RLS propagation).
DROP POLICY IF EXISTS "Authenticated read transactions" ON public.transactions;
CREATE POLICY "transactions_read" ON public.transactions
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'committee', 'auditor')
    OR (flat_code IS NOT NULL AND flat_code = public.get_my_flat_code())
  );

-- 6. RESIDENTS ────────────────────────────────────────────────
-- Owner sees only residents of their own flat.
-- Also removes the overly-broad FOR ALL policy from migration 002
-- (residents_admin_write from 013 covers admin writes).
DROP POLICY IF EXISTS "auth_read_residents"  ON public.residents;
DROP POLICY IF EXISTS "auth_write_residents" ON public.residents;
CREATE POLICY "residents_read" ON public.residents
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'committee', 'auditor')
    OR flat_id = public.get_my_flat_id()
  );

-- 7. CORPUS_PLAN_FLATS ────────────────────────────────────────
-- Owner sees only their flat's corpus allocation.
-- Removes overly-broad FOR ALL policy from 002.
DROP POLICY IF EXISTS "auth_all_corpus_plan_flats" ON public.corpus_plan_flats;
CREATE POLICY "corpus_plan_flats_read" ON public.corpus_plan_flats
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'committee', 'auditor')
    OR flat_id = public.get_my_flat_id()
  );

-- 8. CORPUS_PLANS ─────────────────────────────────────────────
-- Plan headers have no personal data; all roles may read.
-- Removes overly-broad FOR ALL policy from 002.
DROP POLICY IF EXISTS "auth_all_corpus_plans" ON public.corpus_plans;
CREATE POLICY "corpus_plans_read" ON public.corpus_plans
  FOR SELECT TO authenticated USING (true);

-- 9. APP_SETTINGS ─────────────────────────────────────────────
-- Removes overly-broad FOR ALL from 002 (was defeating admin-write
-- guard added in 013). Read policy was added in migration 019.
DROP POLICY IF EXISTS "auth_all_app_settings" ON public.app_settings;

-- 10. EXPENSES ────────────────────────────────────────────────
-- Owner has no access to expense management.
DROP POLICY IF EXISTS "expenses_select" ON public.expenses;
CREATE POLICY "expenses_select" ON public.expenses
  FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin', 'committee', 'auditor'));

-- 11. AUDIT LOG ───────────────────────────────────────────────
-- Owner cannot see the audit trail.
DROP POLICY IF EXISTS "audit_log_select" ON public.audit_log;
CREATE POLICY "audit_log_select" ON public.audit_log
  FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin', 'committee', 'auditor'));

-- 12. USER_ROLES ──────────────────────────────────────────────
-- Owner can see only their own role row.
DROP POLICY IF EXISTS "user_roles_select" ON public.user_roles;
CREATE POLICY "user_roles_select" ON public.user_roles
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'committee', 'auditor')
    OR user_id = auth.uid()
  );
