-- Allow all authenticated users to read app_settings (e.g. UPI, bank details shown to non-admins)
-- Admin-only write policy already exists from migration 013
CREATE POLICY "app_settings_read_all"
  ON public.app_settings
  FOR SELECT TO authenticated
  USING (true);
