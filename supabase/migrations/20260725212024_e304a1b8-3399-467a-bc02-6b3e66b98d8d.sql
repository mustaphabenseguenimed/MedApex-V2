
-- Helper: check access to a module by its id
CREATE OR REPLACE FUNCTION public.user_has_module_access(_user_id uuid, _module_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_user_id, 'admin') OR EXISTS (
    SELECT 1 FROM public.modules m
    JOIN public.user_entitlements ue ON ue.user_id = _user_id
    WHERE m.id = _module_id AND (ue.is_bundle = true OR ue.year = m.year)
  );
$$;

-- modules: gate reads by entitlement
DROP POLICY IF EXISTS "Any signed-in user reads modules" ON public.modules;
CREATE POLICY "Entitled users read modules" ON public.modules FOR SELECT TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.user_has_year_access(auth.uid(), year));

-- module_contents
DROP POLICY IF EXISTS "Signed-in reads contents" ON public.module_contents;
CREATE POLICY "Entitled users read contents" ON public.module_contents FOR SELECT TO authenticated
USING (public.user_has_module_access(auth.uid(), module_id));

-- module_folders
DROP POLICY IF EXISTS "read folders" ON public.module_folders;
CREATE POLICY "Entitled users read folders" ON public.module_folders FOR SELECT TO authenticated
USING (public.user_has_module_access(auth.uid(), module_id));

-- module_rotations
DROP POLICY IF EXISTS "read rotations" ON public.module_rotations;
CREATE POLICY "Entitled users read rotations" ON public.module_rotations FOR SELECT TO authenticated
USING (public.user_has_module_access(auth.uid(), module_id));

-- questions: also gate by module access
DROP POLICY IF EXISTS "read questions" ON public.questions;
DROP POLICY IF EXISTS "Any signed-in user reads questions" ON public.questions;
DROP POLICY IF EXISTS "Signed-in reads questions" ON public.questions;
CREATE POLICY "Entitled users read questions" ON public.questions FOR SELECT TO authenticated
USING (public.user_has_module_access(auth.uid(), module_id));

-- storage.objects: gate module-files reads by entitlement (path is "{module_id}/...")
DROP POLICY IF EXISTS "auth read module-files" ON storage.objects;
CREATE POLICY "Entitled users read module-files" ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'module-files'
  AND public.user_has_module_access(auth.uid(), (split_part(name, '/', 1))::uuid)
);
