-- Update weekly_planning_maintenance to check for public holidays
CREATE OR REPLACE FUNCTION public.weekly_planning_maintenance()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_delete_week_start DATE := CURRENT_DATE - INTERVAL '52 weeks';
  v_delete_week_end DATE := v_delete_week_start + INTERVAL '6 days';
  v_new_week_start DATE := CURRENT_DATE + INTERVAL '52 weeks';
  v_new_week_end DATE := v_new_week_start + INTERVAL '6 days';
  v_current_date DATE;
  v_jour_semaine INTEGER;
  v_medecin RECORD;
  v_horaire RECORD;
  v_secretaire RECORD;
  v_abs_full INTEGER;
  v_abs_start TIME;
  v_abs_end TIME;
  v_semaines_diff INTEGER;
  v_should_work BOOLEAN;
  v_seg_start TIME;
  v_seg_end TIME;
  v_bloc RECORD;
  v_bloc_site_id UUID;
  v_is_holiday BOOLEAN;
BEGIN
  -- Get bloc site ID
  SELECT id INTO v_bloc_site_id FROM public.sites WHERE nom = 'Clinique La Vallée - Bloc opératoire' LIMIT 1;

  -- Delete the oldest week (week -52)
  DELETE FROM public.besoin_effectif 
  WHERE date >= v_delete_week_start AND date <= v_delete_week_end;
  
  DELETE FROM public.capacite_effective 
  WHERE date >= v_delete_week_start AND date <= v_delete_week_end;

  -- Generate new week +52 for besoin_effectif
  v_current_date := v_new_week_start;
  
  WHILE v_current_date <= v_new_week_end LOOP
    v_jour_semaine := EXTRACT(ISODOW FROM v_current_date);
    
    -- Check if this date is a public holiday
    SELECT EXISTS(
      SELECT 1 FROM public.jours_feries
      WHERE date = v_current_date AND actif = true
    ) INTO v_is_holiday;
    
    -- Only generate if not a holiday
    IF NOT v_is_holiday THEN
      -- Generate for all active doctors
      FOR v_medecin IN
        SELECT id, specialite_id, besoin_secretaires FROM public.medecins WHERE actif = true
      LOOP
        FOR v_horaire IN
          SELECT * FROM public.horaires_base_medecins
          WHERE medecin_id = v_medecin.id
            AND jour_semaine = v_jour_semaine
            AND actif = true
        LOOP
          v_semaines_diff := FLOOR((v_current_date - v_horaire.alternance_semaine_reference) / 7);
          
          v_should_work := CASE v_horaire.alternance_type
            WHEN 'hebdomadaire' THEN true
            WHEN 'une_sur_deux' THEN (v_semaines_diff % 2 = 0)
            WHEN 'une_sur_trois' THEN (v_semaines_diff % 3 = 0)
            WHEN 'une_sur_quatre' THEN (v_semaines_diff % 4 = 0)
            ELSE true
          END;
          
          IF v_should_work THEN
            SELECT COUNT(*) INTO v_abs_full
            FROM public.absences
            WHERE medecin_id = v_medecin.id
              AND v_current_date BETWEEN date_debut AND date_fin
              AND statut IN ('approuve', 'en_attente')
              AND heure_debut IS NULL AND heure_fin IS NULL;
            
            IF v_abs_full = 0 THEN
              SELECT MIN(heure_debut), MAX(heure_fin)
                INTO v_abs_start, v_abs_end
              FROM public.absences
              WHERE medecin_id = v_medecin.id
                AND v_current_date BETWEEN date_debut AND date_fin
                AND statut IN ('approuve', 'en_attente')
                AND heure_debut IS NOT NULL AND heure_fin IS NOT NULL;

              IF v_abs_start IS NULL OR v_abs_end IS NULL THEN
                INSERT INTO public.besoin_effectif (
                  date, type, medecin_id, site_id, specialite_id,
                  heure_debut, heure_fin, nombre_secretaires_requis
                ) VALUES (
                  v_current_date, 'medecin', v_medecin.id, v_horaire.site_id, v_medecin.specialite_id,
                  v_horaire.heure_debut, v_horaire.heure_fin, v_medecin.besoin_secretaires
                )
                ON CONFLICT DO NOTHING;
              ELSE
                v_seg_start := v_horaire.heure_debut;
                v_seg_end := LEAST(v_abs_start, v_horaire.heure_fin);
                IF v_seg_start < v_seg_end THEN
                  INSERT INTO public.besoin_effectif (
                    date, type, medecin_id, site_id, specialite_id,
                    heure_debut, heure_fin, nombre_secretaires_requis
                  ) VALUES (
                    v_current_date, 'medecin', v_medecin.id, v_horaire.site_id, v_medecin.specialite_id,
                    v_seg_start, v_seg_end, v_medecin.besoin_secretaires
                  )
                  ON CONFLICT DO NOTHING;
                END IF;

                v_seg_start := GREATEST(v_abs_end, v_horaire.heure_debut);
                v_seg_end := v_horaire.heure_fin;
                IF v_seg_start < v_seg_end THEN
                  INSERT INTO public.besoin_effectif (
                    date, type, medecin_id, site_id, specialite_id,
                    heure_debut, heure_fin, nombre_secretaires_requis
                  ) VALUES (
                    v_current_date, 'medecin', v_medecin.id, v_horaire.site_id, v_medecin.specialite_id,
                    v_seg_start, v_seg_end, v_medecin.besoin_secretaires
                  )
                  ON CONFLICT DO NOTHING;
                END IF;
              END IF;
            END IF;
          END IF;
        END LOOP;
      END LOOP;
      
      -- Generate for bloc operatoire (also skip if holiday)
      FOR v_bloc IN
        SELECT * FROM public.bloc_operatoire_besoins
        WHERE date = v_current_date AND actif = true
      LOOP
        INSERT INTO public.besoin_effectif (
          date, type, bloc_operatoire_besoin_id, site_id, specialite_id,
          heure_debut, heure_fin, nombre_secretaires_requis
        ) VALUES (
          v_bloc.date, 'bloc_operatoire', v_bloc.id, v_bloc_site_id,
          v_bloc.specialite_id, v_bloc.heure_debut, v_bloc.heure_fin,
          v_bloc.nombre_secretaires_requis
        )
        ON CONFLICT DO NOTHING;
      END LOOP;
    END IF;
    
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;

  -- Generate new week +52 for capacite_effective
  v_current_date := v_new_week_start;
  
  WHILE v_current_date <= v_new_week_end LOOP
    v_jour_semaine := EXTRACT(ISODOW FROM v_current_date);
    
    -- Check if this date is a public holiday
    SELECT EXISTS(
      SELECT 1 FROM public.jours_feries
      WHERE date = v_current_date AND actif = true
    ) INTO v_is_holiday;
    
    -- Only generate if not a holiday
    IF NOT v_is_holiday THEN
      FOR v_secretaire IN
        SELECT id FROM public.secretaires WHERE actif = true
      LOOP
        FOR v_horaire IN
          SELECT * FROM public.horaires_base_secretaires
          WHERE secretaire_id = v_secretaire.id
            AND jour_semaine = v_jour_semaine
            AND actif = true
        LOOP
          SELECT COUNT(*) INTO v_abs_full
          FROM public.absences
          WHERE secretaire_id = v_secretaire.id
            AND v_current_date BETWEEN date_debut AND date_fin
            AND statut IN ('approuve', 'en_attente')
            AND heure_debut IS NULL AND heure_fin IS NULL;
          
          IF v_abs_full = 0 THEN
            SELECT MIN(heure_debut), MAX(heure_fin)
              INTO v_abs_start, v_abs_end
            FROM public.absences
            WHERE secretaire_id = v_secretaire.id
              AND v_current_date BETWEEN date_debut AND date_fin
              AND statut IN ('approuve', 'en_attente')
              AND heure_debut IS NOT NULL AND heure_fin IS NOT NULL;

            IF v_abs_start IS NULL OR v_abs_end IS NULL THEN
              INSERT INTO public.capacite_effective (
                date, secretaire_id, heure_debut, heure_fin
              ) VALUES (
                v_current_date, v_secretaire.id,
                v_horaire.heure_debut, v_horaire.heure_fin
              )
              ON CONFLICT DO NOTHING;
            ELSE
              v_seg_start := v_horaire.heure_debut;
              v_seg_end := LEAST(v_abs_start, v_horaire.heure_fin);
              IF v_seg_start < v_seg_end THEN
                INSERT INTO public.capacite_effective (
                  date, secretaire_id, heure_debut, heure_fin
                ) VALUES (
                  v_current_date, v_secretaire.id,
                  v_seg_start, v_seg_end
                )
                ON CONFLICT DO NOTHING;
              END IF;

              v_seg_start := GREATEST(v_abs_end, v_horaire.heure_debut);
              v_seg_end := v_horaire.heure_fin;
              IF v_seg_start < v_seg_end THEN
                INSERT INTO public.capacite_effective (
                  date, secretaire_id, heure_debut, heure_fin
                ) VALUES (
                  v_current_date, v_secretaire.id,
                  v_seg_start, v_seg_end
                )
                ON CONFLICT DO NOTHING;
              END IF;
            END IF;
          END IF;
        END LOOP;
      END LOOP;
    END IF;
    
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
  
  RAISE NOTICE 'Weekly planning maintenance completed: deleted week % and generated week %', 
    v_delete_week_start, v_new_week_start;
END;
$function$;