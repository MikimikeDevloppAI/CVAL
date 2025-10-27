-- Update trigger functions to run refresh only once per transaction using a GUC flag

CREATE OR REPLACE FUNCTION public.trigger_refresh_besoins()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Run only once per transaction
  IF current_setting('app.besoins_refreshed', true) IS NULL THEN
    PERFORM set_config('app.besoins_refreshed', '1', true);
    PERFORM refresh_all_besoins_summaries();
  END IF;
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
  -- Share the same flag so only one refresh occurs for both besoins/capacités in a tx
  IF current_setting('app.besoins_refreshed', true) IS NULL THEN
    PERFORM set_config('app.besoins_refreshed', '1', true);
    PERFORM refresh_all_besoins_summaries();
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;