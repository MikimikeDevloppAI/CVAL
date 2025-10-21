-- Fix recreate_secretary_capacite to use default admin site when site_id is NULL
CREATE OR REPLACE FUNCTION public.recreate_secretary_capacite(p_secretaire_id uuid, p_date_debut date, p_date_fin date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_current_date date;
  v_jour_semaine integer;
  v_secretaire RECORD;
  v_horaire RECORD;
  v_abs_full integer;
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
      LOOP
        v_should_work := CASE COALESCE(v_horaire.alternance_type, 'hebdomadaire'::type_alternance)
          WHEN 'hebdomadaire' THEN true
          WHEN 'une_sur_deux' THEN ((EXTRACT(WEEK FROM v_current_date)::integer) % 2 = COALESCE(v_horaire.alternance_semaine_modulo, 0))
          WHEN 'une_sur_trois' THEN ((EXTRACT(WEEK FROM v_current_date)::integer) % 3 = COALESCE(v_horaire.alternance_semaine_modulo, 0))
          WHEN 'une_sur_quatre' THEN ((EXTRACT(WEEK FROM v_current_date)::integer) % 4 = COALESCE(v_horaire.alternance_semaine_modulo, 0))
          ELSE true
        END;
        
        IF v_should_work THEN
          SELECT COUNT(*) INTO v_abs_full
          FROM public.absences
          WHERE secretaire_id = p_secretaire_id
            AND v_current_date BETWEEN date_debut AND date_fin
            AND statut IN ('approuve', 'en_attente')
            AND heure_debut IS NULL AND heure_fin IS NULL;
          
          IF v_abs_full = 0 THEN
            -- Use admin site as default if site_id is NULL
            v_site_id := COALESCE(v_horaire.site_id, '00000000-0000-0000-0000-000000000001'::uuid);
            
            INSERT INTO public.capacite_effective (
              date, secretaire_id, demi_journee, site_id
            ) VALUES (
              v_current_date, v_secretaire.id, v_horaire.demi_journee, v_site_id
            )
            ON CONFLICT DO NOTHING;
          END IF;
        END IF;
      END LOOP;
    END IF;
    
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
END;
$function$;

-- Also fix handle_horaire_secretaire_insert_logic to use default admin site
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
  v_abs_full INTEGER;
  v_has_partial_absence BOOLEAN;
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
          -- Use admin site as default if site_id is NULL
          v_site_id := COALESCE(p_horaire.site_id, '00000000-0000-0000-0000-000000000001'::uuid);
          
          INSERT INTO public.capacite_effective (
            date, secretaire_id, demi_journee, site_id
          ) VALUES (
            v_current_date, p_horaire.secretaire_id, p_horaire.demi_journee, v_site_id
          )
          ON CONFLICT DO NOTHING;
        END IF;
      END IF;
    END IF;
    
    v_current_date := v_current_date + INTERVAL '7 days';
  END LOOP;
END;
$function$;