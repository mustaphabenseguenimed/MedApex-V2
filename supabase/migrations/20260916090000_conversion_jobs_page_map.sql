-- A screenshot PDF whose pages are metres tall is now uploaded cut into
-- slices, so one page of the admin's file can become several pages of the
-- uploaded one. This records where each uploaded page came from, so the page
-- number shown next to a question still refers to their own file.
-- Null for a job whose file was uploaded unchanged.

ALTER TABLE public.conversion_jobs ADD COLUMN IF NOT EXISTS page_map integer[];
