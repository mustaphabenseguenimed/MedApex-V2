DROP POLICY IF EXISTS "explanation-images read authenticated" ON storage.objects;
DROP POLICY IF EXISTS "Entitled users read explanation-images" ON storage.objects;

CREATE POLICY "Entitled users read explanation-images"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'explanation-images'
    AND (
      public.has_role(auth.uid(), 'admin')
      OR EXISTS (
        SELECT 1
        FROM public.questions q
        WHERE public.user_has_module_access(auth.uid(), q.module_id)
          AND (
            position(('storage://explanation-images/' || storage.objects.name) in coalesce(q.stem, '')) > 0
            OR position(('storage://explanation-images/' || storage.objects.name) in coalesce(q.explanation, '')) > 0
            OR position(('storage://explanation-images/' || storage.objects.name) in coalesce(q.model_answer, '')) > 0
            OR position(('storage://explanation-images/' || storage.objects.name) in coalesce(q.choices::text, '')) > 0
          )
      )
      OR EXISTS (
        SELECT 1
        FROM public.question_explanations qe
        JOIN public.questions q ON q.id = qe.question_id
        WHERE public.user_has_module_access(auth.uid(), q.module_id)
          AND position(('storage://explanation-images/' || storage.objects.name) in coalesce(qe.body, '')) > 0
      )
    )
  );