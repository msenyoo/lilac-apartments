-- 036: Fix bundle/attach RPCs — Postgres forbids FOR UPDATE in a query with
--   aggregate functions (033/034 combined them, so every call failed with
--   "FOR UPDATE is not allowed with aggregate functions").
--   Lock the rows in a separate statement first, then aggregate.

-- 1. Bundle RPC — same as 033 with the lock split out
CREATE OR REPLACE FUNCTION public.bundle_pending_items(
  p_ids    uuid[],
  p_header jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role             text;
  v_count            integer;
  v_total            integer;
  v_corpus_plan_ids  uuid[];
  v_expense_id       uuid;
  v_voucher_no       text;
  v_corpus_plan_id   uuid;
  v_header_date      date;
  v_header_desc      text;
  v_header_mode      text;
  v_header_payee     text;
BEGIN
  v_role := public.get_my_role();
  IF v_role <> 'admin' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN
    RAISE EXCEPTION 'p_ids must contain at least one item';
  END IF;

  v_header_date  := (p_header->>'expense_date')::date;
  v_header_desc  := p_header->>'description';
  v_header_mode  := p_header->>'payment_mode';
  v_header_payee := COALESCE(p_header->>'payee_name_raw', 'Bundled');

  IF v_header_date IS NULL OR v_header_desc IS NULL OR v_header_mode IS NULL THEN
    RAISE EXCEPTION 'missing header fields';
  END IF;
  IF v_header_mode NOT IN ('Cash','Online','Bank Transfer','Cheque') THEN
    RAISE EXCEPTION 'invalid payment_mode';
  END IF;

  -- Lock first (FOR UPDATE cannot be combined with aggregates)
  PERFORM 1
  FROM   public.pending_line_items
  WHERE  id = ANY(p_ids) AND voided_at IS NULL
  FOR UPDATE;

  SELECT COUNT(*), SUM(amount),
         array_agg(DISTINCT COALESCE(corpus_plan_id, '00000000-0000-0000-0000-000000000000'::uuid))
  INTO   v_count, v_total, v_corpus_plan_ids
  FROM   public.pending_line_items
  WHERE  id = ANY(p_ids) AND voided_at IS NULL;

  IF v_count <> cardinality(p_ids) THEN
    RAISE EXCEPTION 'one or more items not found or voided';
  END IF;

  IF cardinality(v_corpus_plan_ids) > 1 THEN
    RAISE EXCEPTION 'cannot mix maintenance and corpus items, or different corpus plans';
  END IF;

  v_corpus_plan_id := CASE WHEN v_corpus_plan_ids[1] = '00000000-0000-0000-0000-000000000000'::uuid
                           THEN NULL ELSE v_corpus_plan_ids[1] END;

  INSERT INTO public.expenses (
    expense_date, description, payee_type, payee_name_raw,
    amount, payment_mode, corpus_plan_id, approval_status, created_by
  ) VALUES (
    v_header_date, v_header_desc, 'Other', v_header_payee,
    v_total, v_header_mode, v_corpus_plan_id, 'pending', auth.uid()
  )
  RETURNING id, voucher_no INTO v_expense_id, v_voucher_no;

  INSERT INTO public.expense_line_items (
    expense_id, payee_type, staff_id, vendor_id, payee_name_raw,
    description, category_id, cost_center, amount,
    payment_mode, reference_no, paid_date
  )
  SELECT v_expense_id, payee_type, staff_id, vendor_id, payee_name_raw,
         description, category_id, cost_center, amount,
         payment_mode, reference_no, paid_date
  FROM   public.pending_line_items
  WHERE  id = ANY(p_ids) AND voided_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> cardinality(p_ids) THEN
    RAISE EXCEPTION 'one or more items voided concurrently';
  END IF;

  INSERT INTO public.expense_attachments (expense_id, file_name, file_url, uploaded_by)
  SELECT v_expense_id, attachment_name, attachment_url, auth.uid()
  FROM   public.pending_line_items
  WHERE  id = ANY(p_ids)
    AND  voided_at IS NULL
    AND  attachment_url IS NOT NULL;

  DELETE FROM public.pending_line_items WHERE id = ANY(p_ids) AND voided_at IS NULL;

  RETURN jsonb_build_object('expense_id', v_expense_id, 'voucher_no', v_voucher_no);
END;
$$;

GRANT EXECUTE ON FUNCTION public.bundle_pending_items(uuid[], jsonb) TO authenticated;

-- 2. Attach RPC — same as 034 with the lock split out
CREATE OR REPLACE FUNCTION public.attach_pending_items(
  p_expense_id uuid,
  p_ids        uuid[]
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role            text;
  v_expense_plan    uuid;
  v_count           integer;
  v_mismatch        integer;
  v_attach_count    integer;
BEGIN
  v_role := public.get_my_role();
  IF v_role <> 'admin' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN
    RAISE EXCEPTION 'p_ids must contain at least one item';
  END IF;

  SELECT corpus_plan_id INTO v_expense_plan
  FROM   public.expenses
  WHERE  id = p_expense_id AND voided_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'expense not found or voided';
  END IF;

  -- Lock first (FOR UPDATE cannot be combined with aggregates)
  PERFORM 1
  FROM   public.pending_line_items
  WHERE  id = ANY(p_ids) AND voided_at IS NULL
  FOR UPDATE;

  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE corpus_plan_id IS DISTINCT FROM v_expense_plan)
  INTO   v_count, v_mismatch
  FROM   public.pending_line_items
  WHERE  id = ANY(p_ids) AND voided_at IS NULL;

  IF v_count <> cardinality(p_ids) THEN
    RAISE EXCEPTION 'one or more items not found or voided';
  END IF;

  IF v_mismatch > 0 THEN
    RAISE EXCEPTION 'corpus plan mismatch';
  END IF;

  INSERT INTO public.expense_attachments (expense_id, file_name, file_url, uploaded_by)
  SELECT p_expense_id, attachment_name, attachment_url, auth.uid()
  FROM   public.pending_line_items
  WHERE  id = ANY(p_ids) AND attachment_url IS NOT NULL;

  GET DIAGNOSTICS v_attach_count = ROW_COUNT;

  DELETE FROM public.pending_line_items WHERE id = ANY(p_ids);

  RETURN jsonb_build_object('deleted', v_count, 'attachments', v_attach_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.attach_pending_items(uuid, uuid[]) TO authenticated;
