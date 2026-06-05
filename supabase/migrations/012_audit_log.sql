-- ============================================================
-- Migration: 012_audit_log.sql
-- Purpose:   Additive-only audit logging infrastructure.
--            Creates the audit_log table, a generic SECURITY
--            DEFINER trigger function, and attaches triggers to
--            every mutable business table.  Nothing existing is
--            altered or dropped.
-- Safe to run at any time; all objects are created with
-- IF NOT EXISTS / DROP … IF EXISTS guards.
-- ============================================================


-- ------------------------------------------------------------
-- 1. audit_log table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_log (
  id           uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      uuid,
  user_email   text,
  action       text        NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  table_name   text        NOT NULL,
  record_id    uuid        NOT NULL,
  old_val      jsonb,
  new_val      jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_table_record ON public.audit_log (table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_user         ON public.audit_log (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created_at   ON public.audit_log (created_at DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Authenticated users may read all audit rows.
-- No client-side INSERT/UPDATE/DELETE policy — the trigger function
-- (SECURITY DEFINER) is the sole writer.
CREATE POLICY "audit_log_select"
  ON public.audit_log
  FOR SELECT
  TO authenticated
  USING (true);


-- ------------------------------------------------------------
-- 2. Generic audit trigger function
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_audit_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_record_id uuid;
  v_old_val   jsonb;
  v_new_val   jsonb;
BEGIN
  IF    TG_OP = 'INSERT' THEN
    v_record_id := NEW.id;
    v_new_val   := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    v_record_id := NEW.id;
    v_old_val   := to_jsonb(OLD);
    v_new_val   := to_jsonb(NEW);
  ELSIF TG_OP = 'DELETE' THEN
    v_record_id := OLD.id;
    v_old_val   := to_jsonb(OLD);
  END IF;

  INSERT INTO public.audit_log
    (user_id, user_email, action, table_name, record_id, old_val, new_val)
  VALUES
    (auth.uid(), auth.email(), TG_OP, TG_TABLE_NAME, v_record_id, v_old_val, v_new_val);

  RETURN COALESCE(NEW, OLD);
END;
$$;


-- ------------------------------------------------------------
-- 3. Attach audit triggers to business tables
--    Pattern: DROP … IF EXISTS then CREATE ensures idempotency.
-- ------------------------------------------------------------

-- transactions
DROP TRIGGER IF EXISTS trg_audit_transactions ON public.transactions;
CREATE TRIGGER trg_audit_transactions
  AFTER INSERT OR UPDATE OR DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

-- expenses
DROP TRIGGER IF EXISTS trg_audit_expenses ON public.expenses;
CREATE TRIGGER trg_audit_expenses
  AFTER INSERT OR UPDATE OR DELETE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

-- corpus_plans
DROP TRIGGER IF EXISTS trg_audit_corpus_plans ON public.corpus_plans;
CREATE TRIGGER trg_audit_corpus_plans
  AFTER INSERT OR UPDATE OR DELETE ON public.corpus_plans
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

-- corpus_plan_flats
DROP TRIGGER IF EXISTS trg_audit_corpus_plan_flats ON public.corpus_plan_flats;
CREATE TRIGGER trg_audit_corpus_plan_flats
  AFTER INSERT OR UPDATE OR DELETE ON public.corpus_plan_flats
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

-- maintenance_rate_history
DROP TRIGGER IF EXISTS trg_audit_maintenance_rate_history ON public.maintenance_rate_history;
CREATE TRIGGER trg_audit_maintenance_rate_history
  AFTER INSERT OR UPDATE OR DELETE ON public.maintenance_rate_history
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

-- flats
DROP TRIGGER IF EXISTS trg_audit_flats ON public.flats;
CREATE TRIGGER trg_audit_flats
  AFTER INSERT OR UPDATE OR DELETE ON public.flats
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

-- residents
DROP TRIGGER IF EXISTS trg_audit_residents ON public.residents;
CREATE TRIGGER trg_audit_residents
  AFTER INSERT OR UPDATE OR DELETE ON public.residents
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();
