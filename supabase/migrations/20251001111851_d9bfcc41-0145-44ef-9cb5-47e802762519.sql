-- Fix generate_capacite_effective to delete data in regeneration range first
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
BEGIN
  -- Delete ALL data in the range we're about to regenerate (like generate_besoin_effectif does)
  DELETE FROM public.capacite_effective 
  WHERE date >= v_start_date AND date <= v_end_date;

  -- Clean old data (older than 8 weeks)
  DELETE FROM public.capacite_effective WHERE date < CURRENT_DATE - INTERVAL '8 weeks';

  v_current_date := v_start_date;
  
  WHILE v_current_date <= v_end_date LOOP
    v_jour_semaine := EXTRACT(ISODOW FROM v_current_date);
    
    FOR v_secretaire IN
      SELECT id, specialites FROM public.secretaires WHERE actif = true
    LOOP
      FOR v_horaire IN
        SELECT * FROM public.horaires_base_secretaires
        WHERE secretaire_id = v_secretaire.id
          AND jour_semaine = v_jour_semaine
          AND actif = true
      LOOP
        -- Check for full-day absence (both heure_debut AND heure_fin must be NULL)
        SELECT COUNT(*) INTO v_abs_full
        FROM public.absences
        WHERE secretaire_id = v_secretaire.id
          AND v_current_date BETWEEN date_debut AND date_fin
          AND statut IN ('approuve', 'en_attente')
          AND heure_debut IS NULL AND heure_fin IS NULL;
        
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
              date, secretaire_id, heure_debut, heure_fin, specialites
            ) VALUES (
              v_current_date, v_secretaire.id,
              v_horaire.heure_debut, v_horaire.heure_fin, v_secretaire.specialites
            )
            ON CONFLICT DO NOTHING;
          ELSE
            -- Segment before absence
            v_seg_start := v_horaire.heure_debut;
            v_seg_end := LEAST(v_abs_start, v_horaire.heure_fin);
            IF v_seg_start < v_seg_end THEN
              INSERT INTO public.capacite_effective (
                date, secretaire_id, heure_debut, heure_fin, specialites
              ) VALUES (
                v_current_date, v_secretaire.id,
                v_seg_start, v_seg_end, v_secretaire.specialites
              )
              ON CONFLICT DO NOTHING;
            END IF;

            -- Segment after absence
            v_seg_start := GREATEST(v_abs_end, v_horaire.heure_debut);
            v_seg_end := v_horaire.heure_fin;
            IF v_seg_start < v_seg_end THEN
              INSERT INTO public.capacite_effective (
                date, secretaire_id, heure_debut, heure_fin, specialites
              ) VALUES (
                v_current_date, v_secretaire.id,
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