-- Allow any user to insert their own profile row
-- (Previously only UPDATE was allowed for self; INSERT was only allowed for admins.
--  PostgREST upserts fail silently when INSERT is blocked, making the profile page
--  appear to save but never actually persist data for non-admin users.)
CREATE POLICY "profiles_self_insert" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

-- Enforce mobile uniqueness (non-null values only)
CREATE UNIQUE INDEX IF NOT EXISTS profiles_mobile_unique_idx
  ON public.profiles (mobile)
  WHERE mobile IS NOT NULL;
