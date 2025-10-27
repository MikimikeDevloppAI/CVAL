-- Fix generate_capacite_effective to work with demi_journee instead of heure_debut/heure_fin

CREATE OR REPLACE FUNCTION public.generate_capacite_effective()
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
  v_secretaire RECORD;
  v_horaire RECORD;
  v_abs_full INTEGER;
  v_abs_start TIME;
  v_abs_end TIME;
  v_seg_start TIME;
  v_seg_end TIME;
  v_horaire_debut TIME;
  v_horaire_fin TIME;
  v_semaines_diff INTEGER;
  v_should_work BOOLEAN;
BEGIN
  -- Clean old data
  DELETE FROM public.capacite_effective WHERE date < CURRENT_DATE - INTERVAL '8 weeks';

  v_current_date := v_start_date;
  
  WHILE v_current_date <= v_end_date LOOP
    v_jour_semaine := EXTRACT(ISODOW FROM v_current_date);
    
    FOR v_secretaire IN
      SELECT id, specialites, site_preferentiel_id FROM public.secretaires WHERE actif = true
    LOOP
      FOR v_horaire IN
        SELECT * FROM public.horaires_base_secretaires
        WHERE secretaire_id = v_secretaire.id
          AND jour_semaine = v_jour_semaine
          AND actif = true
          AND (date_debut IS NULL OR v_current_date >= date_debut)
          AND (date_fin IS NULL OR v_current_date <= date_fin)
      LOOP
        -- Calculate if secretary should work this week based on alternance
        v_semaines_diff := FLOOR((v_current_date - COALESCE(v_horaire.alternance_semaine_reference, v_current_date)) / 7);
        
        v_should_work := CASE COALESCE(v_horaire.alternance_type, 'hebdomadaire')
          WHEN 'hebdomadaire' THEN true
          WHEN 'une_sur_deux' THEN (v_semaines_diff % 2 = COALESCE(v_horaire.alternance_semaine_modulo, 0))
          WHEN 'une_sur_trois' THEN (v_semaines_diff % 3 = COALESCE(v_horaire.alternance_semaine_modulo, 0))
          WHEN 'une_sur_quatre' THEN (v_semaines_diff % 4 = COALESCE(v_horaire.alternance_semaine_modulo, 0))
          WHEN 'trois_sur_quatre' THEN (v_semaines_diff % 4 <> COALESCE(v_horaire.alternance_semaine_modulo, 0))
          ELSE true
        END;
        
        IF NOT v_should_work THEN
          CONTINUE;
        END IF;
        
        -- Convert demi_journee to time ranges
        CASE v_horaire.demi_journee
          WHEN 'matin' THEN
            v_horaire_debut := '07:30:00';
            v_horaire_fin := '12:00:00';
          WHEN 'apres_midi' THEN
            v_horaire_debut := '13:00:00';
            v_horaire_fin := '17:00:00';
          WHEN 'toute_journee' THEN
            v_horaire_debut := '07:30:00';
            v_horaire_fin := '17:00:00';
          ELSE
            v_horaire_debut := '07:30:00';
            v_horaire_fin := '17:00:00';
        END CASE;
        
        -- Check for full-day absence
        SELECT COUNT(*) INTO v_abs_full
        FROM public.absences
        WHERE secretaire_id = v_secretaire.id
          AND v_current_date BETWEEN date_debut AND date_fin
          AND statut IN ('approuve', 'en_attente')
          AND (heure_debut IS NULL OR heure_fin IS NULL);
        
        IF v_abs_full = 0 THEN
          -- Get partial-day absence window if any (union window min/max)
          SELECT MIN(heure_debut), MAX(heure_fin)
            INTO v_abs_start, v_abs_end
          FROM public.absences
          WHERE secretaire_id = v_secretaire.id
            AND v_current_date BETWEEN date_debut AND date_fin
            AND statut IN ('approuve', 'en_attente')
            AND heure_debut IS NOT NULL AND heure_fin IS NOT NULL;

          IF v_abs_start IS NULL OR v_abs_end IS NULL THEN
            INSERT INTO public.capacite_effective (
              date, secretaire_id, site_id, heure_debut, heure_fin, specialites
            ) VALUES (
              v_current_date, v_secretaire.id,
              COALESCE(v_horaire.site_id, v_secretaire.site_preferentiel_id, (SELECT id FROM public.sites WHERE actif = true LIMIT 1)),
              v_horaire_debut, v_horaire_fin, v_secretaire.specialites
            )
            ON CONFLICT DO NOTHING;
          ELSE
            -- Segment before absence
            v_seg_start := v_horaire_debut;
            v_seg_end := LEAST(v_abs_start, v_horaire_fin);
            IF v_seg_start < v_seg_end THEN
              INSERT INTO public.capacite_effective (
                date, secretaire_id, site_id, heure_debut, heure_fin, specialites
              ) VALUES (
                v_current_date, v_secretaire.id,
                COALESCE(v_horaire.site_id, v_secretaire.site_preferentiel_id, (SELECT id FROM public.sites WHERE actif = true LIMIT 1)),
                v_seg_start, v_seg_end, v_secretaire.specialites
              )
              ON CONFLICT DO NOTHING;
            END IF;

            -- Segment after absence
            v_seg_start := GREATEST(v_abs_end, v_horaire_debut);
            v_seg_end := v_horaire_fin;
            IF v_seg_start < v_seg_end THEN
              INSERT INTO public.capacite_effective (
                date, secretaire_id, site_id, heure_debut, heure_fin, specialites
              ) VALUES (
                v_current_date, v_secretaire.id,
                COALESCE(v_horaire.site_id, v_secretaire.site_preferentiel_id, (SELECT id FROM public.sites WHERE actif = true LIMIT 1)),
                v_seg_start, v_seg_end, v_secretaire.specialites
              )
              ON CONFLICT DO NOTHING;
            END IF;
          END IF;
        END IF;
      END LOOP;
    END LOOP;
    
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
END;
$function$;