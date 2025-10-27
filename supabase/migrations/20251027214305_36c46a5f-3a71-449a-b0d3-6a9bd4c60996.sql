-- Reliable end-of-transaction refresh for summary materialized views
-- Using regular AFTER triggers + SET CONSTRAINTS DEFERRED approach

-- 1) Ensure the refresh function exists and does not use CONCURRENTLY
CREATE OR REPLACE FUNCTION public.refresh_all_besoins_summaries()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW public.besoins_sites_summary;
  REFRESH MATERIALIZED VIEW public.besoins_bloc_operatoire_summary;
  REFRESH MATERIALIZED VIEW public.besoins_fermeture_summary;
END;
$$;

-- 2) Create a deferred trigger function that runs once per transaction
CREATE OR REPLACE FUNCTION public.trigger_refresh_summaries_deferred()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Only once per transaction across all tables using this trigger
  IF current_setting('app.besoins_refreshed', true) IS NULL THEN
    PERFORM set_config('app.besoins_refreshed', '1', true);
    -- Optional diagnostic log for debugging
    RAISE NOTICE 'Refreshing summary views at tx end (src table=%, op=%)', TG_TABLE_NAME, TG_OP;
    PERFORM public.refresh_all_besoins_summaries();
  END IF;
  RETURN NULL; -- For AFTER triggers, return value is ignored
END;
$$;

-- 3) Drop all existing triggers that might conflict
DROP TRIGGER IF EXISTS trigger_refresh_besoins_on_besoin ON public.besoin_effectif;
DROP TRIGGER IF EXISTS trigger_refresh_capacite_on_capacite ON public.capacite_effective;
DROP TRIGGER IF EXISTS trigger_refresh_besoins_on_planning_bloc ON public.planning_genere_bloc_operatoire;
DROP TRIGGER IF EXISTS ctg_refresh_besoins_on_besoin ON public.besoin_effectif;
DROP TRIGGER IF EXISTS ctg_refresh_capacite_on_capacite ON public.capacite_effective;
DROP TRIGGER IF EXISTS ctg_refresh_besoins_on_planning_bloc ON public.planning_genere_bloc_operatoire;
DROP TRIGGER IF EXISTS trg_refresh_besoins_on_besoin ON public.besoin_effectif;
DROP TRIGGER IF EXISTS trg_refresh_capacite_on_capacite ON public.capacite_effective;
DROP TRIGGER IF EXISTS trg_refresh_besoins_on_planning_bloc ON public.planning_genere_bloc_operatoire;

-- 4) Create new AFTER triggers that fire once per statement
-- These will execute at the end of the transaction before COMMIT
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

-- 5) Immediate full refresh to ensure summaries are up-to-date
REFRESH MATERIALIZED VIEW public.besoins_sites_summary;
REFRESH MATERIALIZED VIEW public.besoins_bloc_operatoire_summary;
REFRESH MATERIALIZED VIEW public.besoins_fermeture_summary;