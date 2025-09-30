-- Add besoin_secretaires column to medecins table
ALTER TABLE public.medecins 
ADD COLUMN besoin_secretaires NUMERIC NOT NULL DEFAULT 1.2;

-- Update generate_besoin_effectif function to use medecin's besoin_secretaires
CREATE OR REPLACE FUNCTION public.generate_besoin_effectif()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start_date DATE := CURRENT_DATE;
  v_end_date DATE := CURRENT_DATE + INTERVAL '5 weeks';
  v_current_date DATE;
  v_jour_semaine INTEGER;
  v_medecin RECORD;
  v_horaire RECORD;
  v_bloc RECORD;
  v_absence INTEGER;
  v_semaines_diff INTEGER;
  v_should_work BOOLEAN;
BEGIN
  -- Clean old data (older than 8 weeks)
  DELETE FROM public.besoin_effectif WHERE date < CURRENT_DATE - INTERVAL '8 weeks';

  v_current_date := v_start_date;
  
  WHILE v_current_date <= v_end_date LOOP
    v_jour_semaine := EXTRACT(ISODOW FROM v_current_date);
    
    -- Generate for all active doctors
    FOR v_medecin IN
      SELECT id, profile_id, specialite_id, besoin_secretaires FROM public.medecins WHERE actif = true
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
          -- Check for absence
          SELECT COUNT(*) INTO v_absence
          FROM public.absences
          WHERE profile_id = v_medecin.profile_id
            AND v_current_date BETWEEN date_debut AND date_fin
            AND statut IN ('approuve', 'en_attente');
          
          -- Only insert if no absence, use medecin's besoin_secretaires
          IF v_absence = 0 THEN
            INSERT INTO public.besoin_effectif (
              date, type, medecin_id, site_id, specialite_id,
              heure_debut, heure_fin, nombre_secretaires_requis
            ) VALUES (
              v_current_date, 'medecin', v_medecin.id, v_horaire.site_id, v_medecin.specialite_id,
              v_horaire.heure_debut, v_horaire.heure_fin, v_medecin.besoin_secretaires
            )
            ON CONFLICT DO NOTHING;
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
        date, type, bloc_operatoire_besoin_id, site_id, specialite_id,
        heure_debut, heure_fin, nombre_secretaires_requis
      ) VALUES (
        v_bloc.date, 'bloc_operatoire', v_bloc.id,
        (SELECT id FROM public.sites WHERE actif = true LIMIT 1),
        v_bloc.specialite_id, v_bloc.heure_debut, v_bloc.heure_fin,
        v_bloc.nombre_secretaires_requis
      )
      ON CONFLICT DO NOTHING;
    END LOOP;
    
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
END;
$$;