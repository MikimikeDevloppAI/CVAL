-- =====================================================
-- TRIGGERS FOR HORAIRES_BASE_MEDECINS
-- Automatically manage besoin_effectif when schedule changes
-- =====================================================

-- Function to handle INSERT on horaires_base_medecins
CREATE OR REPLACE FUNCTION public.handle_horaire_medecin_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_current_date date;
  v_end_date date;
  v_semaines_diff integer;
  v_should_work boolean;
  v_abs_full integer;
  v_abs_start time;
  v_abs_end time;
  v_seg_start time;
  v_seg_end time;
BEGIN
  -- Process all dates from today to +52 weeks for this day of week
  v_current_date := CURRENT_DATE;
  v_end_date := CURRENT_DATE + INTERVAL '52 weeks';
  
  -- Find first occurrence of this day of week
  WHILE EXTRACT(ISODOW FROM v_current_date) != NEW.jour_semaine LOOP
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
  
  -- Loop through all occurrences of this day of week
  WHILE v_current_date <= v_end_date LOOP
    -- Check if doctor should work based on alternance
    v_semaines_diff := FLOOR((v_current_date - NEW.alternance_semaine_reference) / 7);
    
    v_should_work := CASE NEW.alternance_type
      WHEN 'hebdomadaire' THEN true
      WHEN 'une_sur_deux' THEN (v_semaines_diff % 2 = 0)
      WHEN 'une_sur_trois' THEN (v_semaines_diff % 3 = 0)
      WHEN 'une_sur_quatre' THEN (v_semaines_diff % 4 = 0)
      ELSE true
    END;
    
    IF v_should_work THEN
      -- Check for full-day absence
      SELECT COUNT(*) INTO v_abs_full
      FROM public.absences
      WHERE medecin_id = NEW.medecin_id
        AND v_current_date BETWEEN date_debut AND date_fin
        AND statut IN ('approuve', 'en_attente')
        AND heure_debut IS NULL AND heure_fin IS NULL;
      
      IF v_abs_full = 0 THEN
        -- Get partial-day absence window
        SELECT MIN(heure_debut), MAX(heure_fin)
        INTO v_abs_start, v_abs_end
        FROM public.absences
        WHERE medecin_id = NEW.medecin_id
          AND v_current_date BETWEEN date_debut AND date_fin
          AND statut IN ('approuve', 'en_attente')
          AND heure_debut IS NOT NULL AND heure_fin IS NOT NULL;

        IF v_abs_start IS NULL OR v_abs_end IS NULL THEN
          -- No absence: insert whole slot
          INSERT INTO public.besoin_effectif (
            date, type, medecin_id, site_id,
            heure_debut, heure_fin
          ) VALUES (
            v_current_date, 'medecin', NEW.medecin_id, NEW.site_id,
            NEW.heure_debut, NEW.heure_fin
          )
          ON CONFLICT DO NOTHING;
        ELSE
          -- Segment before absence
          v_seg_start := NEW.heure_debut;
          v_seg_end := LEAST(v_abs_start, NEW.heure_fin);
          IF v_seg_start < v_seg_end AND (v_seg_end - v_seg_start) >= INTERVAL '30 minutes' THEN
            INSERT INTO public.besoin_effectif (
              date, type, medecin_id, site_id,
              heure_debut, heure_fin
            ) VALUES (
              v_current_date, 'medecin', NEW.medecin_id, NEW.site_id,
              v_seg_start, v_seg_end
            )
            ON CONFLICT DO NOTHING;
          END IF;

          -- Segment after absence
          v_seg_start := GREATEST(v_abs_end, NEW.heure_debut);
          v_seg_end := NEW.heure_fin;
          IF v_seg_start < v_seg_end AND (v_seg_end - v_seg_start) >= INTERVAL '30 minutes' THEN
            INSERT INTO public.besoin_effectif (
              date, type, medecin_id, site_id,
              heure_debut, heure_fin
            ) VALUES (
              v_current_date, 'medecin', NEW.medecin_id, NEW.site_id,
              v_seg_start, v_seg_end
            )
            ON CONFLICT DO NOTHING;
          END IF;
        END IF;
      END IF;
    END IF;
    
    v_current_date := v_current_date + INTERVAL '7 days';
  END LOOP;
  
  RETURN NEW;
END;
$function$;

-- Function to handle UPDATE on horaires_base_medecins
CREATE OR REPLACE FUNCTION public.handle_horaire_medecin_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_current_date date;
  v_end_date date;
BEGIN
  -- Delete old entries for this day of week
  v_current_date := CURRENT_DATE;
  v_end_date := CURRENT_DATE + INTERVAL '52 weeks';
  
  -- Find first occurrence of this day of week
  WHILE EXTRACT(ISODOW FROM v_current_date) != OLD.jour_semaine LOOP
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
  
  -- Delete all occurrences for this day of week
  WHILE v_current_date <= v_end_date LOOP
    DELETE FROM public.besoin_effectif
    WHERE medecin_id = OLD.medecin_id
      AND date = v_current_date
      AND type = 'medecin';
    
    v_current_date := v_current_date + INTERVAL '7 days';
  END LOOP;
  
  -- Recreate using the insert logic
  PERFORM public.handle_horaire_medecin_insert_logic(NEW);
  
  RETURN NEW;
END;
$function$;

-- Helper function to reuse insert logic
CREATE OR REPLACE FUNCTION public.handle_horaire_medecin_insert_logic(p_horaire record)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_current_date date;
  v_end_date date;
  v_semaines_diff integer;
  v_should_work boolean;
  v_abs_full integer;
  v_abs_start time;
  v_abs_end time;
  v_seg_start time;
  v_seg_end time;
BEGIN
  v_current_date := CURRENT_DATE;
  v_end_date := CURRENT_DATE + INTERVAL '52 weeks';
  
  WHILE EXTRACT(ISODOW FROM v_current_date) != p_horaire.jour_semaine LOOP
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
  
  WHILE v_current_date <= v_end_date LOOP
    v_semaines_diff := FLOOR((v_current_date - p_horaire.alternance_semaine_reference) / 7);
    
    v_should_work := CASE p_horaire.alternance_type
      WHEN 'hebdomadaire' THEN true
      WHEN 'une_sur_deux' THEN (v_semaines_diff % 2 = 0)
      WHEN 'une_sur_trois' THEN (v_semaines_diff % 3 = 0)
      WHEN 'une_sur_quatre' THEN (v_semaines_diff % 4 = 0)
      ELSE true
    END;
    
    IF v_should_work THEN
      SELECT COUNT(*) INTO v_abs_full
      FROM public.absences
      WHERE medecin_id = p_horaire.medecin_id
        AND v_current_date BETWEEN date_debut AND date_fin
        AND statut IN ('approuve', 'en_attente')
        AND heure_debut IS NULL AND heure_fin IS NULL;
      
      IF v_abs_full = 0 THEN
        SELECT MIN(heure_debut), MAX(heure_fin)
        INTO v_abs_start, v_abs_end
        FROM public.absences
        WHERE medecin_id = p_horaire.medecin_id
          AND v_current_date BETWEEN date_debut AND date_fin
          AND statut IN ('approuve', 'en_attente')
          AND heure_debut IS NOT NULL AND heure_fin IS NOT NULL;

        IF v_abs_start IS NULL OR v_abs_end IS NULL THEN
          INSERT INTO public.besoin_effectif (
            date, type, medecin_id, site_id,
            heure_debut, heure_fin
          ) VALUES (
            v_current_date, 'medecin', p_horaire.medecin_id, p_horaire.site_id,
            p_horaire.heure_debut, p_horaire.heure_fin
          )
          ON CONFLICT DO NOTHING;
        ELSE
          v_seg_start := p_horaire.heure_debut;
          v_seg_end := LEAST(v_abs_start, p_horaire.heure_fin);
          IF v_seg_start < v_seg_end AND (v_seg_end - v_seg_start) >= INTERVAL '30 minutes' THEN
            INSERT INTO public.besoin_effectif (
              date, type, medecin_id, site_id,
              heure_debut, heure_fin
            ) VALUES (
              v_current_date, 'medecin', p_horaire.medecin_id, p_horaire.site_id,
              v_seg_start, v_seg_end
            )
            ON CONFLICT DO NOTHING;
          END IF;

          v_seg_start := GREATEST(v_abs_end, p_horaire.heure_debut);
          v_seg_end := p_horaire.heure_fin;
          IF v_seg_start < v_seg_end AND (v_seg_end - v_seg_start) >= INTERVAL '30 minutes' THEN
            INSERT INTO public.besoin_effectif (
              date, type, medecin_id, site_id,
              heure_debut, heure_fin
            ) VALUES (
              v_current_date, 'medecin', p_horaire.medecin_id, p_horaire.site_id,
              v_seg_start, v_seg_end
            )
            ON CONFLICT DO NOTHING;
          END IF;
        END IF;
      END IF;
    END IF;
    
    v_current_date := v_current_date + INTERVAL '7 days';
  END LOOP;
END;
$function$;

-- Function to handle DELETE on horaires_base_medecins
CREATE OR REPLACE FUNCTION public.handle_horaire_medecin_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_current_date date;
  v_end_date date;
BEGIN
  v_current_date := CURRENT_DATE;
  v_end_date := CURRENT_DATE + INTERVAL '52 weeks';
  
  -- Find first occurrence of this day of week
  WHILE EXTRACT(ISODOW FROM v_current_date) != OLD.jour_semaine LOOP
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
  
  -- Delete all occurrences for this day of week
  WHILE v_current_date <= v_end_date LOOP
    DELETE FROM public.besoin_effectif
    WHERE medecin_id = OLD.medecin_id
      AND date = v_current_date
      AND type = 'medecin';
    
    v_current_date := v_current_date + INTERVAL '7 days';
  END LOOP;
  
  RETURN OLD;
END;
$function$;

-- Create triggers
DROP TRIGGER IF EXISTS trigger_horaire_medecin_insert ON public.horaires_base_medecins;
CREATE TRIGGER trigger_horaire_medecin_insert
  AFTER INSERT ON public.horaires_base_medecins
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_horaire_medecin_insert();

DROP TRIGGER IF EXISTS trigger_horaire_medecin_update ON public.horaires_base_medecins;
CREATE TRIGGER trigger_horaire_medecin_update
  AFTER UPDATE ON public.horaires_base_medecins
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_horaire_medecin_update();

DROP TRIGGER IF EXISTS trigger_horaire_medecin_delete ON public.horaires_base_medecins;
CREATE TRIGGER trigger_horaire_medecin_delete
  AFTER DELETE ON public.horaires_base_medecins
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_horaire_medecin_delete();

-- =====================================================
-- TRIGGERS FOR HORAIRES_BASE_SECRETAIRES
-- Automatically manage capacite_effective when schedule changes
-- =====================================================

-- Function to handle INSERT on horaires_base_secretaires
CREATE OR REPLACE FUNCTION public.handle_horaire_secretaire_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_current_date date;
  v_end_date date;
  v_abs_full integer;
  v_abs_start time;
  v_abs_end time;
  v_seg_start time;
  v_seg_end time;
BEGIN
  v_current_date := CURRENT_DATE;
  v_end_date := CURRENT_DATE + INTERVAL '52 weeks';
  
  -- Find first occurrence of this day of week
  WHILE EXTRACT(ISODOW FROM v_current_date) != NEW.jour_semaine LOOP
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
  
  -- Loop through all occurrences of this day of week
  WHILE v_current_date <= v_end_date LOOP
    -- Check for full-day absence
    SELECT COUNT(*) INTO v_abs_full
    FROM public.absences
    WHERE secretaire_id = NEW.secretaire_id
      AND v_current_date BETWEEN date_debut AND date_fin
      AND statut IN ('approuve', 'en_attente')
      AND heure_debut IS NULL AND heure_fin IS NULL;
    
    IF v_abs_full = 0 THEN
      -- Get partial-day absence window
      SELECT MIN(heure_debut), MAX(heure_fin)
      INTO v_abs_start, v_abs_end
      FROM public.absences
      WHERE secretaire_id = NEW.secretaire_id
        AND v_current_date BETWEEN date_debut AND date_fin
        AND statut IN ('approuve', 'en_attente')
        AND heure_debut IS NOT NULL AND heure_fin IS NOT NULL;

      IF v_abs_start IS NULL OR v_abs_end IS NULL THEN
        -- No absence: insert whole slot
        INSERT INTO public.capacite_effective (
          date, secretaire_id, heure_debut, heure_fin
        ) VALUES (
          v_current_date, NEW.secretaire_id,
          NEW.heure_debut, NEW.heure_fin
        )
        ON CONFLICT DO NOTHING;
      ELSE
        -- Segment before absence
        v_seg_start := NEW.heure_debut;
        v_seg_end := LEAST(v_abs_start, NEW.heure_fin);
        IF v_seg_start < v_seg_end AND (v_seg_end - v_seg_start) >= INTERVAL '30 minutes' THEN
          INSERT INTO public.capacite_effective (
            date, secretaire_id, heure_debut, heure_fin
          ) VALUES (
            v_current_date, NEW.secretaire_id,
            v_seg_start, v_seg_end
          )
          ON CONFLICT DO NOTHING;
        END IF;

        -- Segment after absence
        v_seg_start := GREATEST(v_abs_end, NEW.heure_debut);
        v_seg_end := NEW.heure_fin;
        IF v_seg_start < v_seg_end AND (v_seg_end - v_seg_start) >= INTERVAL '30 minutes' THEN
          INSERT INTO public.capacite_effective (
            date, secretaire_id, heure_debut, heure_fin
          ) VALUES (
            v_current_date, NEW.secretaire_id,
            v_seg_start, v_seg_end
          )
          ON CONFLICT DO NOTHING;
        END IF;
      END IF;
    END IF;
    
    v_current_date := v_current_date + INTERVAL '7 days';
  END LOOP;
  
  RETURN NEW;
END;
$function$;

-- Function to handle UPDATE on horaires_base_secretaires
CREATE OR REPLACE FUNCTION public.handle_horaire_secretaire_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_current_date date;
  v_end_date date;
BEGIN
  v_current_date := CURRENT_DATE;
  v_end_date := CURRENT_DATE + INTERVAL '52 weeks';
  
  -- Find first occurrence of this day of week
  WHILE EXTRACT(ISODOW FROM v_current_date) != OLD.jour_semaine LOOP
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
  
  -- Delete all occurrences for this day of week
  WHILE v_current_date <= v_end_date LOOP
    DELETE FROM public.capacite_effective
    WHERE secretaire_id = OLD.secretaire_id
      AND date = v_current_date;
    
    v_current_date := v_current_date + INTERVAL '7 days';
  END LOOP;
  
  -- Recreate using the insert logic
  PERFORM public.handle_horaire_secretaire_insert_logic(NEW);
  
  RETURN NEW;
END;
$function$;

-- Helper function to reuse insert logic
CREATE OR REPLACE FUNCTION public.handle_horaire_secretaire_insert_logic(p_horaire record)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_current_date date;
  v_end_date date;
  v_abs_full integer;
  v_abs_start time;
  v_abs_end time;
  v_seg_start time;
  v_seg_end time;
BEGIN
  v_current_date := CURRENT_DATE;
  v_end_date := CURRENT_DATE + INTERVAL '52 weeks';
  
  WHILE EXTRACT(ISODOW FROM v_current_date) != p_horaire.jour_semaine LOOP
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
  
  WHILE v_current_date <= v_end_date LOOP
    SELECT COUNT(*) INTO v_abs_full
    FROM public.absences
    WHERE secretaire_id = p_horaire.secretaire_id
      AND v_current_date BETWEEN date_debut AND date_fin
      AND statut IN ('approuve', 'en_attente')
      AND heure_debut IS NULL AND heure_fin IS NULL;
    
    IF v_abs_full = 0 THEN
      SELECT MIN(heure_debut), MAX(heure_fin)
      INTO v_abs_start, v_abs_end
      FROM public.absences
      WHERE secretaire_id = p_horaire.secretaire_id
        AND v_current_date BETWEEN date_debut AND date_fin
        AND statut IN ('approuve', 'en_attente')
        AND heure_debut IS NOT NULL AND heure_fin IS NOT NULL;

      IF v_abs_start IS NULL OR v_abs_end IS NULL THEN
        INSERT INTO public.capacite_effective (
          date, secretaire_id, heure_debut, heure_fin
        ) VALUES (
          v_current_date, p_horaire.secretaire_id,
          p_horaire.heure_debut, p_horaire.heure_fin
        )
        ON CONFLICT DO NOTHING;
      ELSE
        v_seg_start := p_horaire.heure_debut;
        v_seg_end := LEAST(v_abs_start, p_horaire.heure_fin);
        IF v_seg_start < v_seg_end AND (v_seg_end - v_seg_start) >= INTERVAL '30 minutes' THEN
          INSERT INTO public.capacite_effective (
            date, secretaire_id, heure_debut, heure_fin
          ) VALUES (
            v_current_date, p_horaire.secretaire_id,
            v_seg_start, v_seg_end
          )
          ON CONFLICT DO NOTHING;
        END IF;

        v_seg_start := GREATEST(v_abs_end, p_horaire.heure_debut);
        v_seg_end := p_horaire.heure_fin;
        IF v_seg_start < v_seg_end AND (v_seg_end - v_seg_start) >= INTERVAL '30 minutes' THEN
          INSERT INTO public.capacite_effective (
            date, secretaire_id, heure_debut, heure_fin
          ) VALUES (
            v_current_date, p_horaire.secretaire_id,
            v_seg_start, v_seg_end
          )
          ON CONFLICT DO NOTHING;
        END IF;
      END IF;
    END IF;
    
    v_current_date := v_current_date + INTERVAL '7 days';
  END LOOP;
END;
$function$;

-- Function to handle DELETE on horaires_base_secretaires
CREATE OR REPLACE FUNCTION public.handle_horaire_secretaire_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_current_date date;
  v_end_date date;
BEGIN
  v_current_date := CURRENT_DATE;
  v_end_date := CURRENT_DATE + INTERVAL '52 weeks';
  
  -- Find first occurrence of this day of week
  WHILE EXTRACT(ISODOW FROM v_current_date) != OLD.jour_semaine LOOP
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
  
  -- Delete all occurrences for this day of week
  WHILE v_current_date <= v_end_date LOOP
    DELETE FROM public.capacite_effective
    WHERE secretaire_id = OLD.secretaire_id
      AND date = v_current_date;
    
    v_current_date := v_current_date + INTERVAL '7 days';
  END LOOP;
  
  RETURN OLD;
END;
$function$;

-- Create triggers
DROP TRIGGER IF EXISTS trigger_horaire_secretaire_insert ON public.horaires_base_secretaires;
CREATE TRIGGER trigger_horaire_secretaire_insert
  AFTER INSERT ON public.horaires_base_secretaires
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_horaire_secretaire_insert();

DROP TRIGGER IF EXISTS trigger_horaire_secretaire_update ON public.horaires_base_secretaires;
CREATE TRIGGER trigger_horaire_secretaire_update
  AFTER UPDATE ON public.horaires_base_secretaires
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_horaire_secretaire_update();

DROP TRIGGER IF EXISTS trigger_horaire_secretaire_delete ON public.horaires_base_secretaires;
CREATE TRIGGER trigger_horaire_secretaire_delete
  AFTER DELETE ON public.horaires_base_secretaires
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_horaire_secretaire_delete();