-- Idempotent repair: ensure question_reports (table, grants, RLS, trigger)
-- actually exists. Safe to run whether or not it was already applied —
-- every statement either uses IF NOT EXISTS / IF EXISTS, or is naturally
-- idempotent (GRANT, ENABLE ROW LEVEL SECURITY).

CREATE TABLE IF NOT EXISTS public.question_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason text NOT NULL,
  details text,
  status text NOT NULL DEFAULT 'open',
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.question_reports TO authenticated;
GRANT ALL ON public.question_reports TO service_role;
ALTER TABLE public.question_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reports own read" ON public.question_reports;
CREATE POLICY "reports own read" ON public.question_reports FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR public.has_permission(auth.uid(), 'manage_quiz')
    OR public.has_permission(auth.uid(), 'manage_cases')
  );

DROP POLICY IF EXISTS "reports insert own" ON public.question_reports;
CREATE POLICY "reports insert own" ON public.question_reports FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

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

DROP TRIGGER IF EXISTS question_reports_updated ON public.question_reports;
CREATE TRIGGER question_reports_updated BEFORE UPDATE ON public.question_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
