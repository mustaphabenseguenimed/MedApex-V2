
-- 1) Add manage_cases permission
ALTER TYPE public.admin_permission ADD VALUE IF NOT EXISTS 'manage_cases';

-- 2) Loosen questions delete policy to include manage_quiz admins
DROP POLICY IF EXISTS "author or super can delete" ON public.questions;
CREATE POLICY "author, super or manage_quiz can delete"
  ON public.questions FOR DELETE
  TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR public.has_permission(auth.uid(), 'manage_quiz')
    OR created_by = auth.uid()
  );

-- 3) Storage policies for explanation-images bucket
CREATE POLICY "explanation-images read authenticated"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'explanation-images');

CREATE POLICY "explanation-images insert admins"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'explanation-images'
    AND (public.has_permission(auth.uid(), 'manage_quiz') OR public.is_super_admin(auth.uid()))
  );

CREATE POLICY "explanation-images update admins"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'explanation-images'
    AND (public.has_permission(auth.uid(), 'manage_quiz') OR public.is_super_admin(auth.uid()))
  );

CREATE POLICY "explanation-images delete admins"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'explanation-images'
    AND (public.has_permission(auth.uid(), 'manage_quiz') OR public.is_super_admin(auth.uid()))
  );
