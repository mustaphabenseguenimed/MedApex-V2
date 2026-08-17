
-- Private schema not exposed by the Data API
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

-- =========================================================
-- Helpers used by RLS/triggers
-- =========================================================

-- has_role
CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role=_role)
$$;
REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT private.has_role(_user_id, _role)
$$;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

-- is_super_admin
CREATE OR REPLACE FUNCTION private.is_super_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role='admin' AND is_super=true)
$$;
REVOKE ALL ON FUNCTION private.is_super_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_super_admin(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT private.is_super_admin(_user_id)
$$;
REVOKE ALL ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated, service_role;

-- has_permission
CREATE OR REPLACE FUNCTION private.has_permission(_user_id uuid, _perm public.admin_permission)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.is_super_admin(_user_id) OR EXISTS(
    SELECT 1 FROM public.admin_permissions WHERE user_id=_user_id AND permission=_perm
  )
$$;
REVOKE ALL ON FUNCTION private.has_permission(uuid, public.admin_permission) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.has_permission(uuid, public.admin_permission) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid, _perm public.admin_permission)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT private.has_permission(_user_id, _perm)
$$;
REVOKE ALL ON FUNCTION public.has_permission(uuid, public.admin_permission) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_permission(uuid, public.admin_permission) TO authenticated, service_role;

-- user_has_year_access
CREATE OR REPLACE FUNCTION private.user_has_year_access(_user_id uuid, _year smallint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.has_role(_user_id, 'admin')
    OR EXISTS (
      SELECT 1 FROM public.user_entitlements
      WHERE user_id = _user_id
        AND (is_bundle = true OR year = _year)
        AND (expires_at IS NULL OR expires_at > now())
    )
$$;
REVOKE ALL ON FUNCTION private.user_has_year_access(uuid, smallint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.user_has_year_access(uuid, smallint) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.user_has_year_access(_user_id uuid, _year smallint)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT private.user_has_year_access(_user_id, _year)
$$;
REVOKE ALL ON FUNCTION public.user_has_year_access(uuid, smallint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_has_year_access(uuid, smallint) TO authenticated, service_role;

-- user_has_module_access
CREATE OR REPLACE FUNCTION private.user_has_module_access(_user_id uuid, _module_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.has_role(_user_id, 'admin') OR EXISTS (
    SELECT 1 FROM public.modules m
    JOIN public.user_entitlements ue ON ue.user_id = _user_id
    WHERE m.id = _module_id
      AND (ue.is_bundle = true OR ue.year = m.year)
      AND (ue.expires_at IS NULL OR ue.expires_at > now())
  )
$$;
REVOKE ALL ON FUNCTION private.user_has_module_access(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.user_has_module_access(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.user_has_module_access(_user_id uuid, _module_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT private.user_has_module_access(_user_id, _module_id)
$$;
REVOKE ALL ON FUNCTION public.user_has_module_access(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_has_module_access(uuid, uuid) TO authenticated, service_role;

-- log_admin_action (internal only)
CREATE OR REPLACE FUNCTION private.log_admin_action(_action text, _target_type text, _target_id text, _details jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _email TEXT;
BEGIN
  IF _uid IS NULL THEN RETURN; END IF;
  SELECT email::text INTO _email FROM auth.users WHERE id = _uid;
  INSERT INTO public.admin_audit_log(actor_id, actor_email, action, target_type, target_id, details)
  VALUES (_uid, _email, _action, _target_type, _target_id, _details);
END;
$$;
REVOKE ALL ON FUNCTION private.log_admin_action(text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.log_admin_action(text, text, text, jsonb) TO service_role;

-- Drop unused public copy (not called from outside)
DROP FUNCTION IF EXISTS public.log_admin_action(text, text, text, jsonb);

-- =========================================================
-- RPCs called from the client via supabase.rpc(...)
-- Public wrapper = SECURITY INVOKER; private impl = SECURITY DEFINER
-- =========================================================

-- claim_admin
CREATE OR REPLACE FUNCTION private.claim_admin()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid();
BEGIN
  IF _uid IS NULL THEN RETURN FALSE; END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN RETURN FALSE; END IF;
  INSERT INTO public.user_roles(user_id, role) VALUES (_uid, 'admin') ON CONFLICT DO NOTHING;
  RETURN TRUE;
END; $$;
REVOKE ALL ON FUNCTION private.claim_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.claim_admin() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_admin()
RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  SELECT private.claim_admin()
$$;
REVOKE ALL ON FUNCTION public.claim_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_admin() TO authenticated, service_role;

-- promote_admin
CREATE OR REPLACE FUNCTION private.promote_admin(_email text, _perms public.admin_permission[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid; _p public.admin_permission;
BEGIN
  IF NOT private.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT id INTO _uid FROM auth.users WHERE lower(email)=lower(_email);
  IF _uid IS NULL THEN RAISE EXCEPTION 'user not found'; END IF;
  INSERT INTO public.user_roles(user_id, role) VALUES (_uid,'admin') ON CONFLICT DO NOTHING;
  DELETE FROM public.admin_permissions WHERE user_id=_uid;
  IF _perms IS NOT NULL THEN
    FOREACH _p IN ARRAY _perms LOOP
      INSERT INTO public.admin_permissions(user_id, permission, granted_by)
        VALUES (_uid, _p, auth.uid()) ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;
  PERFORM private.log_admin_action('promote_admin', 'user_roles', _uid::text,
    jsonb_build_object('email', _email, 'permissions', _perms));
  RETURN _uid;
END; $$;
REVOKE ALL ON FUNCTION private.promote_admin(text, public.admin_permission[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.promote_admin(text, public.admin_permission[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.promote_admin(_email text, _perms public.admin_permission[])
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  SELECT private.promote_admin(_email, _perms)
$$;
REVOKE ALL ON FUNCTION public.promote_admin(text, public.admin_permission[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.promote_admin(text, public.admin_permission[]) TO authenticated, service_role;

-- revoke_admin
CREATE OR REPLACE FUNCTION private.revoke_admin(_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT private.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF private.is_super_admin(_user_id) THEN RAISE EXCEPTION 'cannot revoke super admin'; END IF;
  DELETE FROM public.admin_permissions WHERE user_id=_user_id;
  DELETE FROM public.user_roles WHERE user_id=_user_id AND role='admin';
  PERFORM private.log_admin_action('revoke_admin', 'user_roles', _user_id::text, NULL);
END; $$;
REVOKE ALL ON FUNCTION private.revoke_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.revoke_admin(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.revoke_admin(_user_id uuid)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  SELECT private.revoke_admin(_user_id)
$$;
REVOKE ALL ON FUNCTION public.revoke_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_admin(uuid) TO authenticated, service_role;

-- list_admins
CREATE OR REPLACE FUNCTION private.list_admins()
RETURNS TABLE(user_id uuid, email text, is_super boolean, permissions text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ur.user_id, u.email::text, ur.is_super,
    COALESCE(ARRAY_AGG(ap.permission::text) FILTER (WHERE ap.permission IS NOT NULL), ARRAY[]::text[])
  FROM public.user_roles ur
  LEFT JOIN auth.users u ON u.id = ur.user_id
  LEFT JOIN public.admin_permissions ap ON ap.user_id = ur.user_id
  WHERE ur.role='admin' AND private.is_super_admin(auth.uid())
  GROUP BY ur.user_id, u.email, ur.is_super
  ORDER BY ur.is_super DESC, u.email
$$;
REVOKE ALL ON FUNCTION private.list_admins() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.list_admins() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_admins()
RETURNS TABLE(user_id uuid, email text, is_super boolean, permissions text[])
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT * FROM private.list_admins()
$$;
REVOKE ALL ON FUNCTION public.list_admins() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_admins() TO authenticated, service_role;

-- approve_payment_request
CREATE OR REPLACE FUNCTION private.approve_payment_request(_request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _req public.payment_requests%ROWTYPE; _exp TIMESTAMPTZ;
BEGIN
  IF NOT private.has_permission(auth.uid(),'manage_payments') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO _req FROM public.payment_requests WHERE id = _request_id FOR UPDATE;
  IF _req.id IS NULL THEN RAISE EXCEPTION 'not found'; END IF;
  IF _req.status <> 'pending' THEN RAISE EXCEPTION 'already reviewed'; END IF;
  _exp := CASE WHEN _req.is_bundle
    THEN TIMESTAMPTZ '2026-10-31 22:59:59+00'
    ELSE TIMESTAMPTZ '2026-08-31 22:59:59+00'
  END;
  INSERT INTO public.user_entitlements (user_id, year, is_bundle, granted_by, note, expires_at)
  VALUES (_req.user_id, CASE WHEN _req.is_bundle THEN NULL ELSE _req.year END, _req.is_bundle, auth.uid(),
    'Paiement approuvé #' || _req.id, _exp);
  UPDATE public.payment_requests
    SET status='approved', reviewer_id=auth.uid(), reviewed_at=now()
    WHERE id=_request_id;
  PERFORM private.log_admin_action('approve_payment', 'payment_requests', _request_id::text,
    jsonb_build_object('user_id', _req.user_id, 'is_bundle', _req.is_bundle, 'year', _req.year, 'amount_dzd', _req.amount_dzd, 'expires_at', _exp));
END; $$;
REVOKE ALL ON FUNCTION private.approve_payment_request(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.approve_payment_request(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.approve_payment_request(_request_id uuid)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  SELECT private.approve_payment_request(_request_id)
$$;
REVOKE ALL ON FUNCTION public.approve_payment_request(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_payment_request(uuid) TO authenticated, service_role;

-- reject_payment_request
CREATE OR REPLACE FUNCTION private.reject_payment_request(_request_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _req public.payment_requests%ROWTYPE;
BEGIN
  IF NOT private.has_permission(auth.uid(),'manage_payments') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO _req FROM public.payment_requests WHERE id = _request_id;
  UPDATE public.payment_requests
    SET status='rejected', reviewer_id=auth.uid(), reviewed_at=now(), reject_reason=_reason
    WHERE id=_request_id AND status='pending';
  PERFORM private.log_admin_action('reject_payment', 'payment_requests', _request_id::text,
    jsonb_build_object('user_id', _req.user_id, 'reason', _reason, 'amount_dzd', _req.amount_dzd));
END; $$;
REVOKE ALL ON FUNCTION private.reject_payment_request(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.reject_payment_request(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reject_payment_request(_request_id uuid, _reason text)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  SELECT private.reject_payment_request(_request_id, _reason)
$$;
REVOKE ALL ON FUNCTION public.reject_payment_request(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_payment_request(uuid, text) TO authenticated, service_role;
