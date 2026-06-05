-- WARNING: Before running this migration, ensure the admin user has a row in user_roles:
-- INSERT INTO public.user_roles (user_id, role)
-- SELECT id, 'admin' FROM auth.users WHERE email = 'msenyoo@gmail.com'
-- ON CONFLICT (user_id) DO UPDATE SET role = 'admin';
-- Running this without seeding the admin will block ALL write operations.

-- ─────────────────────────────────────────────────────────────────────────────
-- Step A — get_my_role() helper
-- Created FIRST because policies created below reference it.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step B — user_roles table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_roles (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('admin', 'committee', 'auditor')),
  assigned_by uuid REFERENCES auth.users(id),
  assigned_at timestamptz DEFAULT now()
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_roles_select" ON public.user_roles
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "user_roles_admin_write" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

-- ─────────────────────────────────────────────────────────────────────────────
-- Step C — Backfill from profiles
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.user_roles (user_id, role)
SELECT id, CASE WHEN role = 'admin' THEN 'admin' ELSE 'committee' END
FROM public.profiles
ON CONFLICT (user_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step D — v_users view (for admin user list UI)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_users AS
SELECT u.id, u.email, u.created_at, u.last_sign_in_at, ur.role, ur.assigned_at
FROM auth.users u
LEFT JOIN public.user_roles ur ON ur.user_id = u.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step E — Drop blanket write policies and replace with admin-only
-- ─────────────────────────────────────────────────────────────────────────────

-- transactions
DROP POLICY IF EXISTS "Authenticated insert transactions" ON public.transactions;
CREATE POLICY "transactions_admin_insert" ON public.transactions
  FOR INSERT TO authenticated
  WITH CHECK (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "Authenticated update transactions" ON public.transactions;
CREATE POLICY "transactions_admin_update" ON public.transactions
  FOR UPDATE TO authenticated
  USING (public.get_my_role() = 'admin');

-- uploads
DROP POLICY IF EXISTS "Authenticated insert uploads" ON public.uploads;
CREATE POLICY "uploads_admin_insert" ON public.uploads
  FOR INSERT TO authenticated
  WITH CHECK (public.get_my_role() = 'admin');

-- split_refs
DROP POLICY IF EXISTS "Authenticated insert split_refs" ON public.split_refs;
CREATE POLICY "split_refs_admin_insert" ON public.split_refs
  FOR INSERT TO authenticated
  WITH CHECK (public.get_my_role() = 'admin');

-- residents
DROP POLICY IF EXISTS "auth_write_residents" ON public.residents;
CREATE POLICY "residents_admin_write" ON public.residents
  FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

-- maintenance_rate_history
DROP POLICY IF EXISTS "auth_write_rate_hist" ON public.maintenance_rate_history;
CREATE POLICY "rate_hist_admin_write" ON public.maintenance_rate_history
  FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

-- corpus_plans
DROP POLICY IF EXISTS "auth_all_corpus_plans" ON public.corpus_plans;
CREATE POLICY "corpus_plans_admin_write" ON public.corpus_plans
  FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

-- corpus_plan_flats
DROP POLICY IF EXISTS "auth_all_corpus_plan_flats" ON public.corpus_plan_flats;
CREATE POLICY "corpus_plan_flats_admin_write" ON public.corpus_plan_flats
  FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

-- app_settings
DROP POLICY IF EXISTS "auth_all_app_settings" ON public.app_settings;
CREATE POLICY "app_settings_admin_write" ON public.app_settings
  FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

-- flats
DROP POLICY IF EXISTS "auth_update_flats" ON public.flats;
CREATE POLICY "flats_admin_update" ON public.flats
  FOR UPDATE TO authenticated
  USING (public.get_my_role() = 'admin');

-- ─────────────────────────────────────────────────────────────────────────────
-- expenses — enable RLS (had none in prior migrations)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "expenses_select" ON public.expenses
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "expenses_admin_write" ON public.expenses
  FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');
