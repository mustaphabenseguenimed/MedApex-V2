CREATE OR REPLACE FUNCTION private.list_active_payment_methods()
RETURNS TABLE(id uuid, kind text, label text, account_holder text, account_number text, extra text, instructions text, sort_order integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, kind, label, account_holder, account_number, extra, instructions, sort_order
  FROM public.payment_methods
  WHERE is_active = true
  ORDER BY sort_order;
$$;

CREATE OR REPLACE FUNCTION public.list_active_payment_methods()
RETURNS TABLE(id uuid, kind text, label text, account_holder text, account_number text, extra text, instructions text, sort_order integer)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT * FROM private.list_active_payment_methods()
$$;

REVOKE ALL ON FUNCTION public.list_active_payment_methods() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_active_payment_methods() TO authenticated;