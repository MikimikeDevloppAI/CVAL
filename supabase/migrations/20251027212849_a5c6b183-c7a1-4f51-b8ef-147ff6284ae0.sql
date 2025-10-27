-- 1. Recreate refresh function without CONCURRENTLY for reliability
CREATE OR REPLACE FUNCTION public.refresh_all_besoins_summaries()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Use standard REFRESH (not CONCURRENTLY) for reliability in trigger context
  REFRESH MATERIALIZED VIEW besoins_sites_summary;
  REFRESH MATERIALIZED VIEW besoins_bloc_operatoire_summary;
  REFRESH MATERIALIZED VIEW besoins_fermeture_summary;
END;
$$;

-- 2. Drop existing triggers
DROP TRIGGER IF EXISTS trigger_refresh_besoins_on_besoin ON public.besoin_effectif;
DROP TRIGGER IF EXISTS trigger_refresh_capacite_on_capacite ON public.capacite_effective;
DROP TRIGGER IF EXISTS trigger_refresh_besoins_on_planning_bloc ON public.planning_genere_bloc_operatoire;

-- 3. Recreate triggers as FOR EACH STATEMENT (not FOR EACH ROW) for efficiency
CREATE TRIGGER trigger_refresh_besoins_on_besoin
  AFTER INSERT OR UPDATE OR DELETE ON public.besoin_effectif
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.trigger_refresh_besoins();

CREATE TRIGGER trigger_refresh_capacite_on_capacite
  AFTER INSERT OR UPDATE OR DELETE ON public.capacite_effective
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.trigger_refresh_capacite();

CREATE TRIGGER trigger_refresh_besoins_on_planning_bloc
  AFTER INSERT OR UPDATE OR DELETE ON public.planning_genere_bloc_operatoire
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.trigger_refresh_besoins();

-- 4. Initial refresh to sync views with current state
REFRESH MATERIALIZED VIEW besoins_sites_summary;
REFRESH MATERIALIZED VIEW besoins_bloc_operatoire_summary;
REFRESH MATERIALIZED VIEW besoins_fermeture_summary;