-- Remplacer le système de date de référence par un système de modulo de semaine
-- Pour l'alternance, on utilise maintenant un numéro de semaine dans le cycle

-- 1. Ajouter la nouvelle colonne alternance_semaine_modulo
ALTER TABLE public.horaires_base_medecins 
ADD COLUMN alternance_semaine_modulo INTEGER;

-- 2. Migrer les données existantes
-- Calculer le modulo basé sur la semaine actuelle et la référence
UPDATE public.horaires_base_medecins
SET alternance_semaine_modulo = CASE 
  WHEN alternance_type = 'hebdomadaire' THEN 0
  WHEN alternance_type = 'une_sur_deux' THEN 
    (FLOOR((CURRENT_DATE - COALESCE(alternance_semaine_reference, CURRENT_DATE)) / 7)::INTEGER % 2)
  WHEN alternance_type = 'une_sur_trois' THEN 
    (FLOOR((CURRENT_DATE - COALESCE(alternance_semaine_reference, CURRENT_DATE)) / 7)::INTEGER % 3)
  WHEN alternance_type = 'une_sur_quatre' THEN 
    (FLOOR((CURRENT_DATE - COALESCE(alternance_semaine_reference, CURRENT_DATE)) / 7)::INTEGER % 4)
  ELSE 0
END;

-- 3. Mettre la nouvelle colonne NOT NULL avec une valeur par défaut
ALTER TABLE public.horaires_base_medecins 
ALTER COLUMN alternance_semaine_modulo SET NOT NULL,
ALTER COLUMN alternance_semaine_modulo SET DEFAULT 0;

-- 4. Supprimer l'ancienne colonne
ALTER TABLE public.horaires_base_medecins 
DROP COLUMN alternance_semaine_reference;

-- 5. Mettre à jour la fonction should_doctor_work pour utiliser le nouveau système
CREATE OR REPLACE FUNCTION public.should_doctor_work(
  p_alternance_type type_alternance, 
  p_alternance_modulo integer, 
  p_target_date date
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  v_week_number integer;
BEGIN
  -- Calculer le numéro de semaine ISO (1-53)
  v_week_number := EXTRACT(WEEK FROM p_target_date)::integer;
  
  RETURN CASE p_alternance_type
    WHEN 'hebdomadaire' THEN true
    WHEN 'une_sur_deux' THEN (v_week_number % 2 = p_alternance_modulo)
    WHEN 'une_sur_trois' THEN (v_week_number % 3 = p_alternance_modulo)
    WHEN 'une_sur_quatre' THEN (v_week_number % 4 = p_alternance_modulo)
    ELSE true
  END;
END;
$function$;

-- 6. Mettre à jour handle_horaire_medecin_insert_logic
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
  v_should_work BOOLEAN;
  v_abs_full INTEGER;
  v_has_partial_absence BOOLEAN;
BEGIN
  v_start_date := COALESCE(p_horaire.date_debut, CURRENT_DATE);
  v_end_date := COALESCE(p_horaire.date_fin, CURRENT_DATE + INTERVAL '52 weeks');
  
  IF v_start_date < CURRENT_DATE THEN
    v_start_date := CURRENT_DATE;
  END IF;
  
  v_current_date := v_start_date;
  
  WHILE EXTRACT(ISODOW FROM v_current_date) != p_horaire.jour_semaine LOOP
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
  
  WHILE v_current_date <= v_end_date LOOP
    -- Utiliser la nouvelle fonction avec modulo
    v_should_work := public.should_doctor_work(
      p_horaire.alternance_type,
      p_horaire.alternance_semaine_modulo,
      v_current_date
    );
    
    IF v_should_work THEN
      SELECT COUNT(*) INTO v_abs_full
      FROM public.absences
      WHERE medecin_id = p_horaire.medecin_id
        AND v_current_date BETWEEN date_debut AND date_fin
        AND statut IN ('approuve', 'en_attente')
        AND heure_debut IS NULL AND heure_fin IS NULL;
      
      IF v_abs_full = 0 THEN
        SELECT EXISTS(
          SELECT 1 FROM public.absences
          WHERE medecin_id = p_horaire.medecin_id
            AND v_current_date BETWEEN date_debut AND date_fin
            AND statut IN ('approuve', 'en_attente')
            AND heure_debut IS NOT NULL AND heure_fin IS NOT NULL
        ) INTO v_has_partial_absence;

        IF NOT v_has_partial_absence THEN
          INSERT INTO public.besoin_effectif (
            date, type, medecin_id, site_id, demi_journee
          ) VALUES (
            v_current_date, 'medecin', p_horaire.medecin_id, p_horaire.site_id, p_horaire.demi_journee
          )
          ON CONFLICT DO NOTHING;
        END IF;
      END IF;
    END IF;
    
    v_current_date := v_current_date + INTERVAL '7 days';
  END LOOP;
END;
$function$;

-- 7. Mettre à jour recreate_doctor_besoin
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
  SELECT COALESCE(MAX(date), (CURRENT_DATE + INTERVAL '52 weeks')::date) 
  INTO v_max_date 
  FROM public.besoin_effectif;
  
  p_date_fin := v_max_date;
  
  SELECT id
  INTO v_medecin
  FROM public.medecins 
  WHERE id = p_medecin_id AND actif = true;
  
  IF NOT FOUND THEN
    RETURN;
  END IF;

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
      v_should_work := public.should_doctor_work(
        v_horaire.alternance_type,
        v_horaire.alternance_semaine_modulo,
        v_current_date
      );
      
      IF v_should_work THEN
        SELECT COUNT(*) INTO v_abs_full
        FROM public.absences
        WHERE medecin_id = p_medecin_id
          AND v_current_date BETWEEN date_debut AND date_fin
          AND statut IN ('approuve', 'en_attente')
          AND heure_debut IS NULL AND heure_fin IS NULL;
        
        IF v_abs_full = 0 THEN
          SELECT MIN(heure_debut), MAX(heure_fin)
          INTO v_abs_start, v_abs_end
          FROM public.absences
          WHERE medecin_id = p_medecin_id
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

-- 8. Mettre à jour generate_besoin_effectif
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
  v_should_work BOOLEAN;
  v_seg_start TIME;
  v_seg_end TIME;
  v_bloc_site_id UUID;
BEGIN
  SELECT id INTO v_bloc_site_id FROM public.sites WHERE nom = 'Clinique La Vallée - Bloc opératoire' LIMIT 1;

  DELETE FROM public.besoin_effectif 
  WHERE date >= v_start_date AND date <= v_end_date;

  DELETE FROM public.besoin_effectif WHERE date < CURRENT_DATE;

  v_current_date := v_start_date;
  
  WHILE v_current_date <= v_end_date LOOP
    v_jour_semaine := EXTRACT(ISODOW FROM v_current_date);
    
    FOR v_medecin IN
      SELECT id FROM public.medecins WHERE actif = true
    LOOP
      FOR v_horaire IN
        SELECT * FROM public.horaires_base_medecins
        WHERE medecin_id = v_medecin.id
          AND jour_semaine = v_jour_semaine
          AND actif = true
      LOOP
        v_should_work := public.should_doctor_work(
          v_horaire.alternance_type,
          v_horaire.alternance_semaine_modulo,
          v_current_date
        );
        
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

-- 9. Mettre à jour weekly_planning_maintenance
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
  v_should_work BOOLEAN;
  v_has_partial_absence BOOLEAN;
  v_bloc RECORD;
  v_bloc_site_id UUID;
BEGIN
  SELECT id INTO v_bloc_site_id FROM public.sites WHERE nom = 'Clinique La Vallée - Bloc opératoire' LIMIT 1;

  DELETE FROM public.besoin_effectif 
  WHERE date >= v_delete_week_start AND date <= v_delete_week_end;
  
  DELETE FROM public.capacite_effective 
  WHERE date >= v_delete_week_start AND date <= v_delete_week_end;

  v_current_date := v_new_week_start;
  
  WHILE v_current_date <= v_new_week_end LOOP
    v_jour_semaine := EXTRACT(ISODOW FROM v_current_date);
    
    FOR v_medecin IN
      SELECT id FROM public.medecins WHERE actif = true
    LOOP
      FOR v_horaire IN
        SELECT * FROM public.horaires_base_medecins
        WHERE medecin_id = v_medecin.id
          AND jour_semaine = v_jour_semaine
          AND actif = true
          AND (date_debut IS NULL OR date_debut <= v_current_date)
          AND (date_fin IS NULL OR date_fin >= v_current_date)
      LOOP
        v_should_work := public.should_doctor_work(
          v_horaire.alternance_type,
          v_horaire.alternance_semaine_modulo,
          v_current_date
        );
        
        IF v_should_work THEN
          SELECT COUNT(*) INTO v_abs_full
          FROM public.absences
          WHERE medecin_id = v_medecin.id
            AND v_current_date BETWEEN date_debut AND date_fin
            AND statut IN ('approuve', 'en_attente')
            AND heure_debut IS NULL AND heure_fin IS NULL;
          
          IF v_abs_full = 0 THEN
            SELECT EXISTS(
              SELECT 1 FROM public.absences
              WHERE medecin_id = v_medecin.id
                AND v_current_date BETWEEN date_debut AND date_fin
                AND statut IN ('approuve', 'en_attente')
                AND heure_debut IS NOT NULL AND heure_fin IS NOT NULL
            ) INTO v_has_partial_absence;

            IF NOT v_has_partial_absence THEN
              INSERT INTO public.besoin_effectif (
                date, type, medecin_id, site_id, demi_journee
              ) VALUES (
                v_current_date, 'medecin', v_medecin.id, v_horaire.site_id, v_horaire.demi_journee
              )
              ON CONFLICT DO NOTHING;
            END IF;
          END IF;
        END IF;
      END LOOP;
    END LOOP;
    
    FOR v_bloc IN
      SELECT * FROM public.bloc_operatoire_besoins
      WHERE date = v_current_date AND actif = true
    LOOP
      INSERT INTO public.besoin_effectif (
        date, type, bloc_operatoire_besoin_id, site_id, demi_journee
      ) VALUES (
        v_bloc.date, 'bloc_operatoire', v_bloc.id, v_bloc_site_id, 'toute_journee'::demi_journee
      )
      ON CONFLICT DO NOTHING;
    END LOOP;
    
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
  
  FOR v_secretaire IN
    SELECT id FROM public.secretaires WHERE actif = true
  LOOP
    v_current_date := v_new_week_start;
    WHILE v_current_date <= v_new_week_end LOOP
      v_jour_semaine := EXTRACT(ISODOW FROM v_current_date);
      
      FOR v_horaire IN
        SELECT * FROM public.horaires_base_secretaires
        WHERE secretaire_id = v_secretaire.id
          AND jour_semaine = v_jour_semaine
          AND actif = true
          AND (date_debut IS NULL OR date_debut <= v_current_date)
          AND (date_fin IS NULL OR date_fin >= v_current_date)
      LOOP
        SELECT COUNT(*) INTO v_abs_full
        FROM public.absences
        WHERE secretaire_id = v_secretaire.id
          AND v_current_date BETWEEN date_debut AND date_fin
          AND statut IN ('approuve', 'en_attente')
          AND heure_debut IS NULL AND heure_fin IS NULL;
        
        IF v_abs_full = 0 THEN
          SELECT EXISTS(
            SELECT 1 FROM public.absences
            WHERE secretaire_id = v_secretaire.id
              AND v_current_date BETWEEN date_debut AND date_fin
              AND statut IN ('approuve', 'en_attente')
              AND heure_debut IS NOT NULL AND heure_fin IS NOT NULL
          ) INTO v_has_partial_absence;

          IF NOT v_has_partial_absence THEN
            INSERT INTO public.capacite_effective (
              date, secretaire_id, demi_journee
            ) VALUES (
              v_current_date, v_secretaire.id, v_horaire.demi_journee
            )
            ON CONFLICT DO NOTHING;
          END IF;
        END IF;
      END LOOP;
      
      v_current_date := v_current_date + INTERVAL '1 day';
    END LOOP;
  END LOOP;
END;
$function$;