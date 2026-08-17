DROP POLICY IF EXISTS "authenticated read payment methods" ON public.payment_methods;
CREATE POLICY "admins read payment methods" ON public.payment_methods
  FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'manage_payments'::admin_permission) OR public.has_role(auth.uid(), 'admin'::app_role));