
-- 1. Add expires_at column
ALTER TABLE public.user_entitlements
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Backfill (Africa/Algiers = UTC+1 no DST → 22:59:59 UTC)
UPDATE public.user_entitlements
  SET expires_at = CASE
    WHEN is_bundle THEN TIMESTAMPTZ '2026-10-31 22:59:59+00'
    ELSE TIMESTAMPTZ '2026-08-31 22:59:59+00'
  END
  WHERE expires_at IS NULL;

-- 2. Update approve_payment_request to set expires_at
CREATE OR REPLACE FUNCTION public.approve_payment_request(_request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _req public.payment_requests%ROWTYPE; _exp TIMESTAMPTZ;
BEGIN
  IF NOT public.has_permission(auth.uid(),'manage_payments') THEN RAISE EXCEPTION 'forbidden'; END IF;
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
  PERFORM public.log_admin_action('approve_payment', 'payment_requests', _request_id::text,
    jsonb_build_object('user_id', _req.user_id, 'is_bundle', _req.is_bundle, 'year', _req.year, 'amount_dzd', _req.amount_dzd, 'expires_at', _exp));
END; $function$;

-- 3. Update access checks to honor expiry
CREATE OR REPLACE FUNCTION public.user_has_year_access(_user_id uuid, _year smallint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    public.has_role(_user_id, 'admin')
    OR EXISTS (
      SELECT 1 FROM public.user_entitlements
      WHERE user_id = _user_id
        AND (is_bundle = true OR year = _year)
        AND (expires_at IS NULL OR expires_at > now())
    );
$function$;

CREATE OR REPLACE FUNCTION public.user_has_module_access(_user_id uuid, _module_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.has_role(_user_id, 'admin') OR EXISTS (
    SELECT 1 FROM public.modules m
    JOIN public.user_entitlements ue ON ue.user_id = _user_id
    WHERE m.id = _module_id
      AND (ue.is_bundle = true OR ue.year = m.year)
      AND (ue.expires_at IS NULL OR ue.expires_at > now())
  );
$function$;

-- 4. Sales close deadline trigger on payment_requests
CREATE OR REPLACE FUNCTION public.enforce_sales_deadline()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE _deadline TIMESTAMPTZ;
BEGIN
  IF public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;
  _deadline := CASE WHEN NEW.is_bundle
    THEN TIMESTAMPTZ '2026-10-31 22:59:59+00'
    ELSE TIMESTAMPTZ '2026-08-31 22:59:59+00'
  END;
  IF now() > _deadline THEN
    RAISE EXCEPTION 'sales_closed';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_payment_requests_deadline ON public.payment_requests;
CREATE TRIGGER trg_payment_requests_deadline
  BEFORE INSERT ON public.payment_requests
  FOR EACH ROW EXECUTE FUNCTION public.enforce_sales_deadline();
