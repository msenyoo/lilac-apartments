-- ============================================================
-- Migration: 016_audit_user_tables.sql
-- Purpose:   Attach audit triggers to user_roles and profiles
--            so that role changes and profile edits are recorded
--            in audit_log alongside all other business mutations.
--            fn_audit_trigger() already exists from 012.
-- ============================================================

-- user_roles
DROP TRIGGER IF EXISTS trg_audit_user_roles ON public.user_roles;
CREATE TRIGGER trg_audit_user_roles
  AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

-- profiles
DROP TRIGGER IF EXISTS trg_audit_profiles ON public.profiles;
CREATE TRIGGER trg_audit_profiles
  AFTER INSERT OR UPDATE OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();
