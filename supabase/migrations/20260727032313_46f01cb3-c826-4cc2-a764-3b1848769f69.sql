ALTER TABLE public.qcm_sessions
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS module_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS sort_mode text;