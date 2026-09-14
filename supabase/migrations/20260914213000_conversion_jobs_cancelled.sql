-- A background conversion can now be cancelled from the page: the worker
-- checks the row between pages and stops, and a cancelled job is never
-- claimed again. The status column's check constraint has to admit the new
-- value first.

ALTER TABLE public.conversion_jobs DROP CONSTRAINT IF EXISTS conversion_jobs_status_check;
ALTER TABLE public.conversion_jobs ADD CONSTRAINT conversion_jobs_status_check
  CHECK (status IN ('pending', 'running', 'done', 'error', 'cancelled'));
