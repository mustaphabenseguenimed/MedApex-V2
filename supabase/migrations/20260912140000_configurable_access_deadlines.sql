-- Access deadlines used to be two constants hardcoded in src/lib/deadlines.ts
-- and duplicated again inside private.claim_free_offer and
-- private.approve_payment_request (see migration 20260911120000, which had
-- to fix all three copies by hand after they went stale). Move them into
-- pricing_config instead, as two admin-editable columns, so a super admin
-- can change them from Admin -> Tarifs without a code change or a
-- migration, and every consumer -- these two functions, the Store's
-- "sales closed" check, and the access page's default/quick-set expiry --
-- reads the same single row.
--
-- Defaults match the values these dates already held, so this migration
-- changes nothing for existing behavior until an admin edits them.
ALTER TABLE public.pricing_config
  ADD COLUMN IF NOT EXISTS year_deadline timestamptz NOT NULL DEFAULT '2027-08-31 22:59:59+00',
  ADD COLUMN IF NOT EXISTS bundle_deadline timestamptz NOT NULL DEFAULT '2027-10-31 22:59:59+00';

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

  SELECT * INTO _cfg FROM public.pricing_config WHERE id = 1;
  IF _cfg.id IS NULL THEN RAISE EXCEPTION 'pricing_config missing'; END IF;

  IF _is_bundle THEN
    _is_free := CASE _scope
      WHEN 'lessons' THEN _cfg.bundle_lessons_free
      WHEN 'sessions' THEN _cfg.bundle_sessions_free
      ELSE _cfg.bundle_free
    END;
    _exp := _cfg.bundle_deadline;
  ELSE
    IF _year IS NULL THEN RAISE EXCEPTION 'year required'; END IF;
    SELECT * INTO _yp FROM public.year_prices WHERE year = _year;
    IF _yp.year IS NULL THEN RAISE EXCEPTION 'year price not found'; END IF;
    _is_free := CASE _scope
      WHEN 'lessons' THEN _yp.lessons_free
      WHEN 'sessions' THEN _yp.sessions_free
      ELSE _yp.free
    END;
    _exp := _cfg.year_deadline;
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
DECLARE _req public.payment_requests%ROWTYPE; _cfg public.pricing_config%ROWTYPE; _exp TIMESTAMPTZ;
BEGIN
  IF NOT private.has_permission(auth.uid(),'manage_payments') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO _req FROM public.payment_requests WHERE id = _request_id FOR UPDATE;
  IF _req.id IS NULL THEN RAISE EXCEPTION 'not found'; END IF;
  IF _req.status <> 'pending' THEN RAISE EXCEPTION 'already reviewed'; END IF;
  SELECT * INTO _cfg FROM public.pricing_config WHERE id = 1;
  IF _cfg.id IS NULL THEN RAISE EXCEPTION 'pricing_config missing'; END IF;
  _exp := CASE WHEN _req.is_bundle THEN _cfg.bundle_deadline ELSE _cfg.year_deadline END;
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
