
CREATE POLICY "auth read module-files" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'module-files');
CREATE POLICY "admins upload module-files" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'module-files' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins update module-files" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'module-files' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins delete module-files" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'module-files' AND public.has_role(auth.uid(), 'admin'));
