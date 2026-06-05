-- Extend profiles with contact fields and link to user_roles for the admin UI
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS mobile       text,
  ADD COLUMN IF NOT EXISTS contact_email text,   -- real email, separate from auth email
  ADD COLUMN IF NOT EXISTS display_name  text;   -- alias for full_name, easier to query

-- Sync display_name from full_name for existing rows
UPDATE public.profiles SET display_name = full_name WHERE display_name IS NULL AND full_name IS NOT NULL;

-- Rebuild v_users to include profile fields (drop first to allow column rename)
DROP VIEW IF EXISTS public.v_users;
CREATE VIEW public.v_users AS
SELECT
  u.id,
  u.email                AS auth_email,
  u.created_at,
  u.last_sign_in_at,
  ur.role,
  ur.assigned_at,
  COALESCE(p.display_name, p.full_name)  AS display_name,
  p.mobile,
  p.contact_email
FROM auth.users u
LEFT JOIN public.user_roles ur ON ur.user_id = u.id
LEFT JOIN public.profiles    p  ON p.id       = u.id;

-- Allow authenticated users to read profiles (needed for v_users)
DROP POLICY IF EXISTS "Users read own profile" ON public.profiles;
CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT TO authenticated USING (true);

-- Admins can write any profile; users can write their own
DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "profiles_self_update" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id);

CREATE POLICY "profiles_admin_update" ON public.profiles
  FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');
