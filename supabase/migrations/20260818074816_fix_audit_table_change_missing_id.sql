-- audit_table_change() assumed every audited table has an "id" column
-- (NEW.id / OLD.id), but year_prices is keyed on "year" and has no "id"
-- column at all, so every INSERT/UPDATE on year_prices raised:
--   42703 record "new" has no field "id"
-- Use to_jsonb(...)->>'id' instead, which safely evaluates to NULL for
-- tables that don't have that column, instead of raising.
CREATE OR REPLACE FUNCTION public.audit_table_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
  _email TEXT;
  _target_id TEXT;
  _details JSONB;
BEGIN
  IF _uid IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  SELECT email::text INTO _email FROM auth.users WHERE id = _uid;

  IF TG_OP = 'DELETE' THEN
    _target_id := COALESCE(to_jsonb(OLD)->>'id', '');
    _details := jsonb_build_object('old', to_jsonb(OLD));
  ELSIF TG_OP = 'INSERT' THEN
    _target_id := COALESCE(to_jsonb(NEW)->>'id', '');
    _details := jsonb_build_object('new', to_jsonb(NEW));
  ELSE
    _target_id := COALESCE(to_jsonb(NEW)->>'id', '');
    _details := jsonb_build_object('old', to_jsonb(OLD), 'new', to_jsonb(NEW));
  END IF;

  INSERT INTO public.admin_audit_log(actor_id, actor_email, action, target_type, target_id, details)
  VALUES (_uid, _email, TG_OP || ' ' || TG_TABLE_NAME, TG_TABLE_NAME, _target_id, _details);

  RETURN COALESCE(NEW, OLD);
END;
$$;
