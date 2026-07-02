-- 034: Attach pending items to an existing expense
--   Client writes the line items (with any user edits); this RPC only
--   locks + validates the pending rows, promotes their receipts, and
--   hard-deletes the originals.

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

  -- Lock + validate the pending rows
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE corpus_plan_id IS DISTINCT FROM v_expense_plan)
  INTO   v_count, v_mismatch
  FROM   public.pending_line_items
  WHERE  id = ANY(p_ids) AND voided_at IS NULL
  FOR UPDATE;

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
