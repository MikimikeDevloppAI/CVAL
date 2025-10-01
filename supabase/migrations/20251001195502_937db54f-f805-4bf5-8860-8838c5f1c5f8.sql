-- Fix recreate functions to ensure proper date casting and only regenerate for specific person

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
  v_abs_start time;
  v_abs_end time;
  v_seg_start time;
  v_seg_end time;
  v_max_date date;
BEGIN
  -- Get the maximum date that exists in capacite_effective - CAST TO DATE
  SELECT COALESCE(MAX(date), (CURRENT_DATE + INTERVAL '52 weeks')::date) 
  INTO v_max_date 
  FROM public.capacite_effective;
  
  -- Override p_date_fin with the max date to ensure we regenerate all existing weeks
  p_date_fin := v_max_date;
  
  -- Get secretary info
  SELECT id 
  INTO v_secretaire
  FROM public.secretaires 
  WHERE id = p_secretaire_id AND actif = true;
  
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Delete all existing data for THIS SECRETARY ONLY from p_date_debut to p_date_fin
  DELETE FROM public.capacite_effective
  WHERE secretaire_id = p_secretaire_id 
    AND date >= p_date_debut 
    AND date <= p_date_fin;

  v_current_date := p_date_debut;
  
  WHILE v_current_date <= p_date_fin LOOP
    v_jour_semaine := EXTRACT(ISODOW FROM v_current_date);
    
    FOR v_horaire IN
      SELECT * FROM public.horaires_base_secretaires
      WHERE secretaire_id = p_secretaire_id
        AND jour_semaine = v_jour_semaine
        AND actif = true
    LOOP
      -- Check for full-day absence
      SELECT COUNT(*) INTO v_abs_full
      FROM public.absences
      WHERE secretaire_id = p_secretaire_id
        AND v_current_date BETWEEN date_debut AND date_fin
        AND statut IN ('approuve', 'en_attente')
        AND heure_debut IS NULL AND heure_fin IS NULL;
      
      IF v_abs_full = 0 THEN
        -- Get partial-day absence window
        SELECT MIN(heure_debut), MAX(heure_fin)
        INTO v_abs_start, v_abs_end
        FROM public.absences
        WHERE secretaire_id = p_secretaire_id
          AND v_current_date BETWEEN date_debut AND date_fin
          AND statut IN ('approuve', 'en_attente')
          AND heure_debut IS NOT NULL AND heure_fin IS NOT NULL;

        IF v_abs_start IS NULL OR v_abs_end IS NULL THEN
          -- No absence: insert whole slot FOR THIS SECRETARY ONLY
          INSERT INTO public.capacite_effective (
            date, secretaire_id, heure_debut, heure_fin
          ) VALUES (
            v_current_date, v_secretaire.id,
            v_horaire.heure_debut, v_horaire.heure_fin
          )
          ON CONFLICT DO NOTHING;
        ELSE
          -- Segment before absence
          v_seg_start := v_horaire.heure_debut;
          v_seg_end := LEAST(v_abs_start, v_horaire.heure_fin);
          IF v_seg_start < v_seg_end AND (v_seg_end - v_seg_start) >= INTERVAL '30 minutes' THEN
            INSERT INTO public.capacite_effective (
              date, secretaire_id, heure_debut, heure_fin
            ) VALUES (
              v_current_date, v_secretaire.id,
              v_seg_start, v_seg_end
            )
            ON CONFLICT DO NOTHING;
          END IF;

          -- Segment after absence
          v_seg_start := GREATEST(v_abs_end, v_horaire.heure_debut);
          v_seg_end := v_horaire.heure_fin;
          IF v_seg_start < v_seg_end AND (v_seg_end - v_seg_start) >= INTERVAL '30 minutes' THEN
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
    
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
END;
$function$;

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
  SELECT id, specialite_id, besoin_secretaires 
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
              date, type, medecin_id, site_id, specialite_id,
              heure_debut, heure_fin, nombre_secretaires_requis
            ) VALUES (
              v_current_date, 'medecin', v_medecin.id, v_horaire.site_id, 
              v_medecin.specialite_id, v_horaire.heure_debut, v_horaire.heure_fin, 
              v_medecin.besoin_secretaires
            )
            ON CONFLICT DO NOTHING;
          ELSE
            -- Segment before absence
            v_seg_start := v_horaire.heure_debut;
            v_seg_end := LEAST(v_abs_start, v_horaire.heure_fin);
            IF v_seg_start < v_seg_end AND (v_seg_end - v_seg_start) >= INTERVAL '30 minutes' THEN
              INSERT INTO public.besoin_effectif (
                date, type, medecin_id, site_id, specialite_id,
                heure_debut, heure_fin, nombre_secretaires_requis
              ) VALUES (
                v_current_date, 'medecin', v_medecin.id, v_horaire.site_id,
                v_medecin.specialite_id, v_seg_start, v_seg_end, v_medecin.besoin_secretaires
              )
              ON CONFLICT DO NOTHING;
            END IF;

            -- Segment after absence
            v_seg_start := GREATEST(v_abs_end, v_horaire.heure_debut);
            v_seg_end := v_horaire.heure_fin;
            IF v_seg_start < v_seg_end AND (v_seg_end - v_seg_start) >= INTERVAL '30 minutes' THEN
              INSERT INTO public.besoin_effectif (
                date, type, medecin_id, site_id, specialite_id,
                heure_debut, heure_fin, nombre_secretaires_requis
              ) VALUES (
                v_current_date, 'medecin', v_medecin.id, v_horaire.site_id,
                v_medecin.specialite_id, v_seg_start, v_seg_end, v_medecin.besoin_secretaires
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