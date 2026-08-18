-- Free offers: admins can mark any pricing offer (per year, per scope, or
-- the bundle) as free so users can claim it directly from the store
-- without going through the payment-request flow.

ALTER TABLE public.year_prices
  ADD COLUMN IF NOT EXISTS free boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lessons_free boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sessions_free boolean NOT NULL DEFAULT false;

ALTER TABLE public.pricing_config
  ADD COLUMN IF NOT EXISTS bundle_free boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bundle_lessons_free boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bundle_sessions_free boolean NOT NULL DEFAULT false;

-- Self-service claim: grants the caller an entitlement directly, bypassing
-- payment_requests entirely, but only for offers an admin has flagged free.
-- Mirrors approve_payment_request's expiry rules. Existing entitlement rows
-- are merged (scope widened to 'both', expiry extended) rather than
-- erroring, since user_entitlements only allows one row per (user, year)
-- or one bundle row per user regardless of scope.
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
    _exp := TIMESTAMPTZ '2026-10-31 22:59:59+00';
  ELSE
    IF _year IS NULL THEN RAISE EXCEPTION 'year required'; END IF;
    SELECT * INTO _yp FROM public.year_prices WHERE year = _year;
    IF _yp.year IS NULL THEN RAISE EXCEPTION 'year price not found'; END IF;
    _is_free := CASE _scope
      WHEN 'lessons' THEN _yp.lessons_free
      WHEN 'sessions' THEN _yp.sessions_free
      ELSE _yp.free
    END;
    _exp := TIMESTAMPTZ '2026-08-31 22:59:59+00';
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
REVOKE ALL ON FUNCTION private.claim_free_offer(boolean, smallint, public.access_scope) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.claim_free_offer(boolean, smallint, public.access_scope) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_free_offer(_is_bundle boolean, _year smallint, _scope public.access_scope)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM private.claim_free_offer(_is_bundle, _year, _scope);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_free_offer(boolean, smallint, public.access_scope) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_free_offer(boolean, smallint, public.access_scope) TO authenticated;
