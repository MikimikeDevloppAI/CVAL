-- Drop old function and unschedule old cron job
DROP FUNCTION IF EXISTS public.weekly_planning_maintenance() CASCADE;
SELECT cron.unschedule('weekly-planning-maintenance');

-- Create the new weekly planning maintenance function
CREATE OR REPLACE FUNCTION public.weekly_planning_maintenance()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_current_monday DATE;
  v_new_week_start DATE;
  v_new_week_end DATE;
  v_current_date DATE;
  v_jour_semaine INTEGER;
  v_medecin RECORD;
  v_horaire_medecin RECORD;
  v_secretaire RECORD;
  v_horaire_secretaire RECORD;
  v_abs_full INTEGER;
  v_is_holiday BOOLEAN;
  v_should_work BOOLEAN;
  v_site_id UUID;
  v_besoin_count INTEGER := 0;
  v_capacite_count INTEGER := 0;
BEGIN
  -- Calculate the Monday of the current week
  v_current_monday := CURRENT_DATE - (EXTRACT(ISODOW FROM CURRENT_DATE)::integer - 1) * INTERVAL '1 day';
  
  -- Calculate week +52 (Monday to Sunday)
  v_new_week_start := v_current_monday + INTERVAL '52 weeks';
  v_new_week_end := v_new_week_start + INTERVAL '6 days';
  
  RAISE NOTICE 'Starting weekly planning maintenance for week % to %', v_new_week_start, v_new_week_end;
  
  -- Clean week +52 data only
  DELETE FROM public.besoin_effectif 
  WHERE date >= v_new_week_start AND date <= v_new_week_end;
  
  DELETE FROM public.capacite_effective 
  WHERE date >= v_new_week_start AND date <= v_new_week_end;
  
  RAISE NOTICE 'Cleaned existing data for week +52';
  
  -- Loop through each day of week +52
  v_current_date := v_new_week_start;
  
  WHILE v_current_date <= v_new_week_end LOOP
    v_jour_semaine := EXTRACT(ISODOW FROM v_current_date);
    
    -- Check if it's a holiday
    SELECT EXISTS(
      SELECT 1 FROM public.jours_feries
      WHERE date = v_current_date AND actif = true
    ) INTO v_is_holiday;
    
    -- Skip holidays
    IF NOT v_is_holiday THEN
      -- ==================================================
      -- GENERATE BESOINS EFFECTIFS (MEDECINS)
      -- ==================================================
      FOR v_medecin IN
        SELECT id FROM public.medecins WHERE actif = true
      LOOP
        FOR v_horaire_medecin IN
          SELECT * FROM public.horaires_base_medecins
          WHERE medecin_id = v_medecin.id
            AND jour_semaine = v_jour_semaine
            AND actif = true
            AND (date_debut IS NULL OR v_current_date >= date_debut)
            AND (date_fin IS NULL OR v_current_date <= date_fin)
        LOOP
          -- Check if doctor should work according to alternance
          v_should_work := public.should_doctor_work(
            v_horaire_medecin.alternance_type,
            v_horaire_medecin.alternance_semaine_modulo,
            v_current_date
          );
          
          IF v_should_work THEN
            -- Check for full-day absence
            SELECT COUNT(*) INTO v_abs_full
            FROM public.absences
            WHERE medecin_id = v_medecin.id
              AND v_current_date BETWEEN date_debut AND date_fin
              AND statut IN ('approuve', 'en_attente')
              AND heure_debut IS NULL AND heure_fin IS NULL;
            
            -- Insert besoin_effectif if no full-day absence
            IF v_abs_full = 0 THEN
              INSERT INTO public.besoin_effectif (
                date, type, medecin_id, site_id, demi_journee, type_intervention_id
              ) VALUES (
                v_current_date, 
                'medecin', 
                v_medecin.id, 
                v_horaire_medecin.site_id,
                v_horaire_medecin.demi_journee,
                v_horaire_medecin.type_intervention_id
              )
              ON CONFLICT DO NOTHING;
              
              v_besoin_count := v_besoin_count + 1;
            END IF;
          END IF;
        END LOOP;
      END LOOP;
      
      -- ==================================================
      -- GENERATE CAPACITES EFFECTIVES (SECRETAIRES)
      -- ==================================================
      FOR v_secretaire IN
        SELECT id FROM public.secretaires WHERE actif = true
      LOOP
        FOR v_horaire_secretaire IN
          SELECT * FROM public.horaires_base_secretaires
          WHERE secretaire_id = v_secretaire.id
            AND jour_semaine = v_jour_semaine
            AND actif = true
            AND (date_debut IS NULL OR v_current_date >= date_debut)
            AND (date_fin IS NULL OR v_current_date <= date_fin)
        LOOP
          -- Check if secretary should work according to alternance
          v_should_work := CASE COALESCE(v_horaire_secretaire.alternance_type, 'hebdomadaire'::type_alternance)
            WHEN 'hebdomadaire' THEN true
            WHEN 'une_sur_deux' THEN ((EXTRACT(WEEK FROM v_current_date)::integer) % 2 = COALESCE(v_horaire_secretaire.alternance_semaine_modulo, 0))
            WHEN 'une_sur_trois' THEN ((EXTRACT(WEEK FROM v_current_date)::integer) % 3 = COALESCE(v_horaire_secretaire.alternance_semaine_modulo, 0))
            WHEN 'une_sur_quatre' THEN ((EXTRACT(WEEK FROM v_current_date)::integer) % 4 = COALESCE(v_horaire_secretaire.alternance_semaine_modulo, 0))
            ELSE true
          END;
          
          IF v_should_work THEN
            -- Check for full-day absence
            SELECT COUNT(*) INTO v_abs_full
            FROM public.absences
            WHERE secretaire_id = v_secretaire.id
              AND v_current_date BETWEEN date_debut AND date_fin
              AND statut IN ('approuve', 'en_attente')
              AND heure_debut IS NULL AND heure_fin IS NULL;
            
            -- Insert capacite_effective if no full-day absence
            IF v_abs_full = 0 THEN
              -- Use admin site as default if site_id is NULL
              v_site_id := COALESCE(v_horaire_secretaire.site_id, '00000000-0000-0000-0000-000000000001'::uuid);
              
              INSERT INTO public.capacite_effective (
                date, secretaire_id, demi_journee, site_id
              ) VALUES (
                v_current_date, 
                v_secretaire.id, 
                v_horaire_secretaire.demi_journee, 
                v_site_id
              )
              ON CONFLICT DO NOTHING;
              
              v_capacite_count := v_capacite_count + 1;
            END IF;
          END IF;
        END LOOP;
      END LOOP;
    END IF;
    
    -- Move to next day
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
  
  RAISE NOTICE 'Weekly planning maintenance completed for week % to %: generated % besoins and % capacites', 
    v_new_week_start, v_new_week_end, v_besoin_count, v_capacite_count;
END;
$function$;

-- Schedule the new cron job to run every Friday at midnight
SELECT cron.schedule(
  'weekly-planning-maintenance',
  '0 0 * * 5',
  $$
  SELECT public.weekly_planning_maintenance();
  $$
);

COMMENT ON FUNCTION public.weekly_planning_maintenance() IS 
'Maintains a rolling 52-week planning window by regenerating week +52 every Friday at midnight. Uses the exact same logic as handle_horaire_medecin_insert_logic and handle_horaire_secretaire_insert_logic. Preserves all historical data.';