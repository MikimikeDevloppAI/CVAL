-- Mettre à jour recreate_doctor_besoin pour utiliser demi_journee
CREATE OR REPLACE FUNCTION public.recreate_doctor_besoin(p_medecin_id uuid, p_date_debut date, p_date_fin date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_current_date date;
  v_jour_semaine integer;
  v_medecin RECORD;
  v_horaire RECORD;
  v_abs_full integer;
  v_abs_period boolean;
  v_max_date date;
  v_is_holiday boolean;
  v_should_work boolean;
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

  v_current_date := p_date_debut;
  
  WHILE v_current_date <= p_date_fin LOOP
    v_jour_semaine := EXTRACT(ISODOW FROM v_current_date);
    
    SELECT EXISTS(
      SELECT 1 FROM public.jours_feries
      WHERE date = v_current_date AND actif = true
    ) INTO v_is_holiday;
    
    IF NOT v_is_holiday THEN
      FOR v_horaire IN
        SELECT * FROM public.horaires_base_medecins
        WHERE medecin_id = p_medecin_id
          AND jour_semaine = v_jour_semaine
          AND actif = true
          AND (date_debut IS NULL OR v_current_date >= date_debut)
          AND (date_fin IS NULL OR v_current_date <= date_fin)
      LOOP
        v_should_work := public.should_doctor_work(
          v_horaire.alternance_type,
          v_horaire.alternance_semaine_modulo,
          v_current_date
        );
        
        IF v_should_work THEN
          -- Vérifier absence toute journée
          SELECT COUNT(*) INTO v_abs_full
          FROM public.absences
          WHERE medecin_id = p_medecin_id
            AND v_current_date BETWEEN date_debut AND date_fin
            AND statut IN ('approuve', 'en_attente')
            AND demi_journee = 'toute_journee';
          
          IF v_abs_full = 0 THEN
            -- Vérifier absence pour la période spécifique
            SELECT EXISTS(
              SELECT 1 FROM public.absences
              WHERE medecin_id = p_medecin_id
                AND v_current_date BETWEEN date_debut AND date_fin
                AND statut IN ('approuve', 'en_attente')
                AND demi_journee = v_horaire.demi_journee
            ) INTO v_abs_period;

            IF NOT v_abs_period THEN
              -- Insérer matin et après-midi si toute_journee, sinon juste la période
              IF v_horaire.demi_journee = 'toute_journee' THEN
                INSERT INTO public.besoin_effectif (
                  date, type, medecin_id, site_id, demi_journee, type_intervention_id
                ) VALUES (
                  v_current_date, 'medecin', v_medecin.id, v_horaire.site_id, 'matin'::demi_journee, v_horaire.type_intervention_id
                ) ON CONFLICT DO NOTHING;
                
                INSERT INTO public.besoin_effectif (
                  date, type, medecin_id, site_id, demi_journee, type_intervention_id
                ) VALUES (
                  v_current_date, 'medecin', v_medecin.id, v_horaire.site_id, 'apres_midi'::demi_journee, v_horaire.type_intervention_id
                ) ON CONFLICT DO NOTHING;
              ELSE
                INSERT INTO public.besoin_effectif (
                  date, type, medecin_id, site_id, demi_journee, type_intervention_id
                ) VALUES (
                  v_current_date, 'medecin', v_medecin.id, v_horaire.site_id, v_horaire.demi_journee, v_horaire.type_intervention_id
                ) ON CONFLICT DO NOTHING;
              END IF;
            END IF;
          END IF;
        END IF;
      END LOOP;
    END IF;
    
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
END;
$$;

-- Mettre à jour recreate_secretary_capacite pour utiliser demi_journee
CREATE OR REPLACE FUNCTION public.recreate_secretary_capacite(p_secretaire_id uuid, p_date_debut date, p_date_fin date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_current_date date;
  v_jour_semaine integer;
  v_secretaire RECORD;
  v_horaire RECORD;
  v_abs_full integer;
  v_abs_period boolean;
  v_max_date date;
  v_is_holiday boolean;
  v_should_work boolean;
  v_site_id uuid;
BEGIN
  SELECT COALESCE(MAX(date), (CURRENT_DATE + INTERVAL '52 weeks')::date) 
  INTO v_max_date 
  FROM public.capacite_effective;
  
  p_date_fin := v_max_date;
  
  SELECT id 
  INTO v_secretaire
  FROM public.secretaires 
  WHERE id = p_secretaire_id AND actif = true;
  
  IF NOT FOUND THEN
    RETURN;
  END IF;

  DELETE FROM public.capacite_effective
  WHERE secretaire_id = p_secretaire_id 
    AND date >= p_date_debut 
    AND date <= p_date_fin;

  v_current_date := p_date_debut;
  
  WHILE v_current_date <= p_date_fin LOOP
    v_jour_semaine := EXTRACT(ISODOW FROM v_current_date);
    
    SELECT EXISTS(
      SELECT 1 FROM public.jours_feries
      WHERE date = v_current_date AND actif = true
    ) INTO v_is_holiday;
    
    IF NOT v_is_holiday THEN
      FOR v_horaire IN
        SELECT * FROM public.horaires_base_secretaires
        WHERE secretaire_id = p_secretaire_id
          AND jour_semaine = v_jour_semaine
          AND actif = true
          AND (date_debut IS NULL OR v_current_date >= date_debut)
          AND (date_fin IS NULL OR v_current_date <= date_fin)
      LOOP
        v_should_work := CASE COALESCE(v_horaire.alternance_type, 'hebdomadaire'::type_alternance)
          WHEN 'hebdomadaire' THEN true
          WHEN 'une_sur_deux' THEN ((EXTRACT(WEEK FROM v_current_date)::integer) % 2 = COALESCE(v_horaire.alternance_semaine_modulo, 0))
          WHEN 'une_sur_trois' THEN ((EXTRACT(WEEK FROM v_current_date)::integer) % 3 = COALESCE(v_horaire.alternance_semaine_modulo, 0))
          WHEN 'une_sur_quatre' THEN ((EXTRACT(WEEK FROM v_current_date)::integer) % 4 = COALESCE(v_horaire.alternance_semaine_modulo, 0))
          ELSE true
        END;
        
        IF v_should_work THEN
          -- Vérifier absence toute journée
          SELECT COUNT(*) INTO v_abs_full
          FROM public.absences
          WHERE secretaire_id = p_secretaire_id
            AND v_current_date BETWEEN date_debut AND date_fin
            AND statut IN ('approuve', 'en_attente')
            AND demi_journee = 'toute_journee';
          
          IF v_abs_full = 0 THEN
            -- Vérifier absence pour la période spécifique
            SELECT EXISTS(
              SELECT 1 FROM public.absences
              WHERE secretaire_id = p_secretaire_id
                AND v_current_date BETWEEN date_debut AND date_fin
                AND statut IN ('approuve', 'en_attente')
                AND demi_journee = v_horaire.demi_journee
            ) INTO v_abs_period;

            IF NOT v_abs_period THEN
              v_site_id := COALESCE(v_horaire.site_id, '00000000-0000-0000-0000-000000000001'::uuid);
              
              -- Insérer matin et après-midi si toute_journee, sinon juste la période
              IF v_horaire.demi_journee = 'toute_journee' THEN
                INSERT INTO public.capacite_effective (
                  date, secretaire_id, demi_journee, site_id
                ) VALUES (
                  v_current_date, v_secretaire.id, 'matin'::demi_journee, v_site_id
                ) ON CONFLICT DO NOTHING;
                
                INSERT INTO public.capacite_effective (
                  date, secretaire_id, demi_journee, site_id
                ) VALUES (
                  v_current_date, v_secretaire.id, 'apres_midi'::demi_journee, v_site_id
                ) ON CONFLICT DO NOTHING;
              ELSE
                INSERT INTO public.capacite_effective (
                  date, secretaire_id, demi_journee, site_id
                ) VALUES (
                  v_current_date, v_secretaire.id, v_horaire.demi_journee, v_site_id
                ) ON CONFLICT DO NOTHING;
              END IF;
            END IF;
          END IF;
        END IF;
      END LOOP;
    END IF;
    
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
END;
$$;