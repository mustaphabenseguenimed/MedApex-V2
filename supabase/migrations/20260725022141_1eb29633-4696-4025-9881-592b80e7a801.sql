
-- Audit log table
CREATE TABLE public.admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID,
  actor_email TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX admin_audit_log_created_at_idx ON public.admin_audit_log (created_at DESC);
CREATE INDEX admin_audit_log_actor_idx ON public.admin_audit_log (actor_id);
CREATE INDEX admin_audit_log_target_idx ON public.admin_audit_log (target_type, target_id);

GRANT SELECT ON public.admin_audit_log TO authenticated;
GRANT ALL ON public.admin_audit_log TO service_role;

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

-- Only super admin can read
CREATE POLICY "Super admin reads audit log"
  ON public.admin_audit_log FOR SELECT
  TO authenticated
  USING (public.is_super_admin(auth.uid()));

-- No direct insert/update/delete from clients (only SECURITY DEFINER functions & triggers)

-- Central logging function
CREATE OR REPLACE FUNCTION public.log_admin_action(
  _action TEXT, _target_type TEXT, _target_id TEXT, _details JSONB
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid UUID := auth.uid(); _email TEXT;
BEGIN
  IF _uid IS NULL THEN RETURN; END IF;
  SELECT email::text INTO _email FROM auth.users WHERE id = _uid;
  INSERT INTO public.admin_audit_log(actor_id, actor_email, action, target_type, target_id, details)
  VALUES (_uid, _email, _action, _target_type, _target_id, _details);
END;
$$;

-- Generic trigger function for logging table changes
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
    _target_id := COALESCE(OLD.id::text, '');
    _details := jsonb_build_object('old', to_jsonb(OLD));
  ELSIF TG_OP = 'INSERT' THEN
    _target_id := COALESCE(NEW.id::text, '');
    _details := jsonb_build_object('new', to_jsonb(NEW));
  ELSE
    _target_id := COALESCE(NEW.id::text, '');
    _details := jsonb_build_object('old', to_jsonb(OLD), 'new', to_jsonb(NEW));
  END IF;

  INSERT INTO public.admin_audit_log(actor_id, actor_email, action, target_type, target_id, details)
  VALUES (_uid, _email, TG_OP || ' ' || TG_TABLE_NAME, TG_TABLE_NAME, _target_id, _details);

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Attach triggers to admin-managed tables
CREATE TRIGGER audit_modules AFTER INSERT OR UPDATE OR DELETE ON public.modules
  FOR EACH ROW EXECUTE FUNCTION public.audit_table_change();
CREATE TRIGGER audit_module_contents AFTER INSERT OR UPDATE OR DELETE ON public.module_contents
  FOR EACH ROW EXECUTE FUNCTION public.audit_table_change();
CREATE TRIGGER audit_year_prices AFTER INSERT OR UPDATE OR DELETE ON public.year_prices
  FOR EACH ROW EXECUTE FUNCTION public.audit_table_change();
CREATE TRIGGER audit_pricing_config AFTER INSERT OR UPDATE OR DELETE ON public.pricing_config
  FOR EACH ROW EXECUTE FUNCTION public.audit_table_change();
CREATE TRIGGER audit_user_entitlements AFTER INSERT OR UPDATE OR DELETE ON public.user_entitlements
  FOR EACH ROW EXECUTE FUNCTION public.audit_table_change();
CREATE TRIGGER audit_payment_methods AFTER INSERT OR UPDATE OR DELETE ON public.payment_methods
  FOR EACH ROW EXECUTE FUNCTION public.audit_table_change();
CREATE TRIGGER audit_admin_permissions AFTER INSERT OR UPDATE OR DELETE ON public.admin_permissions
  FOR EACH ROW EXECUTE FUNCTION public.audit_table_change();
CREATE TRIGGER audit_user_roles AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.audit_table_change();

-- Update payment approval/rejection RPCs to log
CREATE OR REPLACE FUNCTION public.approve_payment_request(_request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _req public.payment_requests%ROWTYPE;
BEGIN
  IF NOT public.has_permission(auth.uid(),'manage_payments') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO _req FROM public.payment_requests WHERE id = _request_id FOR UPDATE;
  IF _req.id IS NULL THEN RAISE EXCEPTION 'not found'; END IF;
  IF _req.status <> 'pending' THEN RAISE EXCEPTION 'already reviewed'; END IF;
  INSERT INTO public.user_entitlements (user_id, year, is_bundle, granted_by, note)
  VALUES (_req.user_id, CASE WHEN _req.is_bundle THEN NULL ELSE _req.year END, _req.is_bundle, auth.uid(),
    'Paiement approuvé #' || _req.id);
  UPDATE public.payment_requests
    SET status='approved', reviewer_id=auth.uid(), reviewed_at=now()
    WHERE id=_request_id;
  PERFORM public.log_admin_action('approve_payment', 'payment_requests', _request_id::text,
    jsonb_build_object('user_id', _req.user_id, 'is_bundle', _req.is_bundle, 'year', _req.year, 'amount_dzd', _req.amount_dzd));
END; $function$;

CREATE OR REPLACE FUNCTION public.reject_payment_request(_request_id uuid, _reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _req public.payment_requests%ROWTYPE;
BEGIN
  IF NOT public.has_permission(auth.uid(),'manage_payments') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO _req FROM public.payment_requests WHERE id = _request_id;
  UPDATE public.payment_requests
    SET status='rejected', reviewer_id=auth.uid(), reviewed_at=now(), reject_reason=_reason
    WHERE id=_request_id AND status='pending';
  PERFORM public.log_admin_action('reject_payment', 'payment_requests', _request_id::text,
    jsonb_build_object('user_id', _req.user_id, 'reason', _reason, 'amount_dzd', _req.amount_dzd));
END; $function$;

CREATE OR REPLACE FUNCTION public.promote_admin(_email text, _perms admin_permission[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid; _p public.admin_permission;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT id INTO _uid FROM auth.users WHERE lower(email)=lower(_email);
  IF _uid IS NULL THEN RAISE EXCEPTION 'user not found'; END IF;
  INSERT INTO public.user_roles(user_id, role) VALUES (_uid,'admin') ON CONFLICT DO NOTHING;
  DELETE FROM public.admin_permissions WHERE user_id=_uid;
  IF _perms IS NOT NULL THEN
    FOREACH _p IN ARRAY _perms LOOP
      INSERT INTO public.admin_permissions(user_id, permission, granted_by)
        VALUES (_uid, _p, auth.uid())
        ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;
  PERFORM public.log_admin_action('promote_admin', 'user_roles', _uid::text,
    jsonb_build_object('email', _email, 'permissions', _perms));
  RETURN _uid;
END; $function$;

CREATE OR REPLACE FUNCTION public.revoke_admin(_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF public.is_super_admin(_user_id) THEN RAISE EXCEPTION 'cannot revoke super admin'; END IF;
  DELETE FROM public.admin_permissions WHERE user_id=_user_id;
  DELETE FROM public.user_roles WHERE user_id=_user_id AND role='admin';
  PERFORM public.log_admin_action('revoke_admin', 'user_roles', _user_id::text, NULL);
END; $function$;
