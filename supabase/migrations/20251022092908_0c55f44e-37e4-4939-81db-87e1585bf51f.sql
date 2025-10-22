-- Replace the refresh function with a version that has exception handling
CREATE OR REPLACE FUNCTION public.refresh_besoins_non_satisfaits()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  BEGIN
    -- Try concurrent refresh first (faster, non-blocking)
    REFRESH MATERIALIZED VIEW CONCURRENTLY besoins_non_satisfaits_summary;
  EXCEPTION
    WHEN OTHERS THEN
      -- Fallback to standard refresh if concurrent fails
      -- (e.g., during transactions, temporary index issues, etc.)
      REFRESH MATERIALIZED VIEW besoins_non_satisfaits_summary;
  END;
END;
$function$;

-- Perform initial refresh to ensure clean state
REFRESH MATERIALIZED VIEW public.besoins_non_satisfaits_summary;