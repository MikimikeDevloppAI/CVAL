-- Fix handle_horaire_secretaire_update to properly handle alternance changes
-- This ensures that when modulo or alternance_type changes, old capacities are correctly deleted
-- based on the OLD modulo, and new ones are created based on the NEW modulo

CREATE OR REPLACE FUNCTION public.handle_horaire_secretaire_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_current_date DATE;
  v_old_start DATE;
  v_old_end DATE;
  v_should_work BOOLEAN;
BEGIN
  -- Calculate the date range for the old schedule
  v_old_start := COALESCE(OLD.date_debut, CURRENT_DATE);
  v_old_end := COALESCE(OLD.date_fin, CURRENT_DATE + INTERVAL '52 weeks');
  
  -- Limit to present and future only
  IF v_old_start < CURRENT_DATE THEN
    v_old_start := CURRENT_DATE;
  END IF;
  
  -- Find the first day matching OLD.jour_semaine
  v_current_date := v_old_start;
  WHILE EXTRACT(ISODOW FROM v_current_date) != OLD.jour_semaine LOOP
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
  
  -- Delete old capacities based on OLD alternance rules
  WHILE v_current_date <= v_old_end LOOP
    -- Check if secretary should work according to OLD alternance
    v_should_work := CASE COALESCE(OLD.alternance_type, 'hebdomadaire'::type_alternance)
      WHEN 'hebdomadaire' THEN true
      WHEN 'une_sur_deux' THEN ((EXTRACT(WEEK FROM v_current_date)::integer) % 2 = COALESCE(OLD.alternance_semaine_modulo, 0))
      WHEN 'une_sur_trois' THEN ((EXTRACT(WEEK FROM v_current_date)::integer) % 3 = COALESCE(OLD.alternance_semaine_modulo, 0))
      WHEN 'une_sur_quatre' THEN ((EXTRACT(WEEK FROM v_current_date)::integer) % 4 = COALESCE(OLD.alternance_semaine_modulo, 0))
      WHEN 'trois_sur_quatre' THEN ((EXTRACT(WEEK FROM v_current_date)::integer) % 4 != COALESCE(OLD.alternance_semaine_modulo, 0))
      ELSE true
    END;
    
    -- Only delete if secretary was supposed to work on this date
    IF v_should_work THEN
      IF OLD.demi_journee = 'toute_journee' THEN
        -- For toute_journee, delete both matin AND apres_midi for this site
        DELETE FROM public.capacite_effective
        WHERE secretaire_id = OLD.secretaire_id
          AND site_id IS NOT DISTINCT FROM OLD.site_id
          AND date = v_current_date
          AND demi_journee IN ('matin', 'apres_midi');
      ELSE
        -- For matin or apres_midi, delete only the specific period
        DELETE FROM public.capacite_effective
        WHERE secretaire_id = OLD.secretaire_id
          AND site_id IS NOT DISTINCT FROM OLD.site_id
          AND date = v_current_date
          AND demi_journee = OLD.demi_journee;
      END IF;
    END IF;
    
    v_current_date := v_current_date + INTERVAL '7 days';
  END LOOP;
  
  -- Create new capacities based on NEW alternance rules
  PERFORM public.handle_horaire_secretaire_insert_logic(NEW);
  
  RETURN NEW;
END;
$function$;