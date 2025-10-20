-- Fix handle_horaire_medecin_insert_logic to delete conflicting besoins before insert
CREATE OR REPLACE FUNCTION public.handle_horaire_medecin_insert_logic(p_horaire record)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_current_date DATE;
  v_start_date DATE;
  v_end_date DATE;
  v_should_work BOOLEAN;
  v_abs_full INTEGER;
  v_has_partial_absence BOOLEAN;
  v_is_holiday BOOLEAN;
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
    SELECT EXISTS(
      SELECT 1 FROM public.jours_feries
      WHERE date = v_current_date AND actif = true
    ) INTO v_is_holiday;
    
    v_should_work := public.should_doctor_work(
      p_horaire.alternance_type,
      p_horaire.alternance_semaine_modulo,
      v_current_date
    );
    
    IF v_should_work AND NOT v_is_holiday THEN
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
          -- DELETE conflicting besoins BEFORE insert (all sites)
          IF p_horaire.demi_journee = 'toute_journee' THEN
            DELETE FROM public.besoin_effectif
            WHERE type = 'medecin'
              AND medecin_id = p_horaire.medecin_id
              AND date = v_current_date
              AND demi_journee IN ('matin', 'apres_midi');
          ELSE
            DELETE FROM public.besoin_effectif
            WHERE type = 'medecin'
              AND medecin_id = p_horaire.medecin_id
              AND date = v_current_date
              AND demi_journee = p_horaire.demi_journee;
          END IF;
          
          -- Then insert as usual
          INSERT INTO public.besoin_effectif (
            date, type, medecin_id, site_id, demi_journee, type_intervention_id
          ) VALUES (
            v_current_date, 'medecin', p_horaire.medecin_id, p_horaire.site_id, 
            p_horaire.demi_journee, p_horaire.type_intervention_id
          );
        END IF;
      END IF;
    END IF;
    
    v_current_date := v_current_date + INTERVAL '7 days';
  END LOOP;
END;
$function$;

-- Apply same logic for secretaries
CREATE OR REPLACE FUNCTION public.handle_horaire_secretaire_insert_logic(p_horaire record)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_current_date DATE;
  v_start_date DATE;
  v_end_date DATE;
  v_abs_full INTEGER;
  v_has_partial_absence BOOLEAN;
  v_is_holiday BOOLEAN;
  v_should_work BOOLEAN;
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
    SELECT EXISTS(
      SELECT 1 FROM public.jours_feries
      WHERE date = v_current_date AND actif = true
    ) INTO v_is_holiday;
    
    v_should_work := CASE COALESCE(p_horaire.alternance_type, 'hebdomadaire'::type_alternance)
      WHEN 'hebdomadaire' THEN true
      WHEN 'une_sur_deux' THEN ((EXTRACT(WEEK FROM v_current_date)::integer) % 2 = COALESCE(p_horaire.alternance_semaine_modulo, 0))
      WHEN 'une_sur_trois' THEN ((EXTRACT(WEEK FROM v_current_date)::integer) % 3 = COALESCE(p_horaire.alternance_semaine_modulo, 0))
      WHEN 'une_sur_quatre' THEN ((EXTRACT(WEEK FROM v_current_date)::integer) % 4 = COALESCE(p_horaire.alternance_semaine_modulo, 0))
      ELSE true
    END;
    
    IF v_should_work AND NOT v_is_holiday THEN
      SELECT COUNT(*) INTO v_abs_full
      FROM public.absences
      WHERE secretaire_id = p_horaire.secretaire_id
        AND v_current_date BETWEEN date_debut AND date_fin
        AND statut IN ('approuve', 'en_attente')
        AND heure_debut IS NULL AND heure_fin IS NULL;
      
      IF v_abs_full = 0 THEN
        SELECT EXISTS(
          SELECT 1 FROM public.absences
          WHERE secretaire_id = p_horaire.secretaire_id
            AND v_current_date BETWEEN date_debut AND date_fin
            AND statut IN ('approuve', 'en_attente')
            AND heure_debut IS NOT NULL AND heure_fin IS NOT NULL
        ) INTO v_has_partial_absence;

        IF NOT v_has_partial_absence THEN
          -- DELETE conflicting capacites BEFORE insert (all sites)
          IF p_horaire.demi_journee = 'toute_journee' THEN
            DELETE FROM public.capacite_effective
            WHERE secretaire_id = p_horaire.secretaire_id
              AND date = v_current_date
              AND demi_journee IN ('matin', 'apres_midi');
          ELSE
            DELETE FROM public.capacite_effective
            WHERE secretaire_id = p_horaire.secretaire_id
              AND date = v_current_date
              AND demi_journee = p_horaire.demi_journee;
          END IF;
          
          -- Then insert as usual
          INSERT INTO public.capacite_effective (
            date, secretaire_id, demi_journee, site_id
          ) VALUES (
            v_current_date, p_horaire.secretaire_id, p_horaire.demi_journee, p_horaire.site_id
          )
          ON CONFLICT DO NOTHING;
        END IF;
      END IF;
    END IF;
    
    v_current_date := v_current_date + INTERVAL '7 days';
  END LOOP;
END;
$function$;