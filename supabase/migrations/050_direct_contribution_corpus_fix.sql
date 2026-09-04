-- 050: Fix add_direct_contribution's DR leg silently dropping out of Corpus.
--
-- The CR leg (owner's contribution) correctly tagged corpus='YES'/plan_id when
-- p_corpus_plan_id was given, but the DR leg (money out to the vendor) always
-- hardcoded corpus='NO', plan_id=NULL. A net-zero pass-through pair then landed
-- in two different fund buckets instead of netting within one: Corpus kept the
-- full CR with no offsetting DR (overstating it), and Maintenance picked up a
-- DR that was never its own (overstating its apparent deficit). The overall
-- total still tied to the bank balance — the two errors canceled out — but
-- v_fund_position's per-fund split, and everything the Dashboard shows from
-- it, was wrong for any corpus-linked direct contribution.

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

  -- DR leg's fund tag must mirror the CR leg's, or a corpus-linked contribution's
  -- outflow silently lands in Maintenance instead of netting against its own CR
  -- (net-zero pair, wrong buckets) — corrupting per-fund balances though the total
  -- still ties out. plan_id is set too so it nets within the same plan, not just fund.
  INSERT INTO transactions (
    value_date, description, cr_dr, amount,
    category, corpus, plan_id, fiscal_year, fiscal_month, fiscal_label,
    source, expense_id, row_type, split_ref_code)
  VALUES (
    v_exp.expense_date,
    'Direct payment to ' || v_payee || ' by ' || v_flat.code
      || ' (' || COALESCE(v_exp.voucher_no, 'no voucher') || ')',
    'DR', p_amount,
    'Direct',
    CASE WHEN p_corpus_plan_id IS NULL THEN 'NO' ELSE 'YES' END,
    p_corpus_plan_id, v_fy, v_fmon, v_flab,
    'Direct', p_expense_id, 'Normal', v_pair)
  RETURNING id INTO v_dr;

  RETURN jsonb_build_object('cr_id', v_cr, 'dr_id', v_dr, 'pair', v_pair);
END $$;

-- Backfill: correct the DR legs of every corpus-linked direct contribution
-- already posted before this fix, so historical fund positions are right too.
UPDATE public.transactions dr
SET corpus = 'YES', plan_id = cr.plan_id
FROM public.transactions cr
WHERE dr.source = 'Direct' AND dr.cr_dr = 'DR' AND dr.corpus = 'NO'
  AND cr.source = 'Direct' AND cr.cr_dr = 'CR' AND cr.corpus = 'YES'
  AND cr.split_ref_code = dr.split_ref_code;
