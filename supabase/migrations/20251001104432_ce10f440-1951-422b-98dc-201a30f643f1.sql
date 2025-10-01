-- Modify the recalculate_base_schedule_optimization function to call the MILP edge function
CREATE OR REPLACE FUNCTION public.recalculate_base_schedule_optimization()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_response_id bigint;
BEGIN
  -- Call the MILP edge function via pg_net
  SELECT net.http_post(
    url := 'https://xvuugxjseavbxpxhfprb.supabase.co/functions/v1/optimize-base-schedule-milp',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{}'::jsonb
  ) INTO v_response_id;
  
  -- Log the request
  RAISE NOTICE 'MILP optimization triggered via edge function (request_id: %)', v_response_id;
END;
$function$;

-- Ensure pg_net extension is enabled
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Grant necessary permissions
GRANT USAGE ON SCHEMA net TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA net TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA net TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA net TO postgres, anon, authenticated, service_role;