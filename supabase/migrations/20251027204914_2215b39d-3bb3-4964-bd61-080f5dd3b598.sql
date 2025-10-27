-- Drop existing triggers if they exist (cleanup)
DROP TRIGGER IF EXISTS trigger_refresh_besoins_on_besoin ON public.besoin_effectif;
DROP TRIGGER IF EXISTS trigger_refresh_capacite_on_capacite ON public.capacite_effective;
DROP TRIGGER IF EXISTS trigger_refresh_besoins_on_planning_bloc ON public.planning_genere_bloc_operatoire;

-- Recreate trigger on besoin_effectif table
CREATE TRIGGER trigger_refresh_besoins_on_besoin
  AFTER INSERT OR UPDATE OR DELETE ON public.besoin_effectif
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_refresh_besoins();

-- Recreate trigger on capacite_effective table
CREATE TRIGGER trigger_refresh_capacite_on_capacite
  AFTER INSERT OR UPDATE OR DELETE ON public.capacite_effective
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_refresh_capacite();

-- Recreate trigger on planning_genere_bloc_operatoire table
CREATE TRIGGER trigger_refresh_besoins_on_planning_bloc
  AFTER INSERT OR UPDATE OR DELETE ON public.planning_genere_bloc_operatoire
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_refresh_besoins();

-- Force immediate refresh of all three materialized views
REFRESH MATERIALIZED VIEW besoins_sites_summary;
REFRESH MATERIALIZED VIEW besoins_bloc_operatoire_summary;
REFRESH MATERIALIZED VIEW besoins_fermeture_summary;