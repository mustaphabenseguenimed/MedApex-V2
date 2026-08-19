-- Admins with manage_cases (but not manage_quiz) manage cas-cliniques
-- sub-questions, which live in the same `questions` table. They should be
-- able to see/triage question_reports and fix the reported question
-- directly, same as manage_quiz admins already can.

DROP POLICY IF EXISTS "reports own read" ON public.question_reports;
CREATE POLICY "reports own read" ON public.question_reports FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR public.has_permission(auth.uid(), 'manage_quiz')
    OR public.has_permission(auth.uid(), 'manage_cases')
  );

DROP POLICY IF EXISTS "reports update admin" ON public.question_reports;
CREATE POLICY "reports update admin" ON public.question_reports FOR UPDATE TO authenticated
  USING (
    public.has_permission(auth.uid(), 'manage_quiz')
    OR public.has_permission(auth.uid(), 'manage_cases')
  )
  WITH CHECK (
    public.has_permission(auth.uid(), 'manage_quiz')
    OR public.has_permission(auth.uid(), 'manage_cases')
  );

DROP POLICY IF EXISTS "reports delete admin" ON public.question_reports;
CREATE POLICY "reports delete admin" ON public.question_reports FOR DELETE TO authenticated
  USING (
    public.has_permission(auth.uid(), 'manage_quiz')
    OR public.has_permission(auth.uid(), 'manage_cases')
  );

DROP POLICY IF EXISTS "manage_quiz can update" ON public.questions;
CREATE POLICY "manage_quiz can update" ON public.questions FOR UPDATE TO authenticated
  USING (
    public.has_permission(auth.uid(), 'manage_quiz')
    OR public.has_permission(auth.uid(), 'manage_cases')
  )
  WITH CHECK (
    public.has_permission(auth.uid(), 'manage_quiz')
    OR public.has_permission(auth.uid(), 'manage_cases')
  );
