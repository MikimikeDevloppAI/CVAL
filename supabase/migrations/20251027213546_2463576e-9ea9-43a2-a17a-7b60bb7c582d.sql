-- Fix triggers to refresh materialized views on every change
-- The issue: triggers were FOR EACH STATEMENT but functions tried to access NEW/OLD.date
-- Solution: Make triggers FOR EACH ROW and simplify logic to always refresh

-- 1) Recreate the refresh function (without CONCURRENTLY, which doesn't work in triggers)
CREATE OR REPLACE FUNCTION public.refresh_all_besoins_summaries()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW besoins_sites_summary;
  REFRESH MATERIALIZED VIEW besoins_bloc_operatoire_summary;
  REFRESH MATERIALIZED VIEW besoins_fermeture_summary;
END;
$$;

-- 2) Update trigger functions to always refresh (no date filtering)
-- Keep the guard to prevent multiple refreshes in same transaction
CREATE OR REPLACE FUNCTION public.trigger_refresh_besoins()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Run only once per transaction
  IF current_setting('app.besoins_refreshed', true) IS NULL THEN
    PERFORM set_config('app.besoins_refreshed', '1', true);
    PERFORM refresh_all_besoins_summaries();
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_refresh_capacite()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Run only once per transaction
  IF current_setting('app.besoins_refreshed', true) IS NULL THEN
    PERFORM set_config('app.besoins_refreshed', '1', true);
    PERFORM refresh_all_besoins_summaries();
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 3) Drop existing triggers
DROP TRIGGER IF EXISTS trigger_refresh_besoins_on_besoin ON public.besoin_effectif;
DROP TRIGGER IF EXISTS trigger_refresh_capacite_on_capacite ON public.capacite_effective;
DROP TRIGGER IF EXISTS trigger_refresh_besoins_on_planning_bloc ON public.planning_genere_bloc_operatoire;

-- 4) Recreate triggers as FOR EACH ROW (so NEW/OLD are available)
CREATE TRIGGER trigger_refresh_besoins_on_besoin
  AFTER INSERT OR UPDATE OR DELETE ON public.besoin_effectif
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_refresh_besoins();

CREATE TRIGGER trigger_refresh_capacite_on_capacite
  AFTER INSERT OR UPDATE OR DELETE ON public.capacite_effective
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_refresh_capacite();

CREATE TRIGGER trigger_refresh_besoins_on_planning_bloc
  AFTER INSERT OR UPDATE OR DELETE ON public.planning_genere_bloc_operatoire
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_refresh_besoins();

-- 5) Perform immediate full refresh to ensure views are up-to-date
REFRESH MATERIALIZED VIEW besoins_sites_summary;
REFRESH MATERIALIZED VIEW besoins_bloc_operatoire_summary;
REFRESH MATERIALIZED VIEW besoins_fermeture_summary;