
-- Extend questions
ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS difficulty smallint CHECK (difficulty BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS media_url text,
  ADD COLUMN IF NOT EXISTS references_text text,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';

-- Extend qcm_sessions
ALTER TABLE public.qcm_sessions
  ADD COLUMN IF NOT EXISTS paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS resumed_at timestamptz,
  ADD COLUMN IF NOT EXISTS preset_id uuid;

-- 1. session_presets
CREATE TABLE IF NOT EXISTS public.session_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.session_presets TO authenticated;
GRANT ALL ON public.session_presets TO service_role;
ALTER TABLE public.session_presets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own presets" ON public.session_presets FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER session_presets_updated BEFORE UPDATE ON public.session_presets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. flashcards
CREATE TABLE IF NOT EXISTS public.flashcards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question_id uuid REFERENCES public.questions(id) ON DELETE CASCADE,
  choice_index smallint,
  front text NOT NULL,
  back text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  module_id uuid REFERENCES public.modules(id) ON DELETE SET NULL,
  ease numeric NOT NULL DEFAULT 2.5,
  interval_days numeric NOT NULL DEFAULT 0,
  repetitions integer NOT NULL DEFAULT 0,
  lapses integer NOT NULL DEFAULT 0,
  last_grade smallint,
  last_reviewed_at timestamptz,
  due_at timestamptz NOT NULL DEFAULT now(),
  suspended boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS flashcards_user_due ON public.flashcards(user_id, due_at) WHERE NOT suspended;
CREATE INDEX IF NOT EXISTS flashcards_user_question ON public.flashcards(user_id, question_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.flashcards TO authenticated;
GRANT ALL ON public.flashcards TO service_role;
ALTER TABLE public.flashcards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own flashcards" ON public.flashcards FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER flashcards_updated BEFORE UPDATE ON public.flashcards
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. question_explanations
CREATE TABLE IF NOT EXISTS public.question_explanations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  choice_index smallint,
  body text NOT NULL,
  model text,
  generated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS question_explanations_unique ON public.question_explanations(question_id, COALESCE(choice_index, -1));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.question_explanations TO authenticated;
GRANT ALL ON public.question_explanations TO service_role;
ALTER TABLE public.question_explanations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "explanations readable" ON public.question_explanations FOR SELECT TO authenticated USING (true);
CREATE POLICY "explanations write admin" ON public.question_explanations FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(), 'manage_quiz'));
CREATE POLICY "explanations update admin" ON public.question_explanations FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(), 'manage_quiz'))
  WITH CHECK (public.has_permission(auth.uid(), 'manage_quiz'));
CREATE POLICY "explanations delete admin" ON public.question_explanations FOR DELETE TO authenticated
  USING (public.has_permission(auth.uid(), 'manage_quiz'));
CREATE TRIGGER question_explanations_updated BEFORE UPDATE ON public.question_explanations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. question_reports
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
CREATE POLICY "reports own read" ON public.question_reports FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_permission(auth.uid(), 'manage_quiz'));
CREATE POLICY "reports insert own" ON public.question_reports FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "reports update admin" ON public.question_reports FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(), 'manage_quiz'))
  WITH CHECK (public.has_permission(auth.uid(), 'manage_quiz'));
CREATE POLICY "reports delete admin" ON public.question_reports FOR DELETE TO authenticated
  USING (public.has_permission(auth.uid(), 'manage_quiz'));
CREATE TRIGGER question_reports_updated BEFORE UPDATE ON public.question_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5. session_events (per-answer analytics)
CREATE TABLE IF NOT EXISTS public.session_events (
  id bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES public.qcm_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question_id uuid REFERENCES public.questions(id) ON DELETE SET NULL,
  event text NOT NULL,
  duration_ms integer,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS session_events_session ON public.session_events(session_id);
CREATE INDEX IF NOT EXISTS session_events_user_time ON public.session_events(user_id, created_at DESC);
GRANT SELECT, INSERT ON public.session_events TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.session_events_id_seq TO authenticated;
GRANT ALL ON public.session_events TO service_role;
GRANT ALL ON SEQUENCE public.session_events_id_seq TO service_role;
ALTER TABLE public.session_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own events read" ON public.session_events FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "own events insert" ON public.session_events FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
