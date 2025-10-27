-- Optimize triggers to refresh materialized views only for changes within next 6 weeks

CREATE OR REPLACE FUNCTION public.trigger_refresh_besoins()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_date_limite DATE := CURRENT_DATE + INTERVAL '6 weeks';
BEGIN
  -- Vérifier si la modification concerne les 6 prochaines semaines
  IF (TG_OP = 'DELETE' AND OLD.date >= CURRENT_DATE AND OLD.date <= v_date_limite) OR
     (TG_OP IN ('INSERT', 'UPDATE') AND NEW.date >= CURRENT_DATE AND NEW.date <= v_date_limite) THEN
    
    -- Run only once per transaction
    IF current_setting('app.besoins_refreshed', true) IS NULL THEN
      PERFORM set_config('app.besoins_refreshed', '1', true);
      PERFORM refresh_all_besoins_summaries();
    END IF;
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
DECLARE
  v_date_limite DATE := CURRENT_DATE + INTERVAL '6 weeks';
BEGIN
  -- Vérifier si la modification concerne les 6 prochaines semaines
  IF (TG_OP = 'DELETE' AND OLD.date >= CURRENT_DATE AND OLD.date <= v_date_limite) OR
     (TG_OP IN ('INSERT', 'UPDATE') AND NEW.date >= CURRENT_DATE AND NEW.date <= v_date_limite) THEN
    
    -- Share the same flag so only one refresh occurs for both besoins/capacités in a tx
    IF current_setting('app.besoins_refreshed', true) IS NULL THEN
      PERFORM set_config('app.besoins_refreshed', '1', true);
      PERFORM refresh_all_besoins_summaries();
    END IF;
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$function$;