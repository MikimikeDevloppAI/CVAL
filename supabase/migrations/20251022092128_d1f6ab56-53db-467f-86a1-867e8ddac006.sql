-- Drop the non-unique index with WHERE clause (if it exists)
DROP INDEX IF EXISTS public.idx_besoins_non_satisfaits_pgbo;

-- Create a UNIQUE index on the materialized view using COALESCE to handle NULLs
-- This allows REFRESH MATERIALIZED VIEW CONCURRENTLY to work
CREATE UNIQUE INDEX idx_besoins_non_satisfaits_unique 
ON public.besoins_non_satisfaits_summary (
  date,
  periode,
  site_id,
  COALESCE(planning_genere_bloc_operatoire_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(besoin_operation_id, '00000000-0000-0000-0000-000000000000'::uuid),
  type_besoin
);