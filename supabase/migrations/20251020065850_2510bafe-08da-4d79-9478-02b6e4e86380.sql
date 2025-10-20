-- Improve handle_horaire_medecin_update to handle 'toute_journee' by deleting both morning and afternoon besoins
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
  v_new_start DATE;
  v_new_end DATE;
  v_periods demi_journee[];
BEGIN
  v_old_start := COALESCE(OLD.date_debut, CURRENT_DATE);
  v_old_end := COALESCE(OLD.date_fin, CURRENT_DATE + INTERVAL '52 weeks');
  v_new_start := COALESCE(NEW.date_debut, CURRENT_DATE);
  v_new_end := COALESCE(NEW.date_fin, CURRENT_DATE + INTERVAL '52 weeks');
  
  IF v_old_start < CURRENT_DATE THEN
    v_old_start := CURRENT_DATE;
  END IF;
  IF v_new_start < CURRENT_DATE THEN
    v_new_start := CURRENT_DATE;
  END IF;

  -- Determine which demi_journee values to delete when OLD was 'toute_journee'
  v_periods := CASE 
    WHEN OLD.demi_journee = 'toute_journee' THEN ARRAY['matin','apres_midi']::demi_journee[]
    ELSE ARRAY[OLD.demi_journee]::demi_journee[]
  END;
  
  -- Delete besoins outside the new date range (for all relevant periods)
  IF v_new_start > v_old_start THEN
    DELETE FROM public.besoin_effectif
    WHERE medecin_id = OLD.medecin_id
      AND demi_journee = ANY(v_periods)
      AND date >= v_old_start
      AND date < v_new_start
      AND type = 'medecin';
  END IF;
  
  IF v_new_end < v_old_end THEN
    DELETE FROM public.besoin_effectif
    WHERE medecin_id = OLD.medecin_id
      AND demi_journee = ANY(v_periods)
      AND date > v_new_end
      AND date <= v_old_end
      AND type = 'medecin';
  END IF;
  
  -- Delete all besoins for this specific schedule (day, period(s)) in the new range
  v_current_date := v_new_start;
  WHILE EXTRACT(ISODOW FROM v_current_date) != OLD.jour_semaine LOOP
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
  
  WHILE v_current_date <= v_new_end LOOP
    DELETE FROM public.besoin_effectif
    WHERE medecin_id = OLD.medecin_id
      AND demi_journee = ANY(v_periods)
      AND date = v_current_date
      AND type = 'medecin';
    v_current_date := v_current_date + INTERVAL '7 days';
  END LOOP;
  
  -- Regenerate with new settings
  PERFORM public.handle_horaire_medecin_insert_logic(NEW);
  
  RETURN NEW;
END;
$function$;