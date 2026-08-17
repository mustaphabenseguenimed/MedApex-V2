
-- 1. Super admin flag
ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS is_super boolean NOT NULL DEFAULT false;

-- 2. Permission enum + table
DO $$ BEGIN
  CREATE TYPE public.admin_permission AS ENUM (
    'manage_modules','manage_content','manage_quiz',
    'manage_pricing','manage_access','manage_payments'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.admin_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  permission public.admin_permission not null,
  granted_by uuid,
  created_at timestamptz not null default now(),
  unique(user_id, permission)
);
GRANT SELECT ON public.admin_permissions TO authenticated;
GRANT ALL ON public.admin_permissions TO service_role;
ALTER TABLE public.admin_permissions ENABLE ROW LEVEL SECURITY;

-- 3. Helper functions
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role='admin' AND is_super=true);
$$;

CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid, _perm public.admin_permission)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.is_super_admin(_user_id) OR EXISTS(
    SELECT 1 FROM public.admin_permissions WHERE user_id=_user_id AND permission=_perm
  );
$$;

-- 4. RLS on admin_permissions
DROP POLICY IF EXISTS "read own perms or super" ON public.admin_permissions;
DROP POLICY IF EXISTS "super manage perms" ON public.admin_permissions;
CREATE POLICY "read own perms or super" ON public.admin_permissions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_super_admin(auth.uid()));
CREATE POLICY "super manage perms" ON public.admin_permissions FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

-- 5. Make mustaphabensegueni.med@gmail.com super admin
INSERT INTO public.user_roles(user_id, role, is_super)
SELECT id, 'admin', true FROM auth.users WHERE email='mustaphabensegueni.med@gmail.com'
ON CONFLICT (user_id, role) DO UPDATE SET is_super = true;

-- 6. Broaden user_roles visibility so super can list admins
DROP POLICY IF EXISTS "super reads all roles" ON public.user_roles;
CREATE POLICY "super reads all roles" ON public.user_roles FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));

-- 7. Replace blanket admin write policies with permission-gated ones

-- modules
DROP POLICY IF EXISTS "Admins insert modules" ON public.modules;
DROP POLICY IF EXISTS "Admins update modules" ON public.modules;
DROP POLICY IF EXISTS "Admins delete modules" ON public.modules;
CREATE POLICY "perm insert modules" ON public.modules FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(),'manage_modules'));
CREATE POLICY "perm update modules" ON public.modules FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(),'manage_modules'))
  WITH CHECK (public.has_permission(auth.uid(),'manage_modules'));
CREATE POLICY "perm delete modules" ON public.modules FOR DELETE TO authenticated
  USING (public.has_permission(auth.uid(),'manage_modules'));

-- module_contents: quiz vs other
DROP POLICY IF EXISTS "Admins insert contents" ON public.module_contents;
DROP POLICY IF EXISTS "Admins update contents" ON public.module_contents;
DROP POLICY IF EXISTS "Admins delete contents" ON public.module_contents;
CREATE POLICY "perm insert contents" ON public.module_contents FOR INSERT TO authenticated
  WITH CHECK (
    (kind='quiz' AND public.has_permission(auth.uid(),'manage_quiz'))
    OR (kind<>'quiz' AND public.has_permission(auth.uid(),'manage_content'))
  );
CREATE POLICY "perm update contents" ON public.module_contents FOR UPDATE TO authenticated
  USING (
    (kind='quiz' AND public.has_permission(auth.uid(),'manage_quiz'))
    OR (kind<>'quiz' AND public.has_permission(auth.uid(),'manage_content'))
  )
  WITH CHECK (
    (kind='quiz' AND public.has_permission(auth.uid(),'manage_quiz'))
    OR (kind<>'quiz' AND public.has_permission(auth.uid(),'manage_content'))
  );
CREATE POLICY "perm delete contents" ON public.module_contents FOR DELETE TO authenticated
  USING (
    (kind='quiz' AND public.has_permission(auth.uid(),'manage_quiz'))
    OR (kind<>'quiz' AND public.has_permission(auth.uid(),'manage_content'))
  );

-- pricing_config
DROP POLICY IF EXISTS "Admins insert pricing_config" ON public.pricing_config;
DROP POLICY IF EXISTS "Admins update pricing_config" ON public.pricing_config;
CREATE POLICY "perm insert pricing_config" ON public.pricing_config FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(),'manage_pricing'));
CREATE POLICY "perm update pricing_config" ON public.pricing_config FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(),'manage_pricing'))
  WITH CHECK (public.has_permission(auth.uid(),'manage_pricing'));

-- year_prices
DROP POLICY IF EXISTS "Admins insert year_prices" ON public.year_prices;
DROP POLICY IF EXISTS "Admins update year_prices" ON public.year_prices;
CREATE POLICY "perm insert year_prices" ON public.year_prices FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(),'manage_pricing'));
CREATE POLICY "perm update year_prices" ON public.year_prices FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(),'manage_pricing'))
  WITH CHECK (public.has_permission(auth.uid(),'manage_pricing'));

-- user_entitlements
DROP POLICY IF EXISTS "Admins insert entitlements" ON public.user_entitlements;
DROP POLICY IF EXISTS "Admins delete entitlements" ON public.user_entitlements;
DROP POLICY IF EXISTS "Users read own entitlements" ON public.user_entitlements;
CREATE POLICY "perm insert entitlements" ON public.user_entitlements FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(),'manage_access'));
CREATE POLICY "perm delete entitlements" ON public.user_entitlements FOR DELETE TO authenticated
  USING (public.has_permission(auth.uid(),'manage_access'));
CREATE POLICY "read own or access entitlements" ON public.user_entitlements FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_permission(auth.uid(),'manage_access'));

-- payment_methods
DROP POLICY IF EXISTS "admins manage payment methods" ON public.payment_methods;
CREATE POLICY "perm manage payment methods" ON public.payment_methods FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(),'manage_payments'))
  WITH CHECK (public.has_permission(auth.uid(),'manage_payments'));

-- payment_requests
DROP POLICY IF EXISTS "admins update requests" ON public.payment_requests;
DROP POLICY IF EXISTS "admins delete requests" ON public.payment_requests;
DROP POLICY IF EXISTS "users see their own requests" ON public.payment_requests;
CREATE POLICY "perm update requests" ON public.payment_requests FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(),'manage_payments'))
  WITH CHECK (public.has_permission(auth.uid(),'manage_payments'));
CREATE POLICY "perm delete requests" ON public.payment_requests FOR DELETE TO authenticated
  USING (public.has_permission(auth.uid(),'manage_payments'));
CREATE POLICY "see own or perm requests" ON public.payment_requests FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_permission(auth.uid(),'manage_payments'));

-- 8. Update approve/reject payment RPCs to require manage_payments
CREATE OR REPLACE FUNCTION public.approve_payment_request(_request_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
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
END; $$;

CREATE OR REPLACE FUNCTION public.reject_payment_request(_request_id uuid, _reason text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.has_permission(auth.uid(),'manage_payments') THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.payment_requests
    SET status='rejected', reviewer_id=auth.uid(), reviewed_at=now(), reject_reason=_reason
    WHERE id=_request_id AND status='pending';
END; $$;

-- 9. Super-only RPCs to manage admins
CREATE OR REPLACE FUNCTION public.promote_admin(_email text, _perms public.admin_permission[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
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
  RETURN _uid;
END; $$;

CREATE OR REPLACE FUNCTION public.revoke_admin(_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF public.is_super_admin(_user_id) THEN RAISE EXCEPTION 'cannot revoke super admin'; END IF;
  DELETE FROM public.admin_permissions WHERE user_id=_user_id;
  DELETE FROM public.user_roles WHERE user_id=_user_id AND role='admin';
END; $$;

CREATE OR REPLACE FUNCTION public.list_admins()
RETURNS TABLE(user_id uuid, email text, is_super boolean, permissions text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT ur.user_id, u.email::text, ur.is_super,
    COALESCE(ARRAY_AGG(ap.permission::text) FILTER (WHERE ap.permission IS NOT NULL), ARRAY[]::text[])
  FROM public.user_roles ur
  LEFT JOIN auth.users u ON u.id = ur.user_id
  LEFT JOIN public.admin_permissions ap ON ap.user_id = ur.user_id
  WHERE ur.role='admin' AND public.is_super_admin(auth.uid())
  GROUP BY ur.user_id, u.email, ur.is_super
  ORDER BY ur.is_super DESC, u.email;
$$;

GRANT EXECUTE ON FUNCTION public.promote_admin(text, public.admin_permission[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_admins() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_permission(uuid, public.admin_permission) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated;
