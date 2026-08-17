
-- Clean old data
DELETE FROM public.qcm_sessions;
DELETE FROM public.module_contents WHERE kind = 'quiz';

-- Drop old sessions table (schema changes too big to alter)
DROP TABLE IF EXISTS public.qcm_sessions CASCADE;

-- Enums
DO $$ BEGIN
  CREATE TYPE public.question_type AS ENUM ('qcm','qcs','qroc','cas_clinique');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.question_polarity AS ENUM ('correct','incorrect');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- questions
CREATE TABLE public.questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id UUID NOT NULL REFERENCES public.modules(id) ON DELETE CASCADE,
  year SMALLINT NOT NULL,
  rotation_id UUID REFERENCES public.module_rotations(id) ON DELETE SET NULL,
  folder_id UUID REFERENCES public.module_folders(id) ON DELETE SET NULL,
  session_kind TEXT CHECK (session_kind IN ('cours','td')),
  session_number INT,
  session_title TEXT,
  type public.question_type NOT NULL,
  polarity public.question_polarity NOT NULL DEFAULT 'correct',
  stem TEXT NOT NULL,
  choices JSONB,
  correct_indices INT[],
  model_answer TEXT,
  explanation TEXT,
  parent_id UUID REFERENCES public.questions(id) ON DELETE CASCADE,
  sort_order INT NOT NULL DEFAULT 0,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX questions_module_idx ON public.questions(module_id);
CREATE INDEX questions_parent_idx ON public.questions(parent_id);
CREATE INDEX questions_filter_idx ON public.questions(module_id, rotation_id, session_kind, session_number, type);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.questions TO authenticated;
GRANT ALL ON public.questions TO service_role;

ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "students read within year access" ON public.questions
  FOR SELECT TO authenticated
  USING (public.user_has_year_access(auth.uid(), year));

CREATE POLICY "manage_quiz can insert" ON public.questions
  FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(), 'manage_quiz'));

CREATE POLICY "manage_quiz can update" ON public.questions
  FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(), 'manage_quiz'))
  WITH CHECK (public.has_permission(auth.uid(), 'manage_quiz'));

CREATE POLICY "author or super can delete" ON public.questions
  FOR DELETE TO authenticated
  USING (public.is_super_admin(auth.uid()) OR created_by = auth.uid());

-- Trigger: denormalize year from module
CREATE OR REPLACE FUNCTION public.set_question_year()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  SELECT year INTO NEW.year FROM public.modules WHERE id = NEW.module_id;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_questions_set_year
  BEFORE INSERT OR UPDATE OF module_id ON public.questions
  FOR EACH ROW EXECUTE FUNCTION public.set_question_year();

CREATE TRIGGER trg_questions_updated_at
  BEFORE UPDATE ON public.questions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_questions_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.questions
  FOR EACH ROW EXECUTE FUNCTION public.audit_table_change();

-- qcm_sessions
CREATE TABLE public.qcm_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  module_id UUID NOT NULL REFERENCES public.modules(id) ON DELETE CASCADE,
  rotation_id UUID REFERENCES public.module_rotations(id) ON DELETE SET NULL,
  session_kind TEXT,
  session_number INT,
  types TEXT[],
  question_ids UUID[] NOT NULL DEFAULT '{}',
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  grades JSONB NOT NULL DEFAULT '{}'::jsonb,
  score NUMERIC,
  total INT NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX qcm_sessions_user_idx ON public.qcm_sessions(user_id, started_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.qcm_sessions TO authenticated;
GRANT ALL ON public.qcm_sessions TO service_role;

ALTER TABLE public.qcm_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own sessions rw" ON public.qcm_sessions
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.has_permission(auth.uid(), 'manage_quiz'))
  WITH CHECK (user_id = auth.uid());

CREATE TRIGGER trg_qcm_sessions_updated_at
  BEFORE UPDATE ON public.qcm_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
