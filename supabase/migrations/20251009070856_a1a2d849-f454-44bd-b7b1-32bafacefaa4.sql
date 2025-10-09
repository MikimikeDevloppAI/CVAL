-- Fix the trigger to properly handle date ranges and generate correct besoin_effectif
-- This will ensure that when there are multiple schedules for the same day with different date ranges,
-- all of them are properly processed

CREATE OR REPLACE FUNCTION public.handle_horaire_medecin_insert_logic(p_horaire record)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_current_date DATE;
  v_start_date DATE;
  v_end_date DATE;
  v_semaines_diff INTEGER;
  v_should_work BOOLEAN;
  v_abs_full INTEGER;
  v_abs_start TIME;
  v_abs_end TIME;
  v_seg_start TIME;
  v_seg_end TIME;
BEGIN
  -- Determine start and end dates for this specific schedule
  v_start_date := COALESCE(p_horaire.date_debut, CURRENT_DATE);
  v_end_date := COALESCE(p_horaire.date_fin, CURRENT_DATE + INTERVAL '52 weeks');
  
  -- Don't generate past data
  IF v_start_date < CURRENT_DATE THEN
    v_start_date := CURRENT_DATE;
  END IF;
  
  -- Find the first occurrence of this day of week within the date range
  v_current_date := v_start_date;
  
  WHILE EXTRACT(ISODOW FROM v_current_date) != p_horaire.jour_semaine LOOP
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
  
  -- Generate besoin_effectif for each occurrence
  WHILE v_current_date <= v_end_date LOOP
    -- Check alternance pattern
    v_semaines_diff := FLOOR((v_current_date - p_horaire.alternance_semaine_reference) / 7);
    
    v_should_work := CASE p_horaire.alternance_type
      WHEN 'hebdomadaire' THEN true
      WHEN 'une_sur_deux' THEN (v_semaines_diff % 2 = 0)
      WHEN 'une_sur_trois' THEN (v_semaines_diff % 3 = 0)
      WHEN 'une_sur_quatre' THEN (v_semaines_diff % 4 = 0)
      ELSE true
    END;
    
    IF v_should_work THEN
      -- Check for full-day absences
      SELECT COUNT(*) INTO v_abs_full
      FROM public.absences
      WHERE medecin_id = p_horaire.medecin_id
        AND v_current_date BETWEEN date_debut AND date_fin
        AND statut IN ('approuve', 'en_attente')
        AND heure_debut IS NULL AND heure_fin IS NULL;
      
      IF v_abs_full = 0 THEN
        -- Check for partial-day absences
        SELECT MIN(heure_debut), MAX(heure_fin)
        INTO v_abs_start, v_abs_end
        FROM public.absences
        WHERE medecin_id = p_horaire.medecin_id
          AND v_current_date BETWEEN date_debut AND date_fin
          AND statut IN ('approuve', 'en_attente')
          AND heure_debut IS NOT NULL AND heure_fin IS NOT NULL;

        IF v_abs_start IS NULL OR v_abs_end IS NULL THEN
          -- No partial absence, insert full schedule
          INSERT INTO public.besoin_effectif (
            date, type, medecin_id, site_id,
            heure_debut, heure_fin
          ) VALUES (
            v_current_date, 'medecin', p_horaire.medecin_id, p_horaire.site_id,
            p_horaire.heure_debut, p_horaire.heure_fin
          )
          ON CONFLICT DO NOTHING;
        ELSE
          -- Handle partial absence - create segments before and after
          v_seg_start := p_horaire.heure_debut;
          v_seg_end := LEAST(v_abs_start, p_horaire.heure_fin);
          IF v_seg_start < v_seg_end AND (v_seg_end - v_seg_start) >= INTERVAL '30 minutes' THEN
            INSERT INTO public.besoin_effectif (
              date, type, medecin_id, site_id,
              heure_debut, heure_fin
            ) VALUES (
              v_current_date, 'medecin', p_horaire.medecin_id, p_horaire.site_id,
              v_seg_start, v_seg_end
            )
            ON CONFLICT DO NOTHING;
          END IF;

          v_seg_start := GREATEST(v_abs_end, p_horaire.heure_debut);
          v_seg_end := p_horaire.heure_fin;
          IF v_seg_start < v_seg_end AND (v_seg_end - v_seg_start) >= INTERVAL '30 minutes' THEN
            INSERT INTO public.besoin_effectif (
              date, type, medecin_id, site_id,
              heure_debut, heure_fin
            ) VALUES (
              v_current_date, 'medecin', p_horaire.medecin_id, p_horaire.site_id,
              v_seg_start, v_seg_end
            )
            ON CONFLICT DO NOTHING;
          END IF;
        END IF;
      END IF;
    END IF;
    
    v_current_date := v_current_date + INTERVAL '7 days';
  END LOOP;
END;
$function$;

-- Update the update trigger to properly clean up and regenerate
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
BEGIN
  v_old_start := COALESCE(OLD.date_debut, CURRENT_DATE);
  v_old_end := COALESCE(OLD.date_fin, CURRENT_DATE + INTERVAL '52 weeks');
  v_new_start := COALESCE(NEW.date_debut, CURRENT_DATE);
  v_new_end := COALESCE(NEW.date_fin, CURRENT_DATE + INTERVAL '52 weeks');
  
  -- Don't regenerate the past
  IF v_old_start < CURRENT_DATE THEN
    v_old_start := CURRENT_DATE;
  END IF;
  IF v_new_start < CURRENT_DATE THEN
    v_new_start := CURRENT_DATE;
  END IF;
  
  -- Delete entries for dates that are no longer valid
  -- Only delete for this specific schedule's date range and day
  v_current_date := v_old_start;
  WHILE EXTRACT(ISODOW FROM v_current_date) != OLD.jour_semaine LOOP
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
  
  WHILE v_current_date <= v_old_end LOOP
    -- Only delete if this is the only schedule for this day and date
    -- Or if the schedule changed significantly
    DELETE FROM public.besoin_effectif
    WHERE medecin_id = OLD.medecin_id
      AND date = v_current_date
      AND type = 'medecin'
      AND site_id = OLD.site_id
      AND heure_debut = OLD.heure_debut
      AND heure_fin = OLD.heure_fin;
      
    v_current_date := v_current_date + INTERVAL '7 days';
  END LOOP;
  
  -- Regenerate with new schedule
  PERFORM public.handle_horaire_medecin_insert_logic(NEW);
  
  RETURN NEW;
END;
$function$;