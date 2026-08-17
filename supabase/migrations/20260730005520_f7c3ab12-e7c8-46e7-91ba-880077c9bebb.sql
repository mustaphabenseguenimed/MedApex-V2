ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS exam_years smallint[] NOT NULL DEFAULT '{}';

UPDATE public.questions SET exam_years = ARRAY[exam_year::smallint]
WHERE exam_year IS NOT NULL AND (exam_years IS NULL OR array_length(exam_years, 1) IS NULL);

CREATE OR REPLACE FUNCTION public.sync_question_exam_year()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE _years smallint[];
BEGIN
  _years := COALESCE(NEW.exam_years, '{}');
  IF array_length(_years, 1) IS NULL AND NEW.exam_year IS NOT NULL THEN
    NEW.exam_years := ARRAY[NEW.exam_year::smallint];
    RETURN NEW;
  END IF;
  IF array_length(_years, 1) IS NOT NULL THEN
    SELECT array_agg(DISTINCT y ORDER BY y) INTO NEW.exam_years FROM unnest(_years) AS y WHERE y IS NOT NULL;
    SELECT max(y) INTO NEW.exam_year FROM unnest(NEW.exam_years) AS y;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_sync_question_exam_year ON public.questions;
CREATE TRIGGER trg_sync_question_exam_year
BEFORE INSERT OR UPDATE ON public.questions
FOR EACH ROW EXECUTE FUNCTION public.sync_question_exam_year();