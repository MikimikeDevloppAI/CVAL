-- Drop existing triggers
DROP TRIGGER IF EXISTS trigger_refresh_besoins_on_besoin ON besoin_effectif;
DROP TRIGGER IF EXISTS trigger_refresh_capacite_on_capacite ON capacite_effective;
DROP TRIGGER IF EXISTS trigger_refresh_besoins_on_planning_bloc ON planning_genere_bloc_operatoire;

-- Modify trigger functions to use advisory locks
-- This ensures they execute only ONCE per transaction, even with multiple INSERTs

CREATE OR REPLACE FUNCTION public.trigger_refresh_besoins()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Acquire a transaction-level advisory lock
  -- This lock is automatically released at transaction end
  -- and prevents multiple calls within the same transaction
  PERFORM pg_advisory_xact_lock(12345678); -- Unique ID for besoin refresh
  
  PERFORM refresh_all_besoins_summaries();
  RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE OR REPLACE FUNCTION public.trigger_refresh_capacite()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Acquire a transaction-level advisory lock for capacite refresh
  PERFORM pg_advisory_xact_lock(87654321); -- Unique ID for capacite refresh
  
  PERFORM refresh_all_besoins_summaries();
  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- Recreate triggers (standard AFTER ... FOR EACH STATEMENT)
-- The advisory lock in the function ensures single execution per transaction

CREATE TRIGGER trigger_refresh_besoins_on_besoin
  AFTER INSERT OR UPDATE OR DELETE ON besoin_effectif
  FOR EACH STATEMENT
  EXECUTE FUNCTION trigger_refresh_besoins();

CREATE TRIGGER trigger_refresh_capacite_on_capacite
  AFTER INSERT OR UPDATE OR DELETE ON capacite_effective
  FOR EACH STATEMENT
  EXECUTE FUNCTION trigger_refresh_capacite();

CREATE TRIGGER trigger_refresh_besoins_on_planning_bloc
  AFTER INSERT OR UPDATE OR DELETE ON planning_genere_bloc_operatoire
  FOR EACH STATEMENT
  EXECUTE FUNCTION trigger_refresh_besoins();