-- Drop ALL possible triggers on absences table
DROP TRIGGER IF EXISTS on_absence_change ON public.absences CASCADE;
DROP TRIGGER IF EXISTS tr_absences_after_change ON public.absences CASCADE;
DROP TRIGGER IF EXISTS tr_absences_after_delete ON public.absences CASCADE;
DROP TRIGGER IF EXISTS after_absence_insert ON public.absences CASCADE;
DROP TRIGGER IF EXISTS after_absence_update ON public.absences CASCADE;
DROP TRIGGER IF EXISTS after_absence_delete ON public.absences CASCADE;

-- Now safely drop the functions
DROP FUNCTION IF EXISTS public.handle_absence_changes() CASCADE;
DROP FUNCTION IF EXISTS public.handle_absence_deletion() CASCADE;

-- Function to check if a doctor should work on a specific date based on alternance
CREATE OR REPLACE FUNCTION public.should_doctor_work(
  p_alternance_type type_alternance,
  p_alternance_reference date,
  p_target_date date
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  v_weeks_diff integer;
BEGIN
  v_weeks_diff := FLOOR((p_target_date - p_alternance_reference) / 7);
  
  RETURN CASE p_alternance_type
    WHEN 'hebdomadaire' THEN true
    WHEN 'une_sur_deux' THEN (v_weeks_diff % 2 = 0)
    WHEN 'une_sur_trois' THEN (v_weeks_diff % 3 = 0)
    WHEN 'une_sur_quatre' THEN (v_weeks_diff % 4 = 0)
    ELSE true
  END;
END;
$function$;

-- Function to recreate besoin_effectif for a doctor on specific dates
CREATE OR REPLACE FUNCTION public.recreate_doctor_besoin(
  p_medecin_id uuid,
  p_date_debut date,
  p_date_fin date
)
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
BEGIN
  -- Get doctor info
  SELECT id, specialite_id, besoin_secretaires 
  INTO v_medecin
  FROM public.medecins 
  WHERE id = p_medecin_id AND actif = true;
  
  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_current_date := p_date_debut;
  
  WHILE v_current_date <= p_date_fin LOOP
    v_jour_semaine := EXTRACT(ISODOW FROM v_current_date);
    
    -- Process each base schedule for this day
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
            -- No absence: insert whole slot
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

-- Function to recreate capacite_effective for a secretary on specific dates
CREATE OR REPLACE FUNCTION public.recreate_secretary_capacite(
  p_secretaire_id uuid,
  p_date_debut date,
  p_date_fin date
)
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
BEGIN
  -- Get secretary info
  SELECT id, specialites, site_preferentiel_id 
  INTO v_secretaire
  FROM public.secretaires 
  WHERE id = p_secretaire_id AND actif = true;
  
  IF NOT FOUND THEN
    RETURN;
  END IF;

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
          -- No absence: insert whole slot
          INSERT INTO public.capacite_effective (
            date, secretaire_id, site_id, heure_debut, heure_fin, specialites
          ) VALUES (
            v_current_date, v_secretaire.id,
            COALESCE(v_secretaire.site_preferentiel_id, (SELECT id FROM public.sites WHERE actif = true LIMIT 1)),
            v_horaire.heure_debut, v_horaire.heure_fin, v_secretaire.specialites
          )
          ON CONFLICT DO NOTHING;
        ELSE
          -- Segment before absence
          v_seg_start := v_horaire.heure_debut;
          v_seg_end := LEAST(v_abs_start, v_horaire.heure_fin);
          IF v_seg_start < v_seg_end AND (v_seg_end - v_seg_start) >= INTERVAL '30 minutes' THEN
            INSERT INTO public.capacite_effective (
              date, secretaire_id, site_id, heure_debut, heure_fin, specialites
            ) VALUES (
              v_current_date, v_secretaire.id,
              COALESCE(v_secretaire.site_preferentiel_id, (SELECT id FROM public.sites WHERE actif = true LIMIT 1)),
              v_seg_start, v_seg_end, v_secretaire.specialites
            )
            ON CONFLICT DO NOTHING;
          END IF;

          -- Segment after absence
          v_seg_start := GREATEST(v_abs_end, v_horaire.heure_debut);
          v_seg_end := v_horaire.heure_fin;
          IF v_seg_start < v_seg_end AND (v_seg_end - v_seg_start) >= INTERVAL '30 minutes' THEN
            INSERT INTO public.capacite_effective (
              date, secretaire_id, site_id, heure_debut, heure_fin, specialites
            ) VALUES (
              v_current_date, v_secretaire.id,
              COALESCE(v_secretaire.site_preferentiel_id, (SELECT id FROM public.sites WHERE actif = true LIMIT 1)),
              v_seg_start, v_seg_end, v_secretaire.specialites
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

-- Main function to handle absence creation
CREATE OR REPLACE FUNCTION public.handle_absence_creation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_current_date date;
BEGIN
  IF NEW.type_personne = 'medecin' THEN
    v_current_date := NEW.date_debut;
    WHILE v_current_date <= NEW.date_fin LOOP
      DELETE FROM public.besoin_effectif
      WHERE medecin_id = NEW.medecin_id AND date = v_current_date;
      v_current_date := v_current_date + INTERVAL '1 day';
    END LOOP;
    PERFORM public.recreate_doctor_besoin(NEW.medecin_id, NEW.date_debut, NEW.date_fin);
  ELSIF NEW.type_personne = 'secretaire' THEN
    v_current_date := NEW.date_debut;
    WHILE v_current_date <= NEW.date_fin LOOP
      DELETE FROM public.capacite_effective
      WHERE secretaire_id = NEW.secretaire_id AND date = v_current_date;
      v_current_date := v_current_date + INTERVAL '1 day';
    END LOOP;
    PERFORM public.recreate_secretary_capacite(NEW.secretaire_id, NEW.date_debut, NEW.date_fin);
  END IF;
  RETURN NEW;
END;
$function$;

-- Function to handle absence modification
CREATE OR REPLACE FUNCTION public.handle_absence_modification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_current_date date;
  v_min_date date;
  v_max_date date;
BEGIN
  v_min_date := LEAST(OLD.date_debut, NEW.date_debut);
  v_max_date := GREATEST(OLD.date_fin, NEW.date_fin);
  
  IF NEW.type_personne = 'medecin' THEN
    v_current_date := v_min_date;
    WHILE v_current_date <= v_max_date LOOP
      DELETE FROM public.besoin_effectif
      WHERE medecin_id = COALESCE(NEW.medecin_id, OLD.medecin_id) AND date = v_current_date;
      v_current_date := v_current_date + INTERVAL '1 day';
    END LOOP;
    PERFORM public.recreate_doctor_besoin(COALESCE(NEW.medecin_id, OLD.medecin_id), v_min_date, v_max_date);
  ELSIF NEW.type_personne = 'secretaire' THEN
    v_current_date := v_min_date;
    WHILE v_current_date <= v_max_date LOOP
      DELETE FROM public.capacite_effective
      WHERE secretaire_id = COALESCE(NEW.secretaire_id, OLD.secretaire_id) AND date = v_current_date;
      v_current_date := v_current_date + INTERVAL '1 day';
    END LOOP;
    PERFORM public.recreate_secretary_capacite(COALESCE(NEW.secretaire_id, OLD.secretaire_id), v_min_date, v_max_date);
  END IF;
  RETURN NEW;
END;
$function$;

-- Function to handle absence deletion
CREATE OR REPLACE FUNCTION public.handle_absence_deletion_new()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_current_date date;
BEGIN
  IF OLD.type_personne = 'medecin' THEN
    v_current_date := OLD.date_debut;
    WHILE v_current_date <= OLD.date_fin LOOP
      DELETE FROM public.besoin_effectif WHERE medecin_id = OLD.medecin_id AND date = v_current_date;
      v_current_date := v_current_date + INTERVAL '1 day';
    END LOOP;
    PERFORM public.recreate_doctor_besoin(OLD.medecin_id, OLD.date_debut, OLD.date_fin);
  ELSIF OLD.type_personne = 'secretaire' THEN
    v_current_date := OLD.date_debut;
    WHILE v_current_date <= OLD.date_fin LOOP
      DELETE FROM public.capacite_effective WHERE secretaire_id = OLD.secretaire_id AND date = v_current_date;
      v_current_date := v_current_date + INTERVAL '1 day';
    END LOOP;
    PERFORM public.recreate_secretary_capacite(OLD.secretaire_id, OLD.date_debut, OLD.date_fin);
  END IF;
  RETURN OLD;
END;
$function$;

-- Create new triggers
CREATE TRIGGER after_absence_insert
  AFTER INSERT ON public.absences
  FOR EACH ROW EXECUTE FUNCTION public.handle_absence_creation();

CREATE TRIGGER after_absence_update
  AFTER UPDATE ON public.absences
  FOR EACH ROW EXECUTE FUNCTION public.handle_absence_modification();

CREATE TRIGGER after_absence_delete
  AFTER DELETE ON public.absences
  FOR EACH ROW EXECUTE FUNCTION public.handle_absence_deletion_new();