-- 035: Direct payments — owner pays vendor directly.
--   A contribution is a matched CR (flat credit) + DR transaction pair,
--   net Rs.0 to the bank balance, linked to its expense via expense_id
--   and to its partner row via a shared split_ref_code pair key.

-- 1. Allow 'Direct' payment mode on expense headers
ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_payment_mode_check;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_payment_mode_check
  CHECK (payment_mode IN ('Cash','Online','Bank Transfer','Cheque','Direct'));

-- 2. Add a contribution: insert the CR/DR pair
CREATE OR REPLACE FUNCTION public.add_direct_contribution(
  p_expense_id    uuid,
  p_flat_id       uuid,
  p_amount        integer,
  p_corpus_plan_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_exp      expenses%ROWTYPE;
  v_flat     flats%ROWTYPE;
  v_existing integer;
  v_payee    text;
  v_pair     text;
  v_cr       uuid;
  v_dr       uuid;
  v_fy       integer;
  v_fmon     text;
  v_flab     text;
BEGIN
  IF public.get_my_role() <> 'admin' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be positive';
  END IF;

  SELECT * INTO v_exp FROM expenses
   WHERE id = p_expense_id AND voided_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'expense not found or voided'; END IF;

  SELECT * INTO v_flat FROM flats WHERE id = p_flat_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'flat not found'; END IF;

  IF p_corpus_plan_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM corpus_plans WHERE id = p_corpus_plan_id) THEN
    RAISE EXCEPTION 'corpus plan not found';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_existing
    FROM transactions
   WHERE expense_id = p_expense_id AND source = 'Direct'
     AND cr_dr = 'CR' AND row_type <> 'VOIDED';
  IF v_existing + p_amount > v_exp.amount THEN
    RAISE EXCEPTION 'contributions (%) would exceed expense amount (%)',
      v_existing + p_amount, v_exp.amount;
  END IF;

  v_payee := COALESCE(
    v_exp.payee_name_raw,
    (SELECT name FROM vendors WHERE id = v_exp.vendor_id),
    (SELECT name FROM staff   WHERE id = v_exp.staff_id),
    'payee');
  v_fy := CASE WHEN EXTRACT(MONTH FROM v_exp.expense_date) >= 4
               THEN EXTRACT(YEAR FROM v_exp.expense_date)::int
               ELSE EXTRACT(YEAR FROM v_exp.expense_date)::int - 1 END;
  v_fmon := trim(to_char(v_exp.expense_date, 'Mon'));
  v_flab := trim(to_char(v_exp.expense_date, 'Mon')) || '-' || to_char(v_exp.expense_date, 'YY');
  v_pair := 'DP-' || substr(md5(random()::text || clock_timestamp()::text), 1, 10);

  INSERT INTO transactions (
    value_date, description, cr_dr, amount, flat_id, flat_code,
    category, corpus, plan_id, fiscal_year, fiscal_month, fiscal_label,
    source, expense_id, row_type, split_ref_code)
  VALUES (
    v_exp.expense_date,
    'Direct payment by ' || v_flat.code || ' to ' || v_payee
      || ' (' || COALESCE(v_exp.voucher_no, 'no voucher') || ')',
    'CR', p_amount, p_flat_id, v_flat.code,
    CASE WHEN p_corpus_plan_id IS NULL THEN 'Maintenance' ELSE 'Corpus' END,
    CASE WHEN p_corpus_plan_id IS NULL THEN 'NO' ELSE 'YES' END,
    p_corpus_plan_id, v_fy, v_fmon, v_flab,
    'Direct', p_expense_id, 'Normal', v_pair)
  RETURNING id INTO v_cr;

  INSERT INTO transactions (
    value_date, description, cr_dr, amount,
    category, corpus, fiscal_year, fiscal_month, fiscal_label,
    source, expense_id, row_type, split_ref_code)
  VALUES (
    v_exp.expense_date,
    'Direct payment to ' || v_payee || ' by ' || v_flat.code
      || ' (' || COALESCE(v_exp.voucher_no, 'no voucher') || ')',
    'DR', p_amount,
    'Direct', 'NO', v_fy, v_fmon, v_flab,
    'Direct', p_expense_id, 'Normal', v_pair)
  RETURNING id INTO v_dr;

  RETURN jsonb_build_object('cr_id', v_cr, 'dr_id', v_dr, 'pair', v_pair);
END $$;

-- 3. Void one pair (p_cr_id given) or all pairs of an expense
CREATE OR REPLACE FUNCTION public.void_direct_pairs(
  p_expense_id uuid,
  p_cr_id      uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_pair text;
  v_n    integer;
BEGIN
  IF public.get_my_role() <> 'admin' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_cr_id IS NOT NULL THEN
    SELECT split_ref_code INTO v_pair FROM transactions
     WHERE id = p_cr_id AND expense_id = p_expense_id
       AND source = 'Direct' AND cr_dr = 'CR' AND row_type <> 'VOIDED'
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'contribution not found'; END IF;
    UPDATE transactions SET row_type = 'VOIDED'
     WHERE expense_id = p_expense_id AND source = 'Direct'
       AND split_ref_code = v_pair AND row_type <> 'VOIDED';
  ELSE
    UPDATE transactions SET row_type = 'VOIDED'
     WHERE expense_id = p_expense_id AND source = 'Direct'
       AND row_type <> 'VOIDED';
  END IF;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('voided', v_n);
END $$;

-- 4. Reconciliation view: expose direct_total / net_amount, add 'Direct' status
-- (DROP first: OR REPLACE cannot add columns mid-list)
DROP VIEW IF EXISTS public.v_expense_reconciliation;
CREATE VIEW public.v_expense_reconciliation
WITH (security_invoker = true)
AS
SELECT
  e.id,
  e.voucher_no,
  e.expense_date,
  e.description,
  e.amount,
  e.payment_mode,
  e.transaction_id,
  e.reconciled_at,
  COALESCE(d.direct_total, 0)::integer              AS direct_total,
  (e.amount - COALESCE(d.direct_total, 0))::integer AS net_amount,
  CASE
    WHEN e.payment_mode = 'Cash'                 THEN 'Cash'
    WHEN e.transaction_id IS NOT NULL            THEN 'Reconciled'
    WHEN e.payment_mode = 'Direct'               THEN 'Direct'
    WHEN COALESCE(d.direct_total, 0) >= e.amount THEN 'Direct'
    ELSE 'Unreconciled'
  END AS reconciliation_status,
  v.name  AS vendor_name,
  ec.name AS category_name,
  cp.name AS corpus_plan_name
FROM public.expenses e
LEFT JOIN LATERAL (
  SELECT SUM(t.amount) AS direct_total
    FROM public.transactions t
   WHERE t.expense_id = e.id AND t.source = 'Direct'
     AND t.cr_dr = 'CR' AND t.row_type <> 'VOIDED'
) d ON true
LEFT JOIN public.vendors            v  ON v.id  = e.vendor_id
LEFT JOIN public.expense_categories ec ON ec.id = e.category_id
LEFT JOIN public.corpus_plans       cp ON cp.id = e.corpus_plan_id
ORDER BY e.expense_date DESC;

GRANT EXECUTE ON FUNCTION public.add_direct_contribution(uuid, uuid, integer, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_direct_pairs(uuid, uuid) TO authenticated;
