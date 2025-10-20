-- Remove the trigger that clears bloc IDs on capacite_effective updates/inserts
-- This keeps planning_genere_bloc_operatoire_id and besoin_operation_id intact regardless of site_id changes

-- Drop only the trigger, keep the underlying function in case it's referenced elsewhere
DROP TRIGGER IF EXISTS cleanup_bloc_on_capacite_effective ON public.capacite_effective;