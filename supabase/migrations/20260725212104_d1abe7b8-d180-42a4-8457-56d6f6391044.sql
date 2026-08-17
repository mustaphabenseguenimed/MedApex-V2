
DROP POLICY IF EXISTS "explanations readable" ON public.question_explanations;
CREATE POLICY "Entitled users read explanations" ON public.question_explanations FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.questions q
    WHERE q.id = question_explanations.question_id
      AND public.user_has_module_access(auth.uid(), q.module_id)
  )
);
