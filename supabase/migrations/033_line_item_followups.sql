-- 033: Line item follow-ups
--   1. Per-item paid date on bundled line items (nullable; UI falls back to header date)
--   2. Optional single receipt per pending item
--   3. Bundle RPC carries paid_date + attachment over

-- 1. Per-item paid date
ALTER TABLE public.expense_line_items
  ADD COLUMN IF NOT EXISTS paid_date date;

-- 2. Receipt on pending items
ALTER TABLE public.pending_line_items
  ADD COLUMN IF NOT EXISTS attachment_url  text,
  ADD COLUMN IF NOT EXISTS attachment_name text;

-- 3. Bundle RPC — replace in place (same signature)
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

  -- Copy line items (now includes paid_date)
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

  -- Promote pending attachments to the bundled expense
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
