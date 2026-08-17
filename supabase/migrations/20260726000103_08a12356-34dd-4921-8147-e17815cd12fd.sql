
-- 1) Server-side payment amount enforcement
CREATE OR REPLACE FUNCTION public.compute_payment_amount()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _cfg public.pricing_config%ROWTYPE;
  _yp  public.year_prices%ROWTYPE;
  _amt integer;
BEGIN
  IF NEW.is_bundle THEN
    SELECT * INTO _cfg FROM public.pricing_config WHERE id = 1;
    IF _cfg.id IS NULL THEN RAISE EXCEPTION 'pricing_config missing'; END IF;
    _amt := CASE WHEN _cfg.bundle_on_sale AND _cfg.bundle_sale_price_dzd IS NOT NULL
      THEN _cfg.bundle_sale_price_dzd ELSE _cfg.bundle_price_dzd END;
    NEW.year := NULL;
  ELSE
    IF NEW.year IS NULL THEN RAISE EXCEPTION 'year required'; END IF;
    SELECT * INTO _yp FROM public.year_prices WHERE year = NEW.year;
    IF _yp.year IS NULL THEN RAISE EXCEPTION 'year price not found'; END IF;
    _amt := CASE WHEN _yp.on_sale AND _yp.sale_price_dzd IS NOT NULL
      THEN _yp.sale_price_dzd ELSE _yp.price_dzd END;
  END IF;
  NEW.amount_dzd := _amt;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_compute_payment_amount ON public.payment_requests;
CREATE TRIGGER trg_compute_payment_amount
BEFORE INSERT ON public.payment_requests
FOR EACH ROW EXECUTE FUNCTION public.compute_payment_amount();

REVOKE ALL ON FUNCTION public.compute_payment_amount() FROM PUBLIC, anon, authenticated;

-- 2) Lock down SECURITY DEFINER function execute privileges.
-- Revoke from PUBLIC/anon on all; grant execute to authenticated only for RPCs the app calls.
REVOKE ALL ON FUNCTION public.claim_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_permission(uuid, admin_permission) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_admin(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_admins() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.promote_admin(text, admin_permission[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.user_has_year_access(uuid, smallint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.audit_table_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_payment_request(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.log_admin_action(text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.approve_payment_request(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.user_has_module_access(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_question_year() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_sales_deadline() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_admins() TO authenticated;
GRANT EXECUTE ON FUNCTION public.promote_admin(text, admin_permission[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_payment_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_payment_request(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_year_access(uuid, smallint) TO authenticated;
