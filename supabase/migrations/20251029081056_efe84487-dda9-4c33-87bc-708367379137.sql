-- Restore missing triggers for automatic materialized view refresh
-- These triggers ensure besoins_*_summary views are updated when data changes

-- 1) Drop any existing triggers to avoid conflicts
DROP TRIGGER IF EXISTS trg_refresh_besoins_on_besoin ON public.besoin_effectif;
DROP TRIGGER IF EXISTS trg_refresh_capacite_on_capacite ON public.capacite_effective;
DROP TRIGGER IF EXISTS trg_refresh_besoins_on_planning_bloc ON public.planning_genere_bloc_operatoire;

-- 2) Create triggers that fire once per statement at end of transaction
CREATE TRIGGER trg_refresh_besoins_on_besoin
AFTER INSERT OR UPDATE OR DELETE ON public.besoin_effectif
FOR EACH STATEMENT
EXECUTE FUNCTION public.trigger_refresh_summaries_deferred();

CREATE TRIGGER trg_refresh_capacite_on_capacite
AFTER INSERT OR UPDATE OR DELETE ON public.capacite_effective
FOR EACH STATEMENT
EXECUTE FUNCTION public.trigger_refresh_summaries_deferred();

CREATE TRIGGER trg_refresh_besoins_on_planning_bloc
AFTER INSERT OR UPDATE OR DELETE ON public.planning_genere_bloc_operatoire
FOR EACH STATEMENT
EXECUTE FUNCTION public.trigger_refresh_summaries_deferred();

-- 3) Immediate refresh to ensure summaries are current
REFRESH MATERIALIZED VIEW public.besoins_sites_summary;
REFRESH MATERIALIZED VIEW public.besoins_bloc_operatoire_summary;
REFRESH MATERIALIZED VIEW public.besoins_fermeture_summary;