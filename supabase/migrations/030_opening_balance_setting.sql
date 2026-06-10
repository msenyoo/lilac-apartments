-- 030: Allow admins to upsert opening_balance_<fy> keys in app_settings
-- app_settings already has a read policy for all authenticated users (migration 019).
-- This migration ensures admins can INSERT/UPDATE any key (including opening_balance_*).

DO $$
BEGIN
  -- Drop if exists so migration is re-runnable
  DROP POLICY IF EXISTS "app_settings_admin_write" ON public.app_settings;

  CREATE POLICY "app_settings_admin_write" ON public.app_settings
    FOR ALL TO authenticated
    USING (
      EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
    )
    WITH CHECK (
      EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
    );
END $$;
