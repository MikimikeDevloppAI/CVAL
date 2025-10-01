-- Drop the specialite_id column from besoin_effectif
ALTER TABLE public.besoin_effectif DROP COLUMN IF EXISTS specialite_id;

-- Recreate generate_besoin_effectif function without specialite_id
CREATE OR REPLACE FUNCTION public.generate_besoin_effectif()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_start_date DATE := CURRENT_DATE;
  v_end_date DATE := CURRENT_DATE + INTERVAL '52 weeks';
  v_current_date DATE;
  v_jour_semaine INTEGER;
  v_medecin RECORD;
  v_horaire RECORD;
  v_bloc RECORD;
  v_abs_full INTEGER;
  v_abs_start TIME;
  v_abs_end TIME;
  v_semaines_diff INTEGER;
  v_should_work BOOLEAN;
  v_seg_start TIME;
  v_seg_end TIME;
  v_bloc_site_id UUID;
BEGIN
  -- Get bloc site ID
  SELECT id INTO v_bloc_site_id FROM public.sites WHERE nom = 'Clinique La Vallée - Bloc opératoire' LIMIT 1;

  -- Delete all data in the range we're regenerating
  DELETE FROM public.besoin_effectif 
  WHERE date >= v_start_date AND date <= v_end_date;

  -- Clean old data (older than current_date)
  DELETE FROM public.besoin_effectif WHERE date < CURRENT_DATE;

  v_current_date := v_start_date;
  
  WHILE v_current_date <= v_end_date LOOP
    v_jour_semaine := EXTRACT(ISODOW FROM v_current_date);
    
    -- Generate for all active doctors
    FOR v_medecin IN
      SELECT id FROM public.medecins WHERE actif = true
    LOOP
      FOR v_horaire IN
        SELECT * FROM public.horaires_base_medecins
        WHERE medecin_id = v_medecin.id
          AND jour_semaine = v_jour_semaine
          AND actif = true
      LOOP
        -- Calculate if doctor should work this week based on alternance
        v_semaines_diff := FLOOR((v_current_date - v_horaire.alternance_semaine_reference) / 7);
        
        v_should_work := CASE v_horaire.alternance_type
          WHEN 'hebdomadaire' THEN true
          WHEN 'une_sur_deux' THEN (v_semaines_diff % 2 = 0)
          WHEN 'une_sur_trois' THEN (v_semaines_diff % 3 = 0)
          WHEN 'une_sur_quatre' THEN (v_semaines_diff % 4 = 0)
          ELSE true
        END;
        
        IF v_should_work THEN
          -- Check for full-day absence
          SELECT COUNT(*) INTO v_abs_full
          FROM public.absences
          WHERE medecin_id = v_medecin.id
            AND v_current_date BETWEEN date_debut AND date_fin
            AND statut IN ('approuve', 'en_attente')
            AND heure_debut IS NULL AND heure_fin IS NULL;
          
          IF v_abs_full = 0 THEN
            -- Get partial-day absence window
            SELECT MIN(heure_debut), MAX(heure_fin)
              INTO v_abs_start, v_abs_end
            FROM public.absences
            WHERE medecin_id = v_medecin.id
              AND v_current_date BETWEEN date_debut AND date_fin
              AND statut IN ('approuve', 'en_attente')
              AND heure_debut IS NOT NULL AND heure_fin IS NOT NULL;

            IF v_abs_start IS NULL OR v_abs_end IS NULL THEN
              -- No partial absence: insert whole slot
              INSERT INTO public.besoin_effectif (
                date, type, medecin_id, site_id,
                heure_debut, heure_fin
              ) VALUES (
                v_current_date, 'medecin', v_medecin.id, v_horaire.site_id,
                v_horaire.heure_debut, v_horaire.heure_fin
              )
              ON CONFLICT DO NOTHING;
            ELSE
              -- Segment before absence
              v_seg_start := v_horaire.heure_debut;
              v_seg_end := LEAST(v_abs_start, v_horaire.heure_fin);
              IF v_seg_start < v_seg_end THEN
                INSERT INTO public.besoin_effectif (
                  date, type, medecin_id, site_id,
                  heure_debut, heure_fin
                ) VALUES (
                  v_current_date, 'medecin', v_medecin.id, v_horaire.site_id,
                  v_seg_start, v_seg_end
                )
                ON CONFLICT DO NOTHING;
              END IF;

              -- Segment after absence
              v_seg_start := GREATEST(v_abs_end, v_horaire.heure_debut);
              v_seg_end := v_horaire.heure_fin;
              IF v_seg_start < v_seg_end THEN
                INSERT INTO public.besoin_effectif (
                  date, type, medecin_id, site_id,
                  heure_debut, heure_fin
                ) VALUES (
                  v_current_date, 'medecin', v_medecin.id, v_horaire.site_id,
                  v_seg_start, v_seg_end
                )
                ON CONFLICT DO NOTHING;
              END IF;
            END IF;
          END IF;
        END IF;
      END LOOP;
    END LOOP;
    
    -- Generate for bloc operatoire
    FOR v_bloc IN
      SELECT * FROM public.bloc_operatoire_besoins
      WHERE date = v_current_date AND actif = true
    LOOP
      INSERT INTO public.besoin_effectif (
        date, type, bloc_operatoire_besoin_id, site_id,
        heure_debut, heure_fin
      ) VALUES (
        v_bloc.date, 'bloc_operatoire', v_bloc.id, v_bloc_site_id,
        v_bloc.heure_debut, v_bloc.heure_fin
      )
      ON CONFLICT DO NOTHING;
    END LOOP;
    
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
END;
$function$;

-- Recreate recreate_doctor_besoin function without specialite_id
CREATE OR REPLACE FUNCTION public.recreate_doctor_besoin(p_medecin_id uuid, p_date_debut date, p_date_fin date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_current_date date;
  v_jour_semaine integer;
  v_medecin RECORD;
  v_horaire RECORD;
  v_abs_full integer;
  v_abs_start time;
  v_abs_end time;
  v_should_work boolean;
  v_seg_start time;
  v_seg_end time;
  v_max_date date;
BEGIN
  -- Get the maximum date that exists in besoin_effectif - CAST TO DATE
  SELECT COALESCE(MAX(date), (CURRENT_DATE + INTERVAL '52 weeks')::date) 
  INTO v_max_date 
  FROM public.besoin_effectif;
  
  -- Override p_date_fin with the max date to ensure we regenerate all existing weeks
  p_date_fin := v_max_date;
  
  -- Get doctor info
  SELECT id
  INTO v_medecin
  FROM public.medecins 
  WHERE id = p_medecin_id AND actif = true;
  
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Delete all existing data for THIS DOCTOR ONLY from p_date_debut to p_date_fin
  DELETE FROM public.besoin_effectif
  WHERE medecin_id = p_medecin_id 
    AND date >= p_date_debut 
    AND date <= p_date_fin;

  v_current_date := p_date_debut;
  
  WHILE v_current_date <= p_date_fin LOOP
    v_jour_semaine := EXTRACT(ISODOW FROM v_current_date);
    
    FOR v_horaire IN
      SELECT * FROM public.horaires_base_medecins
      WHERE medecin_id = p_medecin_id
        AND jour_semaine = v_jour_semaine
        AND actif = true
    LOOP
      -- Check if doctor should work based on alternance
      v_should_work := public.should_doctor_work(
        v_horaire.alternance_type,
        v_horaire.alternance_semaine_reference,
        v_current_date
      );
      
      IF v_should_work THEN
        -- Check for full-day absence
        SELECT COUNT(*) INTO v_abs_full
        FROM public.absences
        WHERE medecin_id = p_medecin_id
          AND v_current_date BETWEEN date_debut AND date_fin
          AND statut IN ('approuve', 'en_attente')
          AND heure_debut IS NULL AND heure_fin IS NULL;
        
        IF v_abs_full = 0 THEN
          -- Get partial-day absence window
          SELECT MIN(heure_debut), MAX(heure_fin)
          INTO v_abs_start, v_abs_end
          FROM public.absences
          WHERE medecin_id = p_medecin_id
            AND v_current_date BETWEEN date_debut AND date_fin
            AND statut IN ('approuve', 'en_attente')
            AND heure_debut IS NOT NULL AND heure_fin IS NOT NULL;

          IF v_abs_start IS NULL OR v_abs_end IS NULL THEN
            -- No absence: insert whole slot FOR THIS DOCTOR ONLY
            INSERT INTO public.besoin_effectif (
              date, type, medecin_id, site_id,
              heure_debut, heure_fin
            ) VALUES (
              v_current_date, 'medecin', v_medecin.id, v_horaire.site_id,
              v_horaire.heure_debut, v_horaire.heure_fin
            )
            ON CONFLICT DO NOTHING;
          ELSE
            -- Segment before absence
            v_seg_start := v_horaire.heure_debut;
            v_seg_end := LEAST(v_abs_start, v_horaire.heure_fin);
            IF v_seg_start < v_seg_end AND (v_seg_end - v_seg_start) >= INTERVAL '30 minutes' THEN
              INSERT INTO public.besoin_effectif (
                date, type, medecin_id, site_id,
                heure_debut, heure_fin
              ) VALUES (
                v_current_date, 'medecin', v_medecin.id, v_horaire.site_id,
                v_seg_start, v_seg_end
              )
              ON CONFLICT DO NOTHING;
            END IF;

            -- Segment after absence
            v_seg_start := GREATEST(v_abs_end, v_horaire.heure_debut);
            v_seg_end := v_horaire.heure_fin;
            IF v_seg_start < v_seg_end AND (v_seg_end - v_seg_start) >= INTERVAL '30 minutes' THEN
              INSERT INTO public.besoin_effectif (
                date, type, medecin_id, site_id,
                heure_debut, heure_fin
              ) VALUES (
                v_current_date, 'medecin', v_medecin.id, v_horaire.site_id,
                v_seg_start, v_seg_end
              )
              ON CONFLICT DO NOTHING;
            END IF;
          END IF;
        END IF;
      END IF;
    END LOOP;
    
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
END;
$function$;

-- Recreate weekly_planning_maintenance function without specialite_id
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
    
    -- Generate for all active doctors
    FOR v_medecin IN
      SELECT id FROM public.medecins WHERE actif = true
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
                date, type, medecin_id, site_id,
                heure_debut, heure_fin
              ) VALUES (
                v_current_date, 'medecin', v_medecin.id, v_horaire.site_id,
                v_horaire.heure_debut, v_horaire.heure_fin
              )
              ON CONFLICT DO NOTHING;
            ELSE
              v_seg_start := v_horaire.heure_debut;
              v_seg_end := LEAST(v_abs_start, v_horaire.heure_fin);
              IF v_seg_start < v_seg_end THEN
                INSERT INTO public.besoin_effectif (
                  date, type, medecin_id, site_id,
                  heure_debut, heure_fin
                ) VALUES (
                  v_current_date, 'medecin', v_medecin.id, v_horaire.site_id,
                  v_seg_start, v_seg_end
                )
                ON CONFLICT DO NOTHING;
              END IF;

              v_seg_start := GREATEST(v_abs_end, v_horaire.heure_debut);
              v_seg_end := v_horaire.heure_fin;
              IF v_seg_start < v_seg_end THEN
                INSERT INTO public.besoin_effectif (
                  date, type, medecin_id, site_id,
                  heure_debut, heure_fin
                ) VALUES (
                  v_current_date, 'medecin', v_medecin.id, v_horaire.site_id,
                  v_seg_start, v_seg_end
                )
                ON CONFLICT DO NOTHING;
              END IF;
            END IF;
          END IF;
        END IF;
      END LOOP;
    END LOOP;
    
    -- Generate for bloc operatoire
    FOR v_bloc IN
      SELECT * FROM public.bloc_operatoire_besoins
      WHERE date = v_current_date AND actif = true
    LOOP
      INSERT INTO public.besoin_effectif (
        date, type, bloc_operatoire_besoin_id, site_id,
        heure_debut, heure_fin
      ) VALUES (
        v_bloc.date, 'bloc_operatoire', v_bloc.id, v_bloc_site_id,
        v_bloc.heure_debut, v_bloc.heure_fin
      )
      ON CONFLICT DO NOTHING;
    END LOOP;
    
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;

  -- Generate new week +52 for capacite_effective
  v_current_date := v_new_week_start;
  
  WHILE v_current_date <= v_new_week_end LOOP
    v_jour_semaine := EXTRACT(ISODOW FROM v_current_date);
    
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
    
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
  
  RAISE NOTICE 'Weekly planning maintenance completed: deleted week % and generated week %', 
    v_delete_week_start, v_new_week_start;
END;
$function$;

-- Recreate create_besoin_from_bloc function without specialite_id
CREATE OR REPLACE FUNCTION public.create_besoin_from_bloc(p_bloc_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_bloc RECORD;
  v_bloc_site_id UUID;
BEGIN
  -- Récupérer l'ID du site "Clinique La Vallée - Bloc opératoire"
  SELECT id INTO v_bloc_site_id FROM public.sites WHERE nom = 'Clinique La Vallée - Bloc opératoire' LIMIT 1;

  SELECT * INTO v_bloc
  FROM public.bloc_operatoire_besoins
  WHERE id = p_bloc_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  INSERT INTO public.besoin_effectif (
    date,
    type,
    bloc_operatoire_besoin_id,
    site_id,
    heure_debut,
    heure_fin
  )
  VALUES (
    v_bloc.date,
    'bloc_operatoire',
    v_bloc.id,
    v_bloc_site_id,
    v_bloc.heure_debut,
    v_bloc.heure_fin
  );
END;
$function$;