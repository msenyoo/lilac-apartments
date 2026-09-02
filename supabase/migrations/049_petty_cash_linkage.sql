-- 049_petty_cash_linkage.sql
-- Wires petty_cash_transactions.expense_id/transaction_id (existing, unused
-- columns) into audit + access-control parity with every other financial
-- table, and adds a point-in-time balance function mirroring
-- fn_bank_balance_as_of.

-- 1. Audit trail parity with expenses (trg_audit_expenses uses the same
--    generic fn_audit_trigger — works on any table with an `id` column).
CREATE TRIGGER trg_audit_petty_cash
  AFTER INSERT OR UPDATE OR DELETE ON public.petty_cash_transactions
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

-- 2. RLS parity with expenses — petty_cash_transactions currently has RLS
--    OFF entirely, unlike every other financial table.
ALTER TABLE public.petty_cash_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY petty_cash_admin_write ON public.petty_cash_transactions
  FOR ALL
  USING (get_my_role() = 'admin')
  WITH CHECK (get_my_role() = 'admin');

CREATE POLICY petty_cash_select ON public.petty_cash_transactions
  FOR SELECT
  USING (get_my_role() = ANY (ARRAY['admin', 'committee', 'auditor']));

-- 3. Point-in-time balance, mirroring fn_bank_balance_as_of exactly.
CREATE OR REPLACE FUNCTION public.fn_petty_cash_balance_as_of(p_date date)
RETURNS bigint
LANGUAGE sql STABLE SET search_path = public
AS $$
  SELECT COALESCE(
    SUM(CASE WHEN txn_type = 'Disbursement' THEN -amount ELSE amount END),
    0
  )::bigint
  FROM petty_cash_transactions
  WHERE txn_date <= p_date;
$$;
