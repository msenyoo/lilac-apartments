-- Migration 029: Corpus Fund v2 helpers
-- Adds get_overlapping_active_plans() for overlap detection at plan activation time.
-- No schema changes — function only.

CREATE OR REPLACE FUNCTION public.get_overlapping_active_plans(
  p_start int,
  p_end   int
)
RETURNS TABLE(id uuid, name text, start_fiscal_year int, end_fiscal_year int)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    id,
    name,
    start_fiscal_year,
    end_fiscal_year
  FROM corpus_plans
  WHERE status = 'active'
    AND start_fiscal_year <= p_end
    AND end_fiscal_year   >= p_start;
$$;

GRANT EXECUTE ON FUNCTION public.get_overlapping_active_plans(int, int) TO authenticated;
