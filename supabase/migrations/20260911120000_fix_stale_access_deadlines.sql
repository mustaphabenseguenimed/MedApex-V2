-- Bug: private.claim_free_offer and private.approve_payment_request both
-- hardcoded the same two expiry dates as src/lib/deadlines.ts
-- (2026-08-31 for a single year, 2026-10-31 for the bundle). Those dates
-- marked the end of the 2025-2026 academic year and were never rolled
-- forward. Once today passed 2026-08-31, every NEW individual-year
-- entitlement -- whether from a user claiming a free offer or an admin
-- approving a paid request -- was granted with expires_at already in the
-- past, so private.user_has_module_scope's `expires_at > now()` check
-- failed immediately and the user saw no lessons and no questions right
-- after "getting" access.
--
-- This migration (1) moves both functions to the 2026-2027 dates that
-- src/lib/deadlines.ts now uses, and (2) repairs existing rows that were
-- stamped with the old, already-expired dates by extending them to the new
-- deadline -- so anyone who claimed/was approved while this bug was live
-- regains access as soon as this migration is applied, with no other
-- change to their entitlement.

CREATE OR REPLACE FUNCTION private.claim_free_offer(_is_bundle boolean, _year smallint, _scope public.access_scope)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  _uid uuid := auth.uid();
  _cfg public.pricing_config%ROWTYPE;
  _yp  public.year_prices%ROWTYPE;
  _is_free boolean;
  _exp TIMESTAMPTZ;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  IF _is_bundle THEN
    SELECT * INTO _cfg FROM public.pricing_config WHERE id = 1;
    IF _cfg.id IS NULL THEN RAISE EXCEPTION 'pricing_config missing'; END IF;
    _is_free := CASE _scope
      WHEN 'lessons' THEN _cfg.bundle_lessons_free
      WHEN 'sessions' THEN _cfg.bundle_sessions_free
      ELSE _cfg.bundle_free
    END;
    _exp := TIMESTAMPTZ '2027-10-31 22:59:59+00';
  ELSE
    IF _year IS NULL THEN RAISE EXCEPTION 'year required'; END IF;
    SELECT * INTO _yp FROM public.year_prices WHERE year = _year;
    IF _yp.year IS NULL THEN RAISE EXCEPTION 'year price not found'; END IF;
    _is_free := CASE _scope
      WHEN 'lessons' THEN _yp.lessons_free
      WHEN 'sessions' THEN _yp.sessions_free
      ELSE _yp.free
    END;
    _exp := TIMESTAMPTZ '2027-08-31 22:59:59+00';
  END IF;

  IF NOT COALESCE(_is_free, false) THEN
    RAISE EXCEPTION 'offer not free';
  END IF;

  IF _is_bundle THEN
    INSERT INTO public.user_entitlements (user_id, year, is_bundle, scope, granted_by, note, expires_at)
    VALUES (_uid, NULL, true, _scope, _uid, 'Offre gratuite', _exp)
    ON CONFLICT (user_id) WHERE is_bundle
    DO UPDATE SET
      scope = CASE WHEN public.user_entitlements.scope = excluded.scope THEN public.user_entitlements.scope ELSE 'both'::public.access_scope END,
      expires_at = GREATEST(public.user_entitlements.expires_at, excluded.expires_at);
  ELSE
    INSERT INTO public.user_entitlements (user_id, year, is_bundle, scope, granted_by, note, expires_at)
    VALUES (_uid, _year, false, _scope, _uid, 'Offre gratuite', _exp)
    ON CONFLICT (user_id, year) WHERE year IS NOT NULL
    DO UPDATE SET
      scope = CASE WHEN public.user_entitlements.scope = excluded.scope THEN public.user_entitlements.scope ELSE 'both'::public.access_scope END,
      expires_at = GREATEST(public.user_entitlements.expires_at, excluded.expires_at);
  END IF;

  PERFORM private.log_admin_action('claim_free_offer', 'user_entitlements', _uid::text,
    jsonb_build_object('is_bundle', _is_bundle, 'year', _year, 'scope', _scope));
END;
$function$;

CREATE OR REPLACE FUNCTION private.approve_payment_request(_request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE _req public.payment_requests%ROWTYPE; _exp TIMESTAMPTZ;
BEGIN
  IF NOT private.has_permission(auth.uid(),'manage_payments') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO _req FROM public.payment_requests WHERE id = _request_id FOR UPDATE;
  IF _req.id IS NULL THEN RAISE EXCEPTION 'not found'; END IF;
  IF _req.status <> 'pending' THEN RAISE EXCEPTION 'already reviewed'; END IF;
  _exp := CASE WHEN _req.is_bundle
    THEN TIMESTAMPTZ '2027-10-31 22:59:59+00'
    ELSE TIMESTAMPTZ '2027-08-31 22:59:59+00'
  END;
  INSERT INTO public.user_entitlements (user_id, year, is_bundle, scope, granted_by, note, expires_at)
  VALUES (_req.user_id, CASE WHEN _req.is_bundle THEN NULL ELSE _req.year END, _req.is_bundle, _req.scope, auth.uid(),
    'Paiement approuvé #' || _req.id, _exp);
  UPDATE public.payment_requests
    SET status='approved', reviewer_id=auth.uid(), reviewed_at=now()
    WHERE id=_request_id;
  PERFORM private.log_admin_action('approve_payment', 'payment_requests', _request_id::text,
    jsonb_build_object('user_id', _req.user_id, 'is_bundle', _req.is_bundle, 'year', _req.year, 'scope', _req.scope, 'amount_dzd', _req.amount_dzd, 'expires_at', _exp));
END;
$function$;

-- Repair rows already stamped with the old, now-past dates -- exact-match
-- only, so this can never touch a deliberately different expiry an admin
-- set by hand via the "Modifier l'expiration" dialog.
UPDATE public.user_entitlements
SET expires_at = TIMESTAMPTZ '2027-08-31 22:59:59+00'
WHERE is_bundle = false AND expires_at = TIMESTAMPTZ '2026-08-31 22:59:59+00';

UPDATE public.user_entitlements
SET expires_at = TIMESTAMPTZ '2027-10-31 22:59:59+00'
WHERE is_bundle = true AND expires_at = TIMESTAMPTZ '2026-10-31 22:59:59+00';
