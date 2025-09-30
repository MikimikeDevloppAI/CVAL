-- 1) Add time columns on absences for partial-day handling
ALTER TABLE public.absences
  ADD COLUMN IF NOT EXISTS heure_debut time without time zone,
  ADD COLUMN IF NOT EXISTS heure_fin time without time zone;

-- 2) Validation trigger to ensure consistent partial/full-day data
CREATE OR REPLACE FUNCTION public.validate_absence_times()
RETURNS trigger AS $$
BEGIN
  -- Enforce person type consistency
  IF NEW.type_personne = 'medecin' THEN
    IF NEW.medecin_id IS NULL THEN
      RAISE EXCEPTION 'medecin_id requis pour type_personne=medecin';
    END IF;
    NEW.secretaire_id := NULL;
  ELSIF NEW.type_personne = 'secretaire' THEN
    IF NEW.secretaire_id IS NULL THEN
      RAISE EXCEPTION 'secretaire_id requis pour type_personne=secretaire';
    END IF;
    NEW.medecin_id := NULL;
  END IF;

  -- Both times should be set together or both NULL
  IF (NEW.heure_debut IS NULL) <> (NEW.heure_fin IS NULL) THEN
    RAISE EXCEPTION 'heure_debut et heure_fin doivent être toutes deux nulles ou toutes deux renseignées';
  END IF;

  -- For partial-day absences, enforce time order and same-day range
  IF NEW.heure_debut IS NOT NULL THEN
    IF NEW.heure_debut >= NEW.heure_fin THEN
      RAISE EXCEPTION 'heure_debut doit être strictement inférieure à heure_fin';
    END IF;
    IF NEW.date_debut <> NEW.date_fin THEN
      RAISE EXCEPTION 'Pour une absence partielle (avec horaires), date_debut doit égaler date_fin';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_validate_absence_times ON public.absences;
CREATE TRIGGER trg_validate_absence_times
BEFORE INSERT OR UPDATE ON public.absences
FOR EACH ROW EXECUTE FUNCTION public.validate_absence_times();

-- 3) Update handle_absence_changes to regenerate only affected dates
CREATE OR REPLACE FUNCTION public.handle_absence_changes()
RETURNS trigger AS $function$
DECLARE
  v_start_date date := NEW.date_debut;
  v_end_date date := NEW.date_fin;
  v_current_date date;
BEGIN
  IF NEW.type_personne = 'medecin' THEN
    v_current_date := v_start_date;
    WHILE v_current_date <= v_end_date LOOP
      DELETE FROM public.besoin_effectif
      WHERE medecin_id = COALESCE(NEW.medecin_id, OLD.medecin_id)
        AND date = v_current_date;
      v_current_date := v_current_date + INTERVAL '1 day';
    END LOOP;
    PERFORM public.generate_besoin_effectif();
  ELSIF NEW.type_personne = 'secretaire' THEN
    v_current_date := v_start_date;
    WHILE v_current_date <= v_end_date LOOP
      DELETE FROM public.capacite_effective
      WHERE secretaire_id = COALESCE(NEW.secretaire_id, OLD.secretaire_id)
        AND date = v_current_date;
      v_current_date := v_current_date + INTERVAL '1 day';
    END LOOP;
    PERFORM public.generate_capacite_effective();
  END IF;
  RETURN NEW;
END;
$function$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS tr_absences_after_change ON public.absences;
CREATE TRIGGER tr_absences_after_change
AFTER INSERT OR UPDATE ON public.absences
FOR EACH ROW EXECUTE FUNCTION public.handle_absence_changes();

-- 4) Make generation functions time-aware for partial-day absences
CREATE OR REPLACE FUNCTION public.generate_besoin_effectif()
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
  v_medecin RECORD;
  v_horaire RECORD;
  v_bloc RECORD;
  v_abs_full INTEGER;
  v_abs_start TIME;
  v_abs_end TIME;
  v_semaines_diff INTEGER;
  v_should_work BOOLEAN;
  v_seg_start TIME;
  v_seg_end TIME;
BEGIN
  -- Clean old data (older than 8 weeks)
  DELETE FROM public.besoin_effectif WHERE date < CURRENT_DATE - INTERVAL '8 weeks';

  v_current_date := v_start_date;
  
  WHILE v_current_date <= v_end_date LOOP
    v_jour_semaine := EXTRACT(ISODOW FROM v_current_date);
    
    -- Generate for all active doctors
    FOR v_medecin IN
      SELECT id, specialite_id, besoin_secretaires FROM public.medecins WHERE actif = true
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
          -- Check for full-day absence
          SELECT COUNT(*) INTO v_abs_full
          FROM public.absences
          WHERE medecin_id = v_medecin.id
            AND v_current_date BETWEEN date_debut AND date_fin
            AND statut IN ('approuve', 'en_attente')
            AND (heure_debut IS NULL OR heure_fin IS NULL);
          
          IF v_abs_full = 0 THEN
            -- Get partial-day absence window if any (union window min/max)
            SELECT MIN(heure_debut), MAX(heure_fin)
              INTO v_abs_start, v_abs_end
            FROM public.absences
            WHERE medecin_id = v_medecin.id
              AND v_current_date BETWEEN date_debut AND date_fin
              AND statut IN ('approuve', 'en_attente')
              AND heure_debut IS NOT NULL AND heure_fin IS NOT NULL;

            IF v_abs_start IS NULL OR v_abs_end IS NULL THEN
              -- No partial absence: insert whole slot
              INSERT INTO public.besoin_effectif (
                date, type, medecin_id, site_id, specialite_id,
                heure_debut, heure_fin, nombre_secretaires_requis
              ) VALUES (
                v_current_date, 'medecin', v_medecin.id, v_horaire.site_id, v_medecin.specialite_id,
                v_horaire.heure_debut, v_horaire.heure_fin, v_medecin.besoin_secretaires
              )
              ON CONFLICT DO NOTHING;
            ELSE
              -- Segment before absence
              v_seg_start := v_horaire.heure_debut;
              v_seg_end := LEAST(v_abs_start, v_horaire.heure_fin);
              IF v_seg_start < v_seg_end THEN
                INSERT INTO public.besoin_effectif (
                  date, type, medecin_id, site_id, specialite_id,
                  heure_debut, heure_fin, nombre_secretaires_requis
                ) VALUES (
                  v_current_date, 'medecin', v_medecin.id, v_horaire.site_id, v_medecin.specialite_id,
                  v_seg_start, v_seg_end, v_medecin.besoin_secretaires
                )
                ON CONFLICT DO NOTHING;
              END IF;

              -- Segment after absence
              v_seg_start := GREATEST(v_abs_end, v_horaire.heure_debut);
              v_seg_end := v_horaire.heure_fin;
              IF v_seg_start < v_seg_end THEN
                INSERT INTO public.besoin_effectif (
                  date, type, medecin_id, site_id, specialite_id,
                  heure_debut, heure_fin, nombre_secretaires_requis
                ) VALUES (
                  v_current_date, 'medecin', v_medecin.id, v_horaire.site_id, v_medecin.specialite_id,
                  v_seg_start, v_seg_end, v_medecin.besoin_secretaires
                )
                ON CONFLICT DO NOTHING;
              END IF;
            END IF;
          END IF;
        END IF;
      END LOOP;
    END LOOP;
    
    -- Generate for bloc operatoire (unchanged)
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
$function$;

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
      LOOP
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
              COALESCE(v_secretaire.site_preferentiel_id, (SELECT id FROM public.sites WHERE actif = true LIMIT 1)),
              v_horaire.heure_debut, v_horaire.heure_fin, v_secretaire.specialites
            )
            ON CONFLICT DO NOTHING;
          ELSE
            -- Segment before absence
            v_seg_start := v_horaire.heure_debut;
            v_seg_end := LEAST(v_abs_start, v_horaire.heure_fin);
            IF v_seg_start < v_seg_end THEN
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
            IF v_seg_start < v_seg_end THEN
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
    END LOOP;
    
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
END;
$function$;