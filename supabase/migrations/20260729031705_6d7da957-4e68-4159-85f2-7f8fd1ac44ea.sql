ALTER TABLE public.payment_requests ALTER COLUMN amount_dzd SET DEFAULT 0;

CREATE OR REPLACE FUNCTION public.lock_payment_amount()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.amount_dzd IS DISTINCT FROM OLD.amount_dzd
     AND NOT public.has_permission(auth.uid(), 'manage_payments'::admin_permission) THEN
    RAISE EXCEPTION 'amount_locked';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_payment_amount ON public.payment_requests;
CREATE TRIGGER trg_lock_payment_amount
BEFORE UPDATE ON public.payment_requests
FOR EACH ROW EXECUTE FUNCTION public.lock_payment_amount();