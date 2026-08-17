-- 1. Scope enum
DO $$ BEGIN
  CREATE TYPE public.access_scope AS ENUM ('lessons','sessions','both');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Columns
ALTER TABLE public.user_entitlements ADD COLUMN IF NOT EXISTS scope public.access_scope NOT NULL DEFAULT 'both';
ALTER TABLE public.payment_requests  ADD COLUMN IF NOT EXISTS scope public.access_scope NOT NULL DEFAULT 'both';

-- 3. Per-scope pricing
ALTER TABLE public.year_prices
  ADD COLUMN IF NOT EXISTS lessons_price_dzd integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lessons_sale_price_dzd integer,
  ADD COLUMN IF NOT EXISTS lessons_on_sale boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sessions_price_dzd integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sessions_sale_price_dzd integer,
  ADD COLUMN IF NOT EXISTS sessions_on_sale boolean NOT NULL DEFAULT false;

UPDATE public.year_prices SET
  lessons_price_dzd = CASE WHEN lessons_price_dzd = 0 THEN price_dzd ELSE lessons_price_dzd END,
  sessions_price_dzd = CASE WHEN sessions_price_dzd = 0 THEN price_dzd ELSE sessions_price_dzd END;

ALTER TABLE public.pricing_config
  ADD COLUMN IF NOT EXISTS bundle_lessons_price_dzd integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bundle_lessons_sale_price_dzd integer,
  ADD COLUMN IF NOT EXISTS bundle_lessons_on_sale boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bundle_sessions_price_dzd integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bundle_sessions_sale_price_dzd integer,
  ADD COLUMN IF NOT EXISTS bundle_sessions_on_sale boolean NOT NULL DEFAULT false;

UPDATE public.pricing_config SET
  bundle_lessons_price_dzd = CASE WHEN bundle_lessons_price_dzd = 0 THEN bundle_price_dzd ELSE bundle_lessons_price_dzd END,
  bundle_sessions_price_dzd = CASE WHEN bundle_sessions_price_dzd = 0 THEN bundle_price_dzd ELSE bundle_sessions_price_dzd END;

-- 4. Scope-aware access functions
CREATE OR REPLACE FUNCTION private.user_has_year_scope(_user_id uuid, _year smallint, _scope public.access_scope)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.has_role(_user_id, 'admin')
    OR EXISTS (
      SELECT 1 FROM public.user_entitlements
      WHERE user_id = _user_id
        AND (is_bundle = true OR year = _year)
        AND (expires_at IS NULL OR expires_at > now())
        AND (scope = 'both' OR scope = _scope)
    )
$$;

CREATE OR REPLACE FUNCTION private.user_has_module_scope(_user_id uuid, _module_id uuid, _scope public.access_scope)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.has_role(_user_id, 'admin') OR EXISTS (
    SELECT 1 FROM public.modules m
    JOIN public.user_entitlements ue ON ue.user_id = _user_id
    WHERE m.id = _module_id
      AND (ue.is_bundle = true OR ue.year = m.year)
      AND (ue.expires_at IS NULL OR ue.expires_at > now())
      AND (ue.scope = 'both' OR ue.scope = _scope)
  )
$$;

CREATE OR REPLACE FUNCTION public.user_has_year_scope(_user_id uuid, _year smallint, _scope public.access_scope)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT private.user_has_year_scope(_user_id, _year, _scope)
$$;

CREATE OR REPLACE FUNCTION public.user_has_module_scope(_user_id uuid, _module_id uuid, _scope public.access_scope)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT private.user_has_module_scope(_user_id, _module_id, _scope)
$$;

GRANT EXECUTE ON FUNCTION public.user_has_year_scope(uuid, smallint, public.access_scope) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_module_scope(uuid, uuid, public.access_scope) TO authenticated;

-- 5. Scope-split RLS read policies
DROP POLICY IF EXISTS "Entitled users read contents" ON public.module_contents;
CREATE POLICY "Entitled users read contents" ON public.module_contents FOR SELECT TO authenticated
  USING (public.user_has_module_scope(auth.uid(), module_id, 'lessons'));

DROP POLICY IF EXISTS "Entitled users read folders" ON public.module_folders;
CREATE POLICY "Entitled users read folders" ON public.module_folders FOR SELECT TO authenticated
  USING (public.user_has_module_scope(auth.uid(), module_id, 'lessons'));

DROP POLICY IF EXISTS "Entitled users read rotations" ON public.module_rotations;
CREATE POLICY "Entitled users read rotations" ON public.module_rotations FOR SELECT TO authenticated
  USING (public.user_has_module_scope(auth.uid(), module_id, 'sessions'));

DROP POLICY IF EXISTS "Entitled users read questions" ON public.questions;
CREATE POLICY "Entitled users read questions" ON public.questions FOR SELECT TO authenticated
  USING (public.user_has_module_scope(auth.uid(), module_id, 'sessions'));

DROP POLICY IF EXISTS "Entitled users read explanations" ON public.question_explanations;
CREATE POLICY "Entitled users read explanations" ON public.question_explanations FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.questions q
    WHERE q.id = question_explanations.question_id
      AND public.user_has_module_scope(auth.uid(), q.module_id, 'sessions')
  ));

DROP POLICY IF EXISTS "Entitled users read module-files" ON storage.objects;
CREATE POLICY "Entitled users read module-files" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'module-files' AND public.user_has_module_scope(auth.uid(), (split_part(name, '/', 1))::uuid, 'lessons'));

DROP POLICY IF EXISTS "Entitled users read explanation-images" ON storage.objects;
CREATE POLICY "Entitled users read explanation-images" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'explanation-images' AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR EXISTS (
        SELECT 1 FROM public.questions q
        WHERE public.user_has_module_scope(auth.uid(), q.module_id, 'sessions')
          AND (
            position(('storage://explanation-images/' || objects.name) in coalesce(q.stem, '')) > 0
            OR position(('storage://explanation-images/' || objects.name) in coalesce(q.explanation, '')) > 0
            OR position(('storage://explanation-images/' || objects.name) in coalesce(q.model_answer, '')) > 0
            OR position(('storage://explanation-images/' || objects.name) in coalesce(q.choices::text, '')) > 0
          )
      )
      OR EXISTS (
        SELECT 1 FROM public.question_explanations qe
        JOIN public.questions q ON q.id = qe.question_id
        WHERE public.user_has_module_scope(auth.uid(), q.module_id, 'sessions')
          AND position(('storage://explanation-images/' || objects.name) in coalesce(qe.body, '')) > 0
      )
    )
  );

-- 6. Amount computation per scope
CREATE OR REPLACE FUNCTION public.compute_payment_amount()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  _cfg public.pricing_config%ROWTYPE;
  _yp  public.year_prices%ROWTYPE;
  _amt integer;
BEGIN
  IF NEW.is_bundle THEN
    SELECT * INTO _cfg FROM public.pricing_config WHERE id = 1;
    IF _cfg.id IS NULL THEN RAISE EXCEPTION 'pricing_config missing'; END IF;
    _amt := CASE NEW.scope
      WHEN 'lessons' THEN CASE WHEN _cfg.bundle_lessons_on_sale AND _cfg.bundle_lessons_sale_price_dzd IS NOT NULL
        THEN _cfg.bundle_lessons_sale_price_dzd ELSE _cfg.bundle_lessons_price_dzd END
      WHEN 'sessions' THEN CASE WHEN _cfg.bundle_sessions_on_sale AND _cfg.bundle_sessions_sale_price_dzd IS NOT NULL
        THEN _cfg.bundle_sessions_sale_price_dzd ELSE _cfg.bundle_sessions_price_dzd END
      ELSE CASE WHEN _cfg.bundle_on_sale AND _cfg.bundle_sale_price_dzd IS NOT NULL
        THEN _cfg.bundle_sale_price_dzd ELSE _cfg.bundle_price_dzd END
    END;
    NEW.year := NULL;
  ELSE
    IF NEW.year IS NULL THEN RAISE EXCEPTION 'year required'; END IF;
    SELECT * INTO _yp FROM public.year_prices WHERE year = NEW.year;
    IF _yp.year IS NULL THEN RAISE EXCEPTION 'year price not found'; END IF;
    _amt := CASE NEW.scope
      WHEN 'lessons' THEN CASE WHEN _yp.lessons_on_sale AND _yp.lessons_sale_price_dzd IS NOT NULL
        THEN _yp.lessons_sale_price_dzd ELSE _yp.lessons_price_dzd END
      WHEN 'sessions' THEN CASE WHEN _yp.sessions_on_sale AND _yp.sessions_sale_price_dzd IS NOT NULL
        THEN _yp.sessions_sale_price_dzd ELSE _yp.sessions_price_dzd END
      ELSE CASE WHEN _yp.on_sale AND _yp.sale_price_dzd IS NOT NULL
        THEN _yp.sale_price_dzd ELSE _yp.price_dzd END
    END;
  END IF;
  NEW.amount_dzd := _amt;
  RETURN NEW;
END;
$function$;

-- 7. Approval carries the scope
CREATE OR REPLACE FUNCTION private.approve_payment_request(_request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
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