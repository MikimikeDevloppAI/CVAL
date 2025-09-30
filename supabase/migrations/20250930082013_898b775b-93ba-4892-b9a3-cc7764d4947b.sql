-- Ajouter un type enum pour l'alternance
CREATE TYPE type_alternance AS ENUM ('hebdomadaire', 'une_sur_deux', 'une_sur_trois', 'une_sur_quatre');

-- Ajouter les colonnes d'alternance à horaires_base_medecins
ALTER TABLE public.horaires_base_medecins
ADD COLUMN alternance_type type_alternance DEFAULT 'hebdomadaire',
ADD COLUMN alternance_semaine_reference DATE DEFAULT CURRENT_DATE;

-- Mettre à jour la fonction regenerate_horaires_for_person pour tenir compte de l'alternance
CREATE OR REPLACE FUNCTION public.regenerate_horaires_for_person(p_personne_id uuid, p_type_personne type_personne)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_start_date DATE := CURRENT_DATE;
  v_end_date DATE := CURRENT_DATE + INTERVAL '5 weeks';
  v_current_date DATE;
  v_jour_semaine INTEGER;
  v_horaire RECORD;
  v_absence RECORD;
  v_new_statut statut_horaire;
  v_semaines_diff INTEGER;
  v_should_work BOOLEAN;
BEGIN
  -- Delete existing schedules for this person for the next 5 weeks
  DELETE FROM public.horaires_effectifs
  WHERE personne_id = p_personne_id
    AND type_personne = p_type_personne
    AND date BETWEEN v_start_date AND v_end_date
    AND source = 'horaire_base';

  -- Generate schedules based on base hours
  v_current_date := v_start_date;
  
  WHILE v_current_date <= v_end_date LOOP
    v_jour_semaine := EXTRACT(ISODOW FROM v_current_date);
    
    IF p_type_personne = 'medecin' THEN
      -- Generate for doctors
      FOR v_horaire IN
        SELECT hbm.*, m.specialite_id
        FROM public.horaires_base_medecins hbm
        JOIN public.medecins m ON m.id = hbm.medecin_id
        WHERE hbm.medecin_id = p_personne_id
          AND hbm.jour_semaine = v_jour_semaine
          AND hbm.actif = true
          AND m.actif = true
      LOOP
        -- Calculer si le médecin doit travailler cette semaine selon l'alternance
        v_semaines_diff := FLOOR((v_current_date - v_horaire.alternance_semaine_reference) / 7);
        
        v_should_work := CASE v_horaire.alternance_type
          WHEN 'hebdomadaire' THEN true
          WHEN 'une_sur_deux' THEN (v_semaines_diff % 2 = 0)
          WHEN 'une_sur_trois' THEN (v_semaines_diff % 3 = 0)
          WHEN 'une_sur_quatre' THEN (v_semaines_diff % 4 = 0)
          ELSE true
        END;
        
        -- Ne créer l'horaire que si le médecin doit travailler cette semaine
        IF v_should_work THEN
          -- Check if there's an absence for this date
          v_new_statut := 'disponible';
          
          FOR v_absence IN
            SELECT *
            FROM public.absences
            WHERE profile_id = (SELECT profile_id FROM public.medecins WHERE id = p_personne_id)
              AND v_current_date BETWEEN date_debut AND date_fin
              AND statut IN ('approuvee', 'en_attente')
          LOOP
            v_new_statut := 'absent';
          END LOOP;
          
          -- Insert the schedule
          INSERT INTO public.horaires_effectifs (
            date, personne_id, type_personne, site_id,
            heure_debut, heure_fin, specialite_id,
            statut, source, reference_id
          ) VALUES (
            v_current_date, p_personne_id, p_type_personne, v_horaire.site_id,
            v_horaire.heure_debut, v_horaire.heure_fin, v_horaire.specialite_id,
            v_new_statut, 'horaire_base', v_horaire.id
          )
          ON CONFLICT (date, personne_id, type_personne, heure_debut, heure_fin) 
          WHERE actif = true
          DO UPDATE SET
            statut = EXCLUDED.statut,
            updated_at = now();
        END IF;
      END LOOP;
      
    ELSE -- secretaire
      -- Generate for secretaries
      FOR v_horaire IN
        SELECT hbs.*, s.specialites, s.site_preferentiel_id
        FROM public.horaires_base_secretaires hbs
        JOIN public.secretaires s ON s.id = hbs.secretaire_id
        WHERE hbs.secretaire_id = p_personne_id
          AND hbs.jour_semaine = v_jour_semaine
          AND hbs.actif = true
          AND s.actif = true
      LOOP
        -- Check if there's an absence for this date
        v_new_statut := 'disponible';
        
        FOR v_absence IN
          SELECT *
          FROM public.absences
          WHERE profile_id = (SELECT profile_id FROM public.secretaires WHERE id = p_personne_id)
            AND v_current_date BETWEEN date_debut AND date_fin
            AND statut IN ('approuvee', 'en_attente')
        LOOP
          v_new_statut := 'absent';
        END LOOP;
        
        -- Insert the schedule (use preferential site if available)
        INSERT INTO public.horaires_effectifs (
          date, personne_id, type_personne, site_id,
          heure_debut, heure_fin, specialites,
          statut, source, reference_id
        ) VALUES (
          v_current_date, p_personne_id, p_type_personne, 
          COALESCE(v_horaire.site_preferentiel_id, (SELECT id FROM public.sites WHERE actif = true LIMIT 1)),
          v_horaire.heure_debut, v_horaire.heure_fin, v_horaire.specialites,
          v_new_statut, 'horaire_base', v_horaire.id
        )
        ON CONFLICT (date, personne_id, type_personne, heure_debut, heure_fin) 
        WHERE actif = true
        DO UPDATE SET
          statut = EXCLUDED.statut,
          updated_at = now();
      END LOOP;
    END IF;
    
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
END;
$function$;

-- Mettre à jour la fonction generate_week_plus_5 pour tenir compte de l'alternance
CREATE OR REPLACE FUNCTION public.generate_week_plus_5()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_target_date DATE := CURRENT_DATE + INTERVAL '5 weeks';
  v_start_of_week DATE := date_trunc('week', v_target_date)::DATE;
  v_end_of_week DATE := v_start_of_week + INTERVAL '6 days';
  v_current_date DATE;
  v_jour_semaine INTEGER;
  v_person RECORD;
  v_horaire RECORD;
  v_absence RECORD;
  v_new_statut statut_horaire;
  v_semaines_diff INTEGER;
  v_should_work BOOLEAN;
BEGIN
  -- Clean old data (older than 8 weeks)
  DELETE FROM public.horaires_effectifs
  WHERE date < CURRENT_DATE - INTERVAL '8 weeks';

  v_current_date := v_start_of_week;
  
  WHILE v_current_date <= v_end_of_week LOOP
    v_jour_semaine := EXTRACT(ISODOW FROM v_current_date);
    
    -- Generate for all active doctors
    FOR v_person IN
      SELECT id FROM public.medecins WHERE actif = true
    LOOP
      FOR v_horaire IN
        SELECT hbm.*, m.specialite_id
        FROM public.horaires_base_medecins hbm
        JOIN public.medecins m ON m.id = hbm.medecin_id
        WHERE hbm.medecin_id = v_person.id
          AND hbm.jour_semaine = v_jour_semaine
          AND hbm.actif = true
      LOOP
        -- Calculer si le médecin doit travailler cette semaine selon l'alternance
        v_semaines_diff := FLOOR((v_current_date - v_horaire.alternance_semaine_reference) / 7);
        
        v_should_work := CASE v_horaire.alternance_type
          WHEN 'hebdomadaire' THEN true
          WHEN 'une_sur_deux' THEN (v_semaines_diff % 2 = 0)
          WHEN 'une_sur_trois' THEN (v_semaines_diff % 3 = 0)
          WHEN 'une_sur_quatre' THEN (v_semaines_diff % 4 = 0)
          ELSE true
        END;
        
        -- Ne créer l'horaire que si le médecin doit travailler cette semaine
        IF v_should_work THEN
          v_new_statut := 'disponible';
          
          FOR v_absence IN
            SELECT *
            FROM public.absences
            WHERE profile_id = (SELECT profile_id FROM public.medecins WHERE id = v_person.id)
              AND v_current_date BETWEEN date_debut AND date_fin
              AND statut IN ('approuvee', 'en_attente')
          LOOP
            v_new_statut := 'absent';
          END LOOP;
          
          INSERT INTO public.horaires_effectifs (
            date, personne_id, type_personne, site_id,
            heure_debut, heure_fin, specialite_id,
            statut, source, reference_id
          ) VALUES (
            v_current_date, v_person.id, 'medecin', v_horaire.site_id,
            v_horaire.heure_debut, v_horaire.heure_fin, v_horaire.specialite_id,
            v_new_statut, 'horaire_base', v_horaire.id
          )
          ON CONFLICT (date, personne_id, type_personne, heure_debut, heure_fin) 
          WHERE actif = true
          DO NOTHING;
        END IF;
      END LOOP;
    END LOOP;
    
    -- Generate for all active secretaries
    FOR v_person IN
      SELECT id FROM public.secretaires WHERE actif = true
    LOOP
      FOR v_horaire IN
        SELECT hbs.*, s.specialites, s.site_preferentiel_id
        FROM public.horaires_base_secretaires hbs
        JOIN public.secretaires s ON s.id = hbs.secretaire_id
        WHERE hbs.secretaire_id = v_person.id
          AND hbs.jour_semaine = v_jour_semaine
          AND hbs.actif = true
      LOOP
        v_new_statut := 'disponible';
        
        FOR v_absence IN
          SELECT *
          FROM public.absences
          WHERE profile_id = (SELECT profile_id FROM public.secretaires WHERE id = v_person.id)
            AND v_current_date BETWEEN date_debut AND date_fin
            AND statut IN ('approuvee', 'en_attente')
        LOOP
          v_new_statut := 'absent';
        END LOOP;
        
        INSERT INTO public.horaires_effectifs (
          date, personne_id, type_personne, site_id,
          heure_debut, heure_fin, specialites,
          statut, source, reference_id
        ) VALUES (
          v_current_date, v_person.id, 'secretaire',
          COALESCE(v_horaire.site_preferentiel_id, (SELECT id FROM public.sites WHERE actif = true LIMIT 1)),
          v_horaire.heure_debut, v_horaire.heure_fin, v_horaire.specialites,
          v_new_statut, 'horaire_base', v_horaire.id
        )
        ON CONFLICT (date, personne_id, type_personne, heure_debut, heure_fin) 
        WHERE actif = true
        DO NOTHING;
      END LOOP;
    END LOOP;
    
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
END;
$function$;