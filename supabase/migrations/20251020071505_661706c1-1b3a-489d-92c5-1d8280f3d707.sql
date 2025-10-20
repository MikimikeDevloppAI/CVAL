-- Fix handle_horaire_medecin_delete to handle alternance patterns
CREATE OR REPLACE FUNCTION public.handle_horaire_medecin_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_current_date date;
  v_end_date date;
  v_should_work boolean;
BEGIN
  v_current_date := CURRENT_DATE;
  v_end_date := CURRENT_DATE + INTERVAL '52 weeks';
  
  -- Find first day matching the day of week
  WHILE EXTRACT(ISODOW FROM v_current_date) != OLD.jour_semaine LOOP
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
  
  -- Loop through all matching dates and check alternance
  WHILE v_current_date <= v_end_date LOOP
    -- Check if doctor should work on this date according to alternance
    v_should_work := public.should_doctor_work(
      OLD.alternance_type,
      OLD.alternance_semaine_modulo,
      v_current_date
    );
    
    -- Only delete if doctor was supposed to work
    IF v_should_work THEN
      IF OLD.demi_journee = 'toute_journee' THEN
        -- For toute_journee, delete both matin AND apres_midi for this site
        DELETE FROM public.besoin_effectif
        WHERE medecin_id = OLD.medecin_id
          AND site_id = OLD.site_id
          AND date = v_current_date
          AND type = 'medecin'
          AND demi_journee IN ('matin', 'apres_midi');
      ELSE
        -- For matin or apres_midi, delete only the specific period
        DELETE FROM public.besoin_effectif
        WHERE medecin_id = OLD.medecin_id
          AND site_id = OLD.site_id
          AND date = v_current_date
          AND type = 'medecin'
          AND demi_journee = OLD.demi_journee;
      END IF;
    END IF;
    
    v_current_date := v_current_date + INTERVAL '7 days';
  END LOOP;
  
  RETURN OLD;
END;
$function$;

-- Fix handle_horaire_medecin_update to handle alternance patterns
CREATE OR REPLACE FUNCTION public.handle_horaire_medecin_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_current_date DATE;
  v_old_start DATE;
  v_old_end DATE;
  v_should_work BOOLEAN;
BEGIN
  v_old_start := COALESCE(OLD.date_debut, CURRENT_DATE);
  v_old_end := COALESCE(OLD.date_fin, CURRENT_DATE + INTERVAL '52 weeks');
  
  IF v_old_start < CURRENT_DATE THEN
    v_old_start := CURRENT_DATE;
  END IF;

  -- Find first day matching the day of week
  v_current_date := v_old_start;
  WHILE EXTRACT(ISODOW FROM v_current_date) != OLD.jour_semaine LOOP
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
  
  -- Delete only besoins where doctor was supposed to work according to OLD alternance
  WHILE v_current_date <= v_old_end LOOP
    v_should_work := public.should_doctor_work(
      OLD.alternance_type,
      OLD.alternance_semaine_modulo,
      v_current_date
    );
    
    IF v_should_work THEN
      IF OLD.demi_journee = 'toute_journee' THEN
        DELETE FROM public.besoin_effectif
        WHERE medecin_id = OLD.medecin_id
          AND site_id = OLD.site_id
          AND date = v_current_date
          AND type = 'medecin'
          AND demi_journee IN ('matin', 'apres_midi');
      ELSE
        DELETE FROM public.besoin_effectif
        WHERE medecin_id = OLD.medecin_id
          AND site_id = OLD.site_id
          AND date = v_current_date
          AND type = 'medecin'
          AND demi_journee = OLD.demi_journee;
      END IF;
    END IF;
    
    v_current_date := v_current_date + INTERVAL '7 days';
  END LOOP;
  
  -- Regenerate with new settings
  PERFORM public.handle_horaire_medecin_insert_logic(NEW);
  
  RETURN NEW;
END;
$function$;

-- Fix handle_horaire_secretaire_delete to handle alternance patterns
CREATE OR REPLACE FUNCTION public.handle_horaire_secretaire_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_current_date date;
  v_end_date date;
  v_should_work boolean;
BEGIN
  v_current_date := CURRENT_DATE;
  v_end_date := CURRENT_DATE + INTERVAL '52 weeks';
  
  -- Find first day matching the day of week
  WHILE EXTRACT(ISODOW FROM v_current_date) != OLD.jour_semaine LOOP
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
  
  -- Loop through all matching dates
  WHILE v_current_date <= v_end_date LOOP
    -- Check if secretary should work according to alternance
    v_should_work := CASE COALESCE(OLD.alternance_type, 'hebdomadaire'::type_alternance)
      WHEN 'hebdomadaire' THEN true
      WHEN 'une_sur_deux' THEN ((EXTRACT(WEEK FROM v_current_date)::integer) % 2 = COALESCE(OLD.alternance_semaine_modulo, 0))
      WHEN 'une_sur_trois' THEN ((EXTRACT(WEEK FROM v_current_date)::integer) % 3 = COALESCE(OLD.alternance_semaine_modulo, 0))
      WHEN 'une_sur_quatre' THEN ((EXTRACT(WEEK FROM v_current_date)::integer) % 4 = COALESCE(OLD.alternance_semaine_modulo, 0))
      ELSE true
    END;
    
    IF v_should_work THEN
      IF OLD.demi_journee = 'toute_journee' THEN
        -- For toute_journee, delete both matin AND apres_midi
        DELETE FROM public.capacite_effective
        WHERE secretaire_id = OLD.secretaire_id
          AND date = v_current_date
          AND site_id = OLD.site_id
          AND demi_journee IN ('matin', 'apres_midi');
      ELSE
        -- For matin or apres_midi, delete only the specific period
        DELETE FROM public.capacite_effective
        WHERE secretaire_id = OLD.secretaire_id
          AND date = v_current_date
          AND site_id = OLD.site_id
          AND demi_journee = OLD.demi_journee;
      END IF;
    END IF;
    
    v_current_date := v_current_date + INTERVAL '7 days';
  END LOOP;
  
  RETURN OLD;
END;
$function$;