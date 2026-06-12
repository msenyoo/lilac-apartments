-- 032: Pending line items — capture small payments individually, bundle later

-- 1. Pending items table
CREATE TABLE IF NOT EXISTS public.pending_line_items (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  paid_date       date NOT NULL,
  description     text NOT NULL,
  amount          integer NOT NULL CHECK (amount > 0),
  payment_mode    text NOT NULL CHECK (payment_mode IN ('Cash','Online','Bank Transfer','Cheque')),
  reference_no    text,
  payee_type      text NOT NULL CHECK (payee_type IN ('Staff','Vendor','Utility','Municipal','Other')),
  staff_id        uuid REFERENCES public.staff(id),
  vendor_id       uuid REFERENCES public.vendors(id),
  payee_name_raw  text,
  category_id     uuid REFERENCES public.expense_categories(id),
  cost_center     text NOT NULL,
  corpus_plan_id  uuid REFERENCES public.corpus_plans(id),
  notes           text,
  created_at      timestamptz DEFAULT now(),
  created_by      uuid REFERENCES public.profiles(id),
  voided_at       timestamptz,
  voided_by       uuid REFERENCES public.profiles(id),
  void_reason     text
);

CREATE INDEX IF NOT EXISTS idx_pending_items_date   ON public.pending_line_items(paid_date DESC);
CREATE INDEX IF NOT EXISTS idx_pending_items_active ON public.pending_line_items(voided_at) WHERE voided_at IS NULL;

-- 2. Extend expense_line_items so bundled rows preserve mode + reference
ALTER TABLE public.expense_line_items
  ADD COLUMN IF NOT EXISTS payment_mode text
  CHECK (payment_mode IS NULL OR payment_mode IN ('Cash','Online','Bank Transfer','Cheque'));

ALTER TABLE public.expense_line_items
  ADD COLUMN IF NOT EXISTS reference_no text;

-- 3. Audit trigger (mirrors pattern from 012/016)
DROP TRIGGER IF EXISTS trg_audit_pending_line_items ON public.pending_line_items;
CREATE TRIGGER trg_audit_pending_line_items
  AFTER INSERT OR UPDATE OR DELETE ON public.pending_line_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

-- 4. RLS
ALTER TABLE public.pending_line_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pending_items_select" ON public.pending_line_items;
CREATE POLICY "pending_items_select" ON public.pending_line_items
  FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin', 'committee', 'auditor'));

DROP POLICY IF EXISTS "pending_items_insert" ON public.pending_line_items;
CREATE POLICY "pending_items_insert" ON public.pending_line_items
  FOR INSERT TO authenticated
  WITH CHECK (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "pending_items_update" ON public.pending_line_items;
CREATE POLICY "pending_items_update" ON public.pending_line_items
  FOR UPDATE TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "pending_items_delete" ON public.pending_line_items;
CREATE POLICY "pending_items_delete" ON public.pending_line_items
  FOR DELETE TO authenticated
  USING (public.get_my_role() = 'admin');

-- 5. Bundle RPC
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
  -- Auth
  v_role := public.get_my_role();
  IF v_role <> 'admin' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Input guard
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN
    RAISE EXCEPTION 'p_ids must contain at least one item';
  END IF;

  -- Parse header
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

  -- Validate selection: exists, not voided, consistent corpus_plan_id
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

  -- Create expense header
  INSERT INTO public.expenses (
    expense_date, description, payee_type, payee_name_raw,
    amount, payment_mode, corpus_plan_id, approval_status, created_by
  ) VALUES (
    v_header_date, v_header_desc, 'Other', v_header_payee,
    v_total, v_header_mode, v_corpus_plan_id, 'pending', auth.uid()
  )
  RETURNING id, voucher_no INTO v_expense_id, v_voucher_no;

  -- Copy pending rows → expense_line_items (re-assert not-voided to close TOCTOU race)
  INSERT INTO public.expense_line_items (
    expense_id, payee_type, staff_id, vendor_id, payee_name_raw,
    description, category_id, cost_center, amount,
    payment_mode, reference_no
  )
  SELECT v_expense_id, payee_type, staff_id, vendor_id, payee_name_raw,
         description, category_id, cost_center, amount,
         payment_mode, reference_no
  FROM   public.pending_line_items
  WHERE  id = ANY(p_ids) AND voided_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> cardinality(p_ids) THEN
    RAISE EXCEPTION 'one or more items voided concurrently';
  END IF;

  -- Hard-delete the originals (same guard)
  DELETE FROM public.pending_line_items WHERE id = ANY(p_ids) AND voided_at IS NULL;

  RETURN jsonb_build_object('expense_id', v_expense_id, 'voucher_no', v_voucher_no);
END;
$$;

GRANT EXECUTE ON FUNCTION public.bundle_pending_items(uuid[], jsonb) TO authenticated;
