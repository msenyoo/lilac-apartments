-- Fix fn_audit_trigger to handle tables where the primary key is not named 'id'
-- (e.g. user_roles uses 'user_id'). Uses JSONB extraction so it works for any table.
CREATE OR REPLACE FUNCTION public.fn_audit_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_record_id uuid;
  v_old_val   jsonb;
  v_new_val   jsonb;
  v_row       jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_row     := to_jsonb(OLD);
    v_old_val := v_row;
  ELSIF TG_OP = 'UPDATE' THEN
    v_row     := to_jsonb(NEW);
    v_old_val := to_jsonb(OLD);
    v_new_val := v_row;
  ELSE
    v_row     := to_jsonb(NEW);
    v_new_val := v_row;
  END IF;

  -- Fall back to 'user_id' for tables that don't have an 'id' column
  v_record_id := COALESCE(
    (v_row->>'id')::uuid,
    (v_row->>'user_id')::uuid
  );

  INSERT INTO public.audit_log
    (user_id, user_email, action, table_name, record_id, old_val, new_val)
  VALUES
    (auth.uid(), auth.email(), TG_OP, TG_TABLE_NAME, v_record_id, v_old_val, v_new_val);

  RETURN COALESCE(NEW, OLD);
END;
$$;
