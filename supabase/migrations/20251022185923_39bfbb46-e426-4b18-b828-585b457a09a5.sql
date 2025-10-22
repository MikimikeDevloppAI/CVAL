-- Corriger handle_horaire_secretaire_insert_logic
CREATE OR REPLACE FUNCTION public.handle_horaire_secretaire_insert_logic(p_horaire record)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_current_date DATE;
  v_start_date DATE;
  v_end_date DATE;
  v_abs_full INTEGER;
  v_abs_period BOOLEAN;
  v_is_holiday BOOLEAN;
  v_should_work BOOLEAN;
  v_site_id uuid;
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
      -- Vérifier absence toute journée
      SELECT COUNT(*) INTO v_abs_full
      FROM public.absences
      WHERE secretaire_id = p_horaire.secretaire_id
        AND v_current_date BETWEEN date_debut AND date_fin
        AND statut IN ('approuve', 'en_attente')
        AND demi_journee = 'toute_journee';
      
      IF v_abs_full = 0 THEN
        -- Vérifier absence pour la période spécifique
        SELECT EXISTS(
          SELECT 1 FROM public.absences
          WHERE secretaire_id = p_horaire.secretaire_id
            AND v_current_date BETWEEN date_debut AND date_fin
            AND statut IN ('approuve', 'en_attente')
            AND demi_journee = p_horaire.demi_journee
        ) INTO v_abs_period;

        IF NOT v_abs_period THEN
          v_site_id := COALESCE(p_horaire.site_id, '00000000-0000-0000-0000-000000000001'::uuid);
          
          -- Insérer matin et après-midi si toute_journee, sinon juste la période
          IF p_horaire.demi_journee = 'toute_journee' THEN
            INSERT INTO public.capacite_effective (
              date, secretaire_id, demi_journee, site_id
            ) VALUES (
              v_current_date, p_horaire.secretaire_id, 'matin'::demi_journee, v_site_id
            ) ON CONFLICT DO NOTHING;
            
            INSERT INTO public.capacite_effective (
              date, secretaire_id, demi_journee, site_id
            ) VALUES (
              v_current_date, p_horaire.secretaire_id, 'apres_midi'::demi_journee, v_site_id
            ) ON CONFLICT DO NOTHING;
          ELSE
            INSERT INTO public.capacite_effective (
              date, secretaire_id, demi_journee, site_id
            ) VALUES (
              v_current_date, p_horaire.secretaire_id, p_horaire.demi_journee, v_site_id
            ) ON CONFLICT DO NOTHING;
          END IF;
        END IF;
      END IF;
    END IF;
    
    v_current_date := v_current_date + INTERVAL '7 days';
  END LOOP;
END;
$$;