-- 022: flat_arrears table + FY rollover + corpus closure RPCs

CREATE TABLE public.flat_arrears (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flat_id      uuid NOT NULL REFERENCES public.flats(id) ON DELETE CASCADE,
  arrears_type text NOT NULL CHECK (arrears_type IN ('maintenance', 'corpus')),
  source_label text NOT NULL,
  amount       integer NOT NULL CHECK (amount > 0),
  notes        text,
  created_at   timestamptz DEFAULT now(),
  created_by   uuid NOT NULL REFERENCES auth.users(id),
  UNIQUE (flat_id, arrears_type, source_label)
);

CREATE INDEX idx_flat_arrears_flat_id ON public.flat_arrears (flat_id);

ALTER TABLE public.flat_arrears ENABLE ROW LEVEL SECURITY;

CREATE POLICY "flat_arrears_read" ON public.flat_arrears
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'committee', 'auditor')
    OR flat_id = public.get_my_flat_id()
  );

CREATE POLICY "flat_arrears_admin_write" ON public.flat_arrears
  FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

-- RPC: advance_fiscal_year
CREATE OR REPLACE FUNCTION public.advance_fiscal_year()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  old_fy integer;
  new_fy integer;
  n      integer;
BEGIN
  SELECT value::integer INTO old_fy
    FROM app_settings WHERE key = 'dues_start_fiscal_year';
  new_fy := old_fy + 1;

  INSERT INTO flat_arrears (flat_id, arrears_type, source_label, amount, created_by)
  SELECT
    f.id,
    'maintenance',
    'FY ' || old_fy || '-' || RIGHT((old_fy + 1)::text, 2),
    vdt.pending::integer,
    auth.uid()
  FROM v_dues_tracker vdt
  JOIN flats f ON f.code = vdt.flat_code
  WHERE vdt.pending > 0
  ON CONFLICT (flat_id, arrears_type, source_label) DO NOTHING;

  GET DIAGNOSTICS n = ROW_COUNT;

  UPDATE app_settings SET value = new_fy::text
    WHERE key = 'dues_start_fiscal_year';

  RETURN json_build_object('new_fy', new_fy, 'arrears_created', n);
END;
$$;

-- RPC: close_corpus_plan
CREATE OR REPLACE FUNCTION public.close_corpus_plan(p_plan_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  plan_name_val text;
  n             integer;
BEGIN
  SELECT name INTO plan_name_val FROM corpus_plans WHERE id = p_plan_id;

  INSERT INTO flat_arrears (flat_id, arrears_type, source_label, amount, created_by)
  SELECT
    f.id,
    'corpus',
    plan_name_val,
    vct.balance::integer,
    auth.uid()
  FROM v_corpus_tracker vct
  JOIN flats f ON f.code = vct.flat_code
  WHERE vct.plan_id = p_plan_id AND vct.balance > 0
  ON CONFLICT (flat_id, arrears_type, source_label) DO NOTHING;

  GET DIAGNOSTICS n = ROW_COUNT;

  UPDATE corpus_plans
    SET status = 'completed', closed_at = now()
    WHERE id = p_plan_id;

  RETURN json_build_object('arrears_created', n);
END;
$$;
