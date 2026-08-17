DROP POLICY IF EXISTS "perm delete modules" ON public.modules;
CREATE POLICY "super admin delete modules" ON public.modules FOR DELETE USING (public.is_super_admin(auth.uid()));