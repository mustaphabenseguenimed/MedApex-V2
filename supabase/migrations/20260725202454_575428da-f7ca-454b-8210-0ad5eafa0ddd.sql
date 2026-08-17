
-- 1. module_folders
CREATE TABLE public.module_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id uuid NOT NULL REFERENCES public.modules(id) ON DELETE CASCADE,
  kind public.content_type NOT NULL,
  name text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.module_folders (module_id, kind, sort_order);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.module_folders TO authenticated;
GRANT ALL ON public.module_folders TO service_role;
ALTER TABLE public.module_folders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read folders" ON public.module_folders FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert folders" ON public.module_folders FOR INSERT TO authenticated
  WITH CHECK (
    (kind = 'quiz' AND public.has_permission(auth.uid(),'manage_quiz'))
    OR (kind <> 'quiz' AND public.has_permission(auth.uid(),'manage_content'))
  );
CREATE POLICY "update folders" ON public.module_folders FOR UPDATE TO authenticated
  USING (
    (kind = 'quiz' AND public.has_permission(auth.uid(),'manage_quiz'))
    OR (kind <> 'quiz' AND public.has_permission(auth.uid(),'manage_content'))
  )
  WITH CHECK (
    (kind = 'quiz' AND public.has_permission(auth.uid(),'manage_quiz'))
    OR (kind <> 'quiz' AND public.has_permission(auth.uid(),'manage_content'))
  );
CREATE POLICY "delete folders" ON public.module_folders FOR DELETE TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR (created_by = auth.uid() AND (
      (kind = 'quiz' AND public.has_permission(auth.uid(),'manage_quiz'))
      OR (kind <> 'quiz' AND public.has_permission(auth.uid(),'manage_content'))
    ))
  );
CREATE TRIGGER trg_module_folders_updated BEFORE UPDATE ON public.module_folders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_module_folders_audit AFTER INSERT OR UPDATE OR DELETE ON public.module_folders
  FOR EACH ROW EXECUTE FUNCTION public.audit_table_change();

-- 2. module_rotations
CREATE TABLE public.module_rotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id uuid NOT NULL REFERENCES public.modules(id) ON DELETE CASCADE,
  label text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (module_id, label)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.module_rotations TO authenticated;
GRANT ALL ON public.module_rotations TO service_role;
ALTER TABLE public.module_rotations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read rotations" ON public.module_rotations FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert rotations" ON public.module_rotations FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(),'manage_modules'));
CREATE POLICY "update rotations" ON public.module_rotations FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(),'manage_modules'))
  WITH CHECK (public.has_permission(auth.uid(),'manage_modules'));
CREATE POLICY "delete rotations" ON public.module_rotations FOR DELETE TO authenticated
  USING (public.is_super_admin(auth.uid()) OR (created_by = auth.uid() AND public.has_permission(auth.uid(),'manage_modules')));
CREATE TRIGGER trg_module_rotations_updated BEFORE UPDATE ON public.module_rotations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_module_rotations_audit AFTER INSERT OR UPDATE OR DELETE ON public.module_rotations
  FOR EACH ROW EXECUTE FUNCTION public.audit_table_change();

-- 3. extend module_contents
ALTER TABLE public.module_contents
  ADD COLUMN folder_id uuid REFERENCES public.module_folders(id) ON DELETE SET NULL,
  ADD COLUMN rotation_id uuid REFERENCES public.module_rotations(id) ON DELETE SET NULL,
  ADD COLUMN session_kind text CHECK (session_kind IN ('cours','td')),
  ADD COLUMN session_number int,
  ADD COLUMN session_title text;
CREATE INDEX ON public.module_contents (folder_id);
CREATE INDEX ON public.module_contents (module_id, kind, rotation_id, session_kind, session_number);

-- 4. qcm_sessions
CREATE TABLE public.qcm_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  module_id uuid NOT NULL REFERENCES public.modules(id) ON DELETE CASCADE,
  rotation_id uuid REFERENCES public.module_rotations(id) ON DELETE SET NULL,
  session_kind text CHECK (session_kind IN ('cours','td')),
  session_number int,
  questions jsonb NOT NULL,     -- [{ cid, qi, q, choices, answer, explanation }]
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,  -- { "<idx>": number|number[] }
  score int,
  total int NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.qcm_sessions (user_id, module_id, started_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qcm_sessions TO authenticated;
GRANT ALL ON public.qcm_sessions TO service_role;
ALTER TABLE public.qcm_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own sessions" ON public.qcm_sessions FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE TRIGGER trg_qcm_sessions_updated BEFORE UPDATE ON public.qcm_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
