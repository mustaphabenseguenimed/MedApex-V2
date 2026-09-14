-- Step 1 conversions that run on the server.
--
-- The conversion tool used to do everything in the page: split the PDF, then
-- one request per page from the browser. A phone freezes its tab as soon as
-- it is backgrounded, which killed the run. A job row lets the work live on
-- the server instead: the PDF is uploaded once (straight to the existing
-- `conversion-library` bucket, whose policies already allow an admin to write
-- it from the browser), and the row carries its own cursor so a worker whose
-- invocation is cut short can be resumed — from the same phone later, or from
-- another device entirely.

CREATE TABLE IF NOT EXISTS public.conversion_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  filename text NOT NULL,
  storage_path text NOT NULL,
  hint text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'done', 'error')),
  total_pages integer NOT NULL DEFAULT 0,
  done_pages integer NOT NULL DEFAULT 0,
  -- One entry per page read: { index, questions, warning? }. Keyed by page so
  -- a page retried after the ones behind it still lands in document order.
  pages jsonb NOT NULL DEFAULT '[]'::jsonb,
  failed_pages integer[] NOT NULL DEFAULT '{}',
  error text,
  -- Held by whichever worker is running the job; a worker killed mid-flight
  -- never releases it, so the job becomes claimable again when it expires.
  lease_until timestamptz
);

CREATE INDEX IF NOT EXISTS conversion_jobs_created_idx
  ON public.conversion_jobs (created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversion_jobs TO authenticated;
GRANT ALL ON public.conversion_jobs TO service_role;
ALTER TABLE public.conversion_jobs ENABLE ROW LEVEL SECURITY;

-- Shared between admins, like the conversion library: a job started on a
-- phone has to be openable from a laptop.
DROP POLICY IF EXISTS "conversion jobs read admins" ON public.conversion_jobs;
CREATE POLICY "conversion jobs read admins" ON public.conversion_jobs FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'manage_quiz') OR public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "conversion jobs insert admins" ON public.conversion_jobs;
CREATE POLICY "conversion jobs insert admins" ON public.conversion_jobs FOR INSERT TO authenticated
  WITH CHECK (
    (public.has_permission(auth.uid(), 'manage_quiz') OR public.is_super_admin(auth.uid()))
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS "conversion jobs update admins" ON public.conversion_jobs;
CREATE POLICY "conversion jobs update admins" ON public.conversion_jobs FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(), 'manage_quiz') OR public.is_super_admin(auth.uid()))
  WITH CHECK (public.has_permission(auth.uid(), 'manage_quiz') OR public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "conversion jobs delete admins" ON public.conversion_jobs;
CREATE POLICY "conversion jobs delete admins" ON public.conversion_jobs FOR DELETE TO authenticated
  USING (public.has_permission(auth.uid(), 'manage_quiz') OR public.is_super_admin(auth.uid()));
