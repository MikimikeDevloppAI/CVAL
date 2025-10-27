-- Correction: Prise en compte des absences par demi-journée

-- 1. Recréer handle_horaire_medecin_insert_logic avec gestion correcte des absences
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
  v_is_holiday BOOLEAN;
  v_should_work BOOLEAN;
  v_semaine_iso INTEGER;
  v_exists BOOLEAN;
  v_has_absence_matin BOOLEAN;
  v_has_absence_am BOOLEAN;
  v_has_absence BOOLEAN;
BEGIN
  v_start_date := COALESCE(p_horaire.date_debut, CURRENT_DATE);
  v_end_date := COALESCE(p_horaire.date_fin, CURRENT_DATE + INTERVAL '52 weeks');

  IF v_start_date < CURRENT_DATE THEN
    v_start_date := CURRENT_DATE;
  END IF;

  v_current_date := v_start_date;

  -- Aller au prochain jour correspondant au jour_semaine
  WHILE EXTRACT(ISODOW FROM v_current_date) != p_horaire.jour_semaine LOOP
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;

  WHILE v_current_date <= v_end_date LOOP
    -- Jours fériés actifs
    SELECT EXISTS(
      SELECT 1 FROM public.jours_feries
      WHERE date = v_current_date AND actif = true
    ) INTO v_is_holiday;

    v_semaine_iso := EXTRACT(WEEK FROM v_current_date)::integer;

    v_should_work := public.should_doctor_work(
      p_horaire.alternance_type,
      p_horaire.alternance_semaine_modulo,
      v_current_date
    );

    IF v_should_work AND NOT v_is_holiday THEN
      IF p_horaire.demi_journee = 'toute_journee' THEN
        -- Vérifier absence matin (matin OU toute_journee)
        SELECT EXISTS(
          SELECT 1 FROM public.absences
          WHERE medecin_id = p_horaire.medecin_id
            AND v_current_date BETWEEN date_debut AND date_fin
            AND statut IN ('approuve', 'en_attente')
            AND demi_journee IN ('matin', 'toute_journee')
        ) INTO v_has_absence_matin;

        -- Vérifier absence après-midi (apres_midi OU toute_journee)
        SELECT EXISTS(
          SELECT 1 FROM public.absences
          WHERE medecin_id = p_horaire.medecin_id
            AND v_current_date BETWEEN date_debut AND date_fin
            AND statut IN ('approuve', 'en_attente')
            AND demi_journee IN ('apres_midi', 'toute_journee')
        ) INTO v_has_absence_am;

        -- Insérer matin si pas d'absence
        IF NOT v_has_absence_matin THEN
          SELECT EXISTS(
            SELECT 1 FROM public.besoin_effectif
            WHERE date = v_current_date
              AND medecin_id = p_horaire.medecin_id
              AND demi_journee = 'matin'::demi_journee
          ) INTO v_exists;

          IF NOT v_exists THEN
            INSERT INTO public.besoin_effectif (
              date, type, medecin_id, site_id, demi_journee, 
              type_intervention_id, horaire_base_medecin_id
            ) VALUES (
              v_current_date, 'medecin', p_horaire.medecin_id, p_horaire.site_id, 
              'matin'::demi_journee, p_horaire.type_intervention_id, p_horaire.id
            ) ON CONFLICT DO NOTHING;
          END IF;
        END IF;

        -- Insérer après-midi si pas d'absence
        IF NOT v_has_absence_am THEN
          SELECT EXISTS(
            SELECT 1 FROM public.besoin_effectif
            WHERE date = v_current_date
              AND medecin_id = p_horaire.medecin_id
              AND demi_journee = 'apres_midi'::demi_journee
          ) INTO v_exists;

          IF NOT v_exists THEN
            INSERT INTO public.besoin_effectif (
              date, type, medecin_id, site_id, demi_journee,
              type_intervention_id, horaire_base_medecin_id
            ) VALUES (
              v_current_date, 'medecin', p_horaire.medecin_id, p_horaire.site_id,
              'apres_midi'::demi_journee, p_horaire.type_intervention_id, p_horaire.id
            ) ON CONFLICT DO NOTHING;
          END IF;
        END IF;

      ELSE
        -- Pour matin ou apres_midi spécifique : vérifier cette période OU toute_journee
        SELECT EXISTS(
          SELECT 1 FROM public.absences
          WHERE medecin_id = p_horaire.medecin_id
            AND v_current_date BETWEEN date_debut AND date_fin
            AND statut IN ('approuve', 'en_attente')
            AND demi_journee IN (p_horaire.demi_journee, 'toute_journee')
        ) INTO v_has_absence;

        IF NOT v_has_absence THEN
          SELECT EXISTS(
            SELECT 1 FROM public.besoin_effectif
            WHERE date = v_current_date
              AND medecin_id = p_horaire.medecin_id
              AND demi_journee = p_horaire.demi_journee
          ) INTO v_exists;

          IF NOT v_exists THEN
            INSERT INTO public.besoin_effectif (
              date, type, medecin_id, site_id, demi_journee,
              type_intervention_id, horaire_base_medecin_id
            ) VALUES (
              v_current_date, 'medecin', p_horaire.medecin_id, p_horaire.site_id,
              p_horaire.demi_journee, p_horaire.type_intervention_id, p_horaire.id
            ) ON CONFLICT DO NOTHING;
          END IF;
        END IF;
      END IF;
    END IF;

    v_current_date := v_current_date + INTERVAL '7 days';
  END LOOP;
END;
$function$;

-- 2. Mise à jour de handle_horaire_secretaire_insert_logic avec la même logique
-- (La fonction existe déjà mais avec la mauvaise logique d'absence)
DROP FUNCTION IF EXISTS public.handle_horaire_secretaire_insert_logic(record);

CREATE OR REPLACE FUNCTION public.handle_horaire_secretaire_insert_logic(p_horaire record)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_current_date DATE;
  v_start_date DATE;
  v_end_date DATE;
  v_is_holiday BOOLEAN;
  v_should_work BOOLEAN;
  v_site_id uuid;
  v_semaine_iso INTEGER;
  v_exists BOOLEAN;
  v_has_absence_matin BOOLEAN;
  v_has_absence_am BOOLEAN;
  v_has_absence BOOLEAN;
BEGIN
  v_start_date := COALESCE(p_horaire.date_debut, CURRENT_DATE);
  v_end_date := COALESCE(p_horaire.date_fin, CURRENT_DATE + INTERVAL '52 weeks');

  IF v_start_date < CURRENT_DATE THEN
    v_start_date := CURRENT_DATE;
  END IF;

  v_current_date := v_start_date;

  -- Aller au prochain jour correspondant au jour_semaine
  WHILE EXTRACT(ISODOW FROM v_current_date) != p_horaire.jour_semaine LOOP
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;

  WHILE v_current_date <= v_end_date LOOP
    -- Jours fériés actifs
    SELECT EXISTS(
      SELECT 1 FROM public.jours_feries
      WHERE date = v_current_date AND actif = true
    ) INTO v_is_holiday;

    v_semaine_iso := EXTRACT(WEEK FROM v_current_date)::integer;

    v_should_work := CASE COALESCE(p_horaire.alternance_type, 'hebdomadaire'::type_alternance)
      WHEN 'hebdomadaire' THEN true
      WHEN 'une_sur_deux' THEN (v_semaine_iso % 2 = COALESCE(p_horaire.alternance_semaine_modulo, 0))
      WHEN 'une_sur_trois' THEN (v_semaine_iso % 3 = COALESCE(p_horaire.alternance_semaine_modulo, 0))
      WHEN 'une_sur_quatre' THEN (v_semaine_iso % 4 = COALESCE(p_horaire.alternance_semaine_modulo, 0))
      WHEN 'trois_sur_quatre' THEN (v_semaine_iso % 4 != COALESCE(p_horaire.alternance_semaine_modulo, 0))
      ELSE true
    END;

    IF v_should_work AND NOT v_is_holiday THEN
      v_site_id := COALESCE(p_horaire.site_id, '00000000-0000-0000-0000-000000000001'::uuid);

      IF p_horaire.demi_journee = 'toute_journee' THEN
        -- Vérifier absence matin (matin OU toute_journee)
        SELECT EXISTS(
          SELECT 1 FROM public.absences
          WHERE secretaire_id = p_horaire.secretaire_id
            AND v_current_date BETWEEN date_debut AND date_fin
            AND statut IN ('approuve', 'en_attente')
            AND demi_journee IN ('matin', 'toute_journee')
        ) INTO v_has_absence_matin;

        -- Vérifier absence après-midi (apres_midi OU toute_journee)
        SELECT EXISTS(
          SELECT 1 FROM public.absences
          WHERE secretaire_id = p_horaire.secretaire_id
            AND v_current_date BETWEEN date_debut AND date_fin
            AND statut IN ('approuve', 'en_attente')
            AND demi_journee IN ('apres_midi', 'toute_journee')
        ) INTO v_has_absence_am;

        -- Insérer matin si pas d'absence
        IF NOT v_has_absence_matin THEN
          SELECT EXISTS(
            SELECT 1 FROM public.capacite_effective
            WHERE date = v_current_date
              AND secretaire_id = p_horaire.secretaire_id
              AND demi_journee = 'matin'::demi_journee
          ) INTO v_exists;

          IF NOT v_exists THEN
            INSERT INTO public.capacite_effective (
              date, secretaire_id, demi_journee, site_id, horaire_base_secretaire_id
            ) VALUES (
              v_current_date, p_horaire.secretaire_id, 'matin'::demi_journee, 
              v_site_id, p_horaire.id
            ) ON CONFLICT DO NOTHING;
          END IF;
        END IF;

        -- Insérer après-midi si pas d'absence
        IF NOT v_has_absence_am THEN
          SELECT EXISTS(
            SELECT 1 FROM public.capacite_effective
            WHERE date = v_current_date
              AND secretaire_id = p_horaire.secretaire_id
              AND demi_journee = 'apres_midi'::demi_journee
          ) INTO v_exists;

          IF NOT v_exists THEN
            INSERT INTO public.capacite_effective (
              date, secretaire_id, demi_journee, site_id, horaire_base_secretaire_id
            ) VALUES (
              v_current_date, p_horaire.secretaire_id, 'apres_midi'::demi_journee,
              v_site_id, p_horaire.id
            ) ON CONFLICT DO NOTHING;
          END IF;
        END IF;

      ELSE
        -- Pour matin ou apres_midi spécifique : vérifier cette période OU toute_journee
        SELECT EXISTS(
          SELECT 1 FROM public.absences
          WHERE secretaire_id = p_horaire.secretaire_id
            AND v_current_date BETWEEN date_debut AND date_fin
            AND statut IN ('approuve', 'en_attente')
            AND demi_journee IN (p_horaire.demi_journee, 'toute_journee')
        ) INTO v_has_absence;

        IF NOT v_has_absence THEN
          SELECT EXISTS(
            SELECT 1 FROM public.capacite_effective
            WHERE date = v_current_date
              AND secretaire_id = p_horaire.secretaire_id
              AND demi_journee = p_horaire.demi_journee
          ) INTO v_exists;

          IF NOT v_exists THEN
            INSERT INTO public.capacite_effective (
              date, secretaire_id, demi_journee, site_id, horaire_base_secretaire_id
            ) VALUES (
              v_current_date, p_horaire.secretaire_id, p_horaire.demi_journee,
              v_site_id, p_horaire.id
            ) ON CONFLICT DO NOTHING;
          END IF;
        END IF;
      END IF;
    END IF;

    v_current_date := v_current_date + INTERVAL '7 days';
  END LOOP;
END;
$function$;

-- 3. Mise à jour de weekly_planning_maintenance avec la même logique
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
  v_is_holiday BOOLEAN;
  v_should_work BOOLEAN;
  v_site_id UUID;
  v_besoin_count INTEGER := 0;
  v_capacite_count INTEGER := 0;
  v_has_absence_matin BOOLEAN;
  v_has_absence_am BOOLEAN;
  v_has_absence BOOLEAN;
BEGIN
  v_current_monday := CURRENT_DATE - (EXTRACT(ISODOW FROM CURRENT_DATE)::integer - 1) * INTERVAL '1 day';
  v_new_week_start := v_current_monday + INTERVAL '52 weeks';
  v_new_week_end := v_new_week_start + INTERVAL '6 days';
  
  RAISE NOTICE 'Starting weekly planning maintenance for week % to %', v_new_week_start, v_new_week_end;
  
  DELETE FROM public.besoin_effectif 
  WHERE date >= v_new_week_start AND date <= v_new_week_end;
  
  DELETE FROM public.capacite_effective 
  WHERE date >= v_new_week_start AND date <= v_new_week_end;
  
  RAISE NOTICE 'Cleaned existing data for week +52';
  
  v_current_date := v_new_week_start;
  
  WHILE v_current_date <= v_new_week_end LOOP
    v_jour_semaine := EXTRACT(ISODOW FROM v_current_date);
    
    SELECT EXISTS(
      SELECT 1 FROM public.jours_feries
      WHERE date = v_current_date AND actif = true
    ) INTO v_is_holiday;
    
    IF NOT v_is_holiday THEN
      -- Générer besoins_effectif (médecins)
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
          v_should_work := public.should_doctor_work(
            v_horaire_medecin.alternance_type,
            v_horaire_medecin.alternance_semaine_modulo,
            v_current_date
          );
          
          IF v_should_work THEN
            IF v_horaire_medecin.demi_journee = 'toute_journee' THEN
              -- Vérifier absence matin
              SELECT EXISTS(
                SELECT 1 FROM public.absences
                WHERE medecin_id = v_medecin.id
                  AND v_current_date BETWEEN date_debut AND date_fin
                  AND statut IN ('approuve', 'en_attente')
                  AND demi_journee IN ('matin', 'toute_journee')
              ) INTO v_has_absence_matin;

              -- Vérifier absence après-midi
              SELECT EXISTS(
                SELECT 1 FROM public.absences
                WHERE medecin_id = v_medecin.id
                  AND v_current_date BETWEEN date_debut AND date_fin
                  AND statut IN ('approuve', 'en_attente')
                  AND demi_journee IN ('apres_midi', 'toute_journee')
              ) INTO v_has_absence_am;

              IF NOT v_has_absence_matin THEN
                INSERT INTO public.besoin_effectif (
                  date, type, medecin_id, site_id, demi_journee, type_intervention_id
                ) VALUES (
                  v_current_date, 'medecin', v_medecin.id, v_horaire_medecin.site_id, 
                  'matin'::demi_journee, v_horaire_medecin.type_intervention_id
                ) ON CONFLICT DO NOTHING;
                v_besoin_count := v_besoin_count + 1;
              END IF;

              IF NOT v_has_absence_am THEN
                INSERT INTO public.besoin_effectif (
                  date, type, medecin_id, site_id, demi_journee, type_intervention_id
                ) VALUES (
                  v_current_date, 'medecin', v_medecin.id, v_horaire_medecin.site_id,
                  'apres_midi'::demi_journee, v_horaire_medecin.type_intervention_id
                ) ON CONFLICT DO NOTHING;
                v_besoin_count := v_besoin_count + 1;
              END IF;
            ELSE
              -- Pour matin ou apres_midi spécifique
              SELECT EXISTS(
                SELECT 1 FROM public.absences
                WHERE medecin_id = v_medecin.id
                  AND v_current_date BETWEEN date_debut AND date_fin
                  AND statut IN ('approuve', 'en_attente')
                  AND demi_journee IN (v_horaire_medecin.demi_journee, 'toute_journee')
              ) INTO v_has_absence;

              IF NOT v_has_absence THEN
                INSERT INTO public.besoin_effectif (
                  date, type, medecin_id, site_id, demi_journee, type_intervention_id
                ) VALUES (
                  v_current_date, 'medecin', v_medecin.id, v_horaire_medecin.site_id,
                  v_horaire_medecin.demi_journee, v_horaire_medecin.type_intervention_id
                ) ON CONFLICT DO NOTHING;
                v_besoin_count := v_besoin_count + 1;
              END IF;
            END IF;
          END IF;
        END LOOP;
      END LOOP;
      
      -- Générer capacites_effectives (secrétaires)
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
          v_should_work := CASE COALESCE(v_horaire_secretaire.alternance_type, 'hebdomadaire'::type_alternance)
            WHEN 'hebdomadaire' THEN true
            WHEN 'une_sur_deux' THEN ((EXTRACT(WEEK FROM v_current_date)::integer) % 2 = COALESCE(v_horaire_secretaire.alternance_semaine_modulo, 0))
            WHEN 'une_sur_trois' THEN ((EXTRACT(WEEK FROM v_current_date)::integer) % 3 = COALESCE(v_horaire_secretaire.alternance_semaine_modulo, 0))
            WHEN 'une_sur_quatre' THEN ((EXTRACT(WEEK FROM v_current_date)::integer) % 4 = COALESCE(v_horaire_secretaire.alternance_semaine_modulo, 0))
            ELSE true
          END;
          
          IF v_should_work THEN
            v_site_id := COALESCE(v_horaire_secretaire.site_id, '00000000-0000-0000-0000-000000000001'::uuid);
            
            IF v_horaire_secretaire.demi_journee = 'toute_journee' THEN
              -- Vérifier absence matin
              SELECT EXISTS(
                SELECT 1 FROM public.absences
                WHERE secretaire_id = v_secretaire.id
                  AND v_current_date BETWEEN date_debut AND date_fin
                  AND statut IN ('approuve', 'en_attente')
                  AND demi_journee IN ('matin', 'toute_journee')
              ) INTO v_has_absence_matin;

              -- Vérifier absence après-midi
              SELECT EXISTS(
                SELECT 1 FROM public.absences
                WHERE secretaire_id = v_secretaire.id
                  AND v_current_date BETWEEN date_debut AND date_fin
                  AND statut IN ('approuve', 'en_attente')
                  AND demi_journee IN ('apres_midi', 'toute_journee')
              ) INTO v_has_absence_am;

              IF NOT v_has_absence_matin THEN
                INSERT INTO public.capacite_effective (
                  date, secretaire_id, demi_journee, site_id
                ) VALUES (
                  v_current_date, v_secretaire.id, 'matin'::demi_journee, v_site_id
                ) ON CONFLICT DO NOTHING;
                v_capacite_count := v_capacite_count + 1;
              END IF;

              IF NOT v_has_absence_am THEN
                INSERT INTO public.capacite_effective (
                  date, secretaire_id, demi_journee, site_id
                ) VALUES (
                  v_current_date, v_secretaire.id, 'apres_midi'::demi_journee, v_site_id
                ) ON CONFLICT DO NOTHING;
                v_capacite_count := v_capacite_count + 1;
              END IF;
            ELSE
              -- Pour matin ou apres_midi spécifique
              SELECT EXISTS(
                SELECT 1 FROM public.absences
                WHERE secretaire_id = v_secretaire.id
                  AND v_current_date BETWEEN date_debut AND date_fin
                  AND statut IN ('approuve', 'en_attente')
                  AND demi_journee IN (v_horaire_secretaire.demi_journee, 'toute_journee')
              ) INTO v_has_absence;

              IF NOT v_has_absence THEN
                INSERT INTO public.capacite_effective (
                  date, secretaire_id, demi_journee, site_id
                ) VALUES (
                  v_current_date, v_secretaire.id, v_horaire_secretaire.demi_journee, v_site_id
                ) ON CONFLICT DO NOTHING;
                v_capacite_count := v_capacite_count + 1;
              END IF;
            END IF;
          END IF;
        END LOOP;
      END LOOP;
    END IF;
    
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
  
  RAISE NOTICE 'Weekly planning maintenance completed for week % to %: generated % besoins and % capacites', 
    v_new_week_start, v_new_week_end, v_besoin_count, v_capacite_count;
END;
$function$;

-- 4. Régénérer toutes les données existantes pour corriger les erreurs
DO $$
DECLARE
  v_horaire RECORD;
BEGIN
  RAISE NOTICE 'Régénération des besoins et capacités avec correction des absences...';
  
  -- Supprimer et régénérer les besoins effectifs (médecins)
  DELETE FROM public.besoin_effectif WHERE date >= CURRENT_DATE;
  
  FOR v_horaire IN
    SELECT * FROM public.horaires_base_medecins WHERE actif = true
  LOOP
    PERFORM public.handle_horaire_medecin_insert_logic(v_horaire);
  END LOOP;
  
  -- Supprimer et régénérer les capacités effectives (secrétaires)
  DELETE FROM public.capacite_effective WHERE date >= CURRENT_DATE;
  
  FOR v_horaire IN
    SELECT * FROM public.horaires_base_secretaires WHERE actif = true
  LOOP
    PERFORM public.handle_horaire_secretaire_insert_logic(v_horaire);
  END LOOP;
  
  RAISE NOTICE 'Régénération terminée avec succès!';
END $$;