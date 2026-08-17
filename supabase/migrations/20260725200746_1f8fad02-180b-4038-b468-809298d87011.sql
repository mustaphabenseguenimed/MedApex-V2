
ALTER TABLE public.module_contents ALTER COLUMN created_by SET DEFAULT auth.uid();
ALTER TABLE public.modules ALTER COLUMN created_by SET DEFAULT auth.uid();

DROP POLICY IF EXISTS "perm delete contents" ON public.module_contents;
CREATE POLICY "perm delete contents" ON public.module_contents FOR DELETE
USING (
  public.is_super_admin(auth.uid()) OR (
    created_by = auth.uid() AND (
      (kind = 'quiz'::content_type AND public.has_permission(auth.uid(),'manage_quiz')) OR
      (kind <> 'quiz'::content_type AND public.has_permission(auth.uid(),'manage_content'))
    )
  )
);
