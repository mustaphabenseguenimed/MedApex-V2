CREATE POLICY "perm update entitlements" ON public.user_entitlements
FOR UPDATE TO authenticated
USING (public.has_permission(auth.uid(), 'manage_access'::admin_permission))
WITH CHECK (public.has_permission(auth.uid(), 'manage_access'::admin_permission));