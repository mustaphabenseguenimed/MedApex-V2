-- Conversion tool "library": a shared history of past outputs from each of
-- the 4 conversion steps, so any admin can look back, re-download, or feed
-- a past result into the next step without re-running the AI extraction.
-- Shared across all admins (not per-admin private), by design.

CREATE TABLE IF NOT EXISTS public.conversion_library_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  step smallint NOT NULL CHECK (step BETWEEN 1 AND 4),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  source_filenames text[] NOT NULL DEFAULT '{}',
  label text NOT NULL,
  output_kind text NOT NULL CHECK (output_kind IN ('docx', 'json')),
  storage_path text NOT NULL,
  item_count integer,
  module_id uuid REFERENCES public.modules(id) ON DELETE SET NULL,
  rotation text,
  year_label text
);

CREATE INDEX IF NOT EXISTS conversion_library_items_step_created_idx
  ON public.conversion_library_items (step, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversion_library_items TO authenticated;
GRANT ALL ON public.conversion_library_items TO service_role;
ALTER TABLE public.conversion_library_items ENABLE ROW LEVEL SECURITY;

-- Shared: any admin with manage_quiz can see, add, or remove any entry —
-- this is a team library, not a per-admin inbox.
DROP POLICY IF EXISTS "conversion library read admins" ON public.conversion_library_items;
CREATE POLICY "conversion library read admins" ON public.conversion_library_items FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'manage_quiz') OR public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "conversion library insert admins" ON public.conversion_library_items;
CREATE POLICY "conversion library insert admins" ON public.conversion_library_items FOR INSERT TO authenticated
  WITH CHECK (
    (public.has_permission(auth.uid(), 'manage_quiz') OR public.is_super_admin(auth.uid()))
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS "conversion library update admins" ON public.conversion_library_items;
CREATE POLICY "conversion library update admins" ON public.conversion_library_items FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(), 'manage_quiz') OR public.is_super_admin(auth.uid()))
  WITH CHECK (public.has_permission(auth.uid(), 'manage_quiz') OR public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "conversion library delete admins" ON public.conversion_library_items;
CREATE POLICY "conversion library delete admins" ON public.conversion_library_items FOR DELETE TO authenticated
  USING (public.has_permission(auth.uid(), 'manage_quiz') OR public.is_super_admin(auth.uid()));

-- Private bucket: any admin (manage_quiz) reads/writes it directly through
-- RLS below — server functions use the caller's own authenticated client,
-- no service-role bypass needed here.
INSERT INTO storage.buckets (id, name, public)
VALUES ('conversion-library', 'conversion-library', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "conversion-library read admins" ON storage.objects;
CREATE POLICY "conversion-library read admins"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'conversion-library'
    AND (public.has_permission(auth.uid(), 'manage_quiz') OR public.is_super_admin(auth.uid()))
  );

DROP POLICY IF EXISTS "conversion-library insert admins" ON storage.objects;
CREATE POLICY "conversion-library insert admins"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'conversion-library'
    AND (public.has_permission(auth.uid(), 'manage_quiz') OR public.is_super_admin(auth.uid()))
  );

DROP POLICY IF EXISTS "conversion-library delete admins" ON storage.objects;
CREATE POLICY "conversion-library delete admins"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'conversion-library'
    AND (public.has_permission(auth.uid(), 'manage_quiz') OR public.is_super_admin(auth.uid()))
  );
