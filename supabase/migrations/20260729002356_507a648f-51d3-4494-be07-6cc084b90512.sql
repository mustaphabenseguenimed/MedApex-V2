ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS rotation_ids uuid[] NOT NULL DEFAULT '{}';
UPDATE public.questions SET rotation_ids = ARRAY[rotation_id] WHERE rotation_id IS NOT NULL AND (rotation_ids = '{}' OR rotation_ids IS NULL);
CREATE INDEX IF NOT EXISTS questions_rotation_ids_gin ON public.questions USING GIN (rotation_ids);