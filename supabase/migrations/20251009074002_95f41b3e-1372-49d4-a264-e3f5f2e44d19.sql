-- Drop all old validation functions and triggers with CASCADE
DROP FUNCTION IF EXISTS public.check_besoin_effectif_overlap() CASCADE;
DROP FUNCTION IF EXISTS public.check_capacite_effective_overlap() CASCADE;
DROP FUNCTION IF EXISTS public.check_horaire_overlap(text,uuid,integer,time without time zone,time without time zone,type_alternance,date,date,date,uuid) CASCADE;
DROP FUNCTION IF EXISTS public.validate_horaire_medecin_overlap() CASCADE;
DROP FUNCTION IF EXISTS public.validate_horaire_secretaire_overlap() CASCADE;
DROP FUNCTION IF EXISTS public.date_ranges_overlap(date,date,date,date) CASCADE;

-- Create enum type for demi_journee
CREATE TYPE demi_journee AS ENUM ('matin', 'apres_midi', 'toute_journee');

-- Add demi_journee column to horaires_base_medecins
ALTER TABLE public.horaires_base_medecins 
ADD COLUMN demi_journee demi_journee;

-- Migrate existing data for horaires_base_medecins
UPDATE public.horaires_base_medecins
SET demi_journee = CASE
  WHEN heure_debut >= '13:00:00'::time THEN 'apres_midi'::demi_journee
  WHEN heure_fin <= '12:00:00'::time THEN 'matin'::demi_journee
  ELSE 'toute_journee'::demi_journee
END;

ALTER TABLE public.horaires_base_medecins 
ALTER COLUMN demi_journee SET NOT NULL;

ALTER TABLE public.horaires_base_medecins 
DROP COLUMN heure_debut,
DROP COLUMN heure_fin;

-- Add demi_journee column to horaires_base_secretaires
ALTER TABLE public.horaires_base_secretaires 
ADD COLUMN demi_journee demi_journee;

UPDATE public.horaires_base_secretaires
SET demi_journee = CASE
  WHEN heure_debut >= '13:00:00'::time THEN 'apres_midi'::demi_journee
  WHEN heure_fin <= '12:00:00'::time THEN 'matin'::demi_journee
  ELSE 'toute_journee'::demi_journee
END;

ALTER TABLE public.horaires_base_secretaires 
ALTER COLUMN demi_journee SET NOT NULL;

ALTER TABLE public.horaires_base_secretaires 
DROP COLUMN heure_debut,
DROP COLUMN heure_fin;

-- Add demi_journee column to besoin_effectif
ALTER TABLE public.besoin_effectif 
ADD COLUMN demi_journee demi_journee;

UPDATE public.besoin_effectif
SET demi_journee = CASE
  WHEN heure_debut >= '13:00:00'::time THEN 'apres_midi'::demi_journee
  WHEN heure_fin <= '12:00:00'::time THEN 'matin'::demi_journee
  ELSE 'toute_journee'::demi_journee
END;

ALTER TABLE public.besoin_effectif 
ALTER COLUMN demi_journee SET NOT NULL;

ALTER TABLE public.besoin_effectif 
DROP COLUMN heure_debut,
DROP COLUMN heure_fin;

-- Add demi_journee column to capacite_effective
ALTER TABLE public.capacite_effective 
ADD COLUMN demi_journee demi_journee;

UPDATE public.capacite_effective
SET demi_journee = CASE
  WHEN heure_debut >= '13:00:00'::time THEN 'apres_midi'::demi_journee
  WHEN heure_fin <= '12:00:00'::time THEN 'matin'::demi_journee
  ELSE 'toute_journee'::demi_journee
END;

ALTER TABLE public.capacite_effective 
ALTER COLUMN demi_journee SET NOT NULL;

ALTER TABLE public.capacite_effective 
DROP COLUMN heure_debut,
DROP COLUMN heure_fin;

-- Recreate all functions for the new schema
CREATE OR REPLACE FUNCTION public.handle_horaire_medecin_insert_logic(p_horaire record)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_current_date DATE;
  v_start_date DATE;
  v_end_date DATE;
  v_semaines_diff INTEGER;
  v_should_work BOOLEAN;
  v_abs_full INTEGER;
  v_has_partial_absence BOOLEAN;
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
        SELECT EXISTS(
          SELECT 1 FROM public.absences
          WHERE medecin_id = p_horaire.medecin_id
            AND v_current_date BETWEEN date_debut AND date_fin
            AND statut IN ('approuve', 'en_attente')
            AND heure_debut IS NOT NULL AND heure_fin IS NOT NULL
        ) INTO v_has_partial_absence;

        IF NOT v_has_partial_absence THEN
          INSERT INTO public.besoin_effectif (
            date, type, medecin_id, site_id, demi_journee
          ) VALUES (
            v_current_date, 'medecin', p_horaire.medecin_id, p_horaire.site_id, p_horaire.demi_journee
          )
          ON CONFLICT DO NOTHING;
        END IF;
      END IF;
    END IF;
    
    v_current_date := v_current_date + INTERVAL '7 days';
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_horaire_medecin_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.handle_horaire_medecin_insert_logic(NEW);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_horaire_medecin_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_current_date DATE;
  v_old_start DATE;
  v_old_end DATE;
  v_new_start DATE;
  v_new_end DATE;
BEGIN
  v_old_start := COALESCE(OLD.date_debut, CURRENT_DATE);
  v_old_end := COALESCE(OLD.date_fin, CURRENT_DATE + INTERVAL '52 weeks');
  v_new_start := COALESCE(NEW.date_debut, CURRENT_DATE);
  v_new_end := COALESCE(NEW.date_fin, CURRENT_DATE + INTERVAL '52 weeks');
  
  IF v_old_start < CURRENT_DATE THEN
    v_old_start := CURRENT_DATE;
  END IF;
  IF v_new_start < CURRENT_DATE THEN
    v_new_start := CURRENT_DATE;
  END IF;
  
  IF v_new_start > v_old_start THEN
    DELETE FROM public.besoin_effectif
    WHERE medecin_id = OLD.medecin_id
      AND date >= v_old_start
      AND date < v_new_start;
  END IF;
  
  IF v_new_end < v_old_end THEN
    DELETE FROM public.besoin_effectif
    WHERE medecin_id = OLD.medecin_id
      AND date > v_new_end
      AND date <= v_old_end;
  END IF;
  
  v_current_date := v_new_start;
  WHILE EXTRACT(ISODOW FROM v_current_date) != OLD.jour_semaine LOOP
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
  
  WHILE v_current_date <= v_new_end LOOP
    DELETE FROM public.besoin_effectif
    WHERE medecin_id = OLD.medecin_id
      AND date = v_current_date;
    v_current_date := v_current_date + INTERVAL '7 days';
  END LOOP;
  
  PERFORM public.handle_horaire_medecin_insert_logic(NEW);
  
  RETURN NEW;
END;
$function$;

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
  
  WHILE EXTRACT(ISODOW FROM v_current_date) != OLD.jour_semaine LOOP
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
  
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
        INSERT INTO public.capacite_effective (
          date, secretaire_id, demi_journee
        ) VALUES (
          v_current_date, p_horaire.secretaire_id, p_horaire.demi_journee
        )
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;
    
    v_current_date := v_current_date + INTERVAL '7 days';
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_horaire_secretaire_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.handle_horaire_secretaire_insert_logic(NEW);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_horaire_secretaire_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_current_date DATE;
  v_old_start DATE;
  v_old_end DATE;
  v_new_start DATE;
  v_new_end DATE;
BEGIN
  v_old_start := COALESCE(OLD.date_debut, CURRENT_DATE);
  v_old_end := COALESCE(OLD.date_fin, CURRENT_DATE + INTERVAL '52 weeks');
  v_new_start := COALESCE(NEW.date_debut, CURRENT_DATE);
  v_new_end := COALESCE(NEW.date_fin, CURRENT_DATE + INTERVAL '52 weeks');
  
  IF v_old_start < CURRENT_DATE THEN
    v_old_start := CURRENT_DATE;
  END IF;
  IF v_new_start < CURRENT_DATE THEN
    v_new_start := CURRENT_DATE;
  END IF;
  
  IF v_new_start > v_old_start THEN
    DELETE FROM public.capacite_effective
    WHERE secretaire_id = OLD.secretaire_id
      AND date >= v_old_start
      AND date < v_new_start;
  END IF;
  
  IF v_new_end < v_old_end THEN
    DELETE FROM public.capacite_effective
    WHERE secretaire_id = OLD.secretaire_id
      AND date > v_new_end
      AND date <= v_old_end;
  END IF;
  
  v_current_date := v_new_start;
  WHILE EXTRACT(ISODOW FROM v_current_date) != OLD.jour_semaine LOOP
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
  
  WHILE v_current_date <= v_new_end LOOP
    DELETE FROM public.capacite_effective
    WHERE secretaire_id = OLD.secretaire_id
      AND date = v_current_date;
    v_current_date := v_current_date + INTERVAL '7 days';
  END LOOP;
  
  PERFORM public.handle_horaire_secretaire_insert_logic(NEW);
  
  RETURN NEW;
END;
$function$;

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
  
  WHILE EXTRACT(ISODOW FROM v_current_date) != OLD.jour_semaine LOOP
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
  
  WHILE v_current_date <= v_end_date LOOP
    DELETE FROM public.capacite_effective
    WHERE secretaire_id = OLD.secretaire_id
      AND date = v_current_date;
    
    v_current_date := v_current_date + INTERVAL '7 days';
  END LOOP;
  
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_besoin_from_bloc(p_bloc_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_bloc RECORD;
  v_bloc_site_id UUID;
BEGIN
  SELECT id INTO v_bloc_site_id FROM public.sites WHERE nom = 'Clinique La Vallée - Bloc opératoire' LIMIT 1;

  SELECT * INTO v_bloc
  FROM public.bloc_operatoire_besoins
  WHERE id = p_bloc_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  INSERT INTO public.besoin_effectif (
    date,
    type,
    bloc_operatoire_besoin_id,
    site_id,
    demi_journee
  )
  VALUES (
    v_bloc.date,
    'bloc_operatoire',
    v_bloc.id,
    v_bloc_site_id,
    'toute_journee'::demi_journee
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.weekly_planning_maintenance()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_delete_week_start DATE := CURRENT_DATE - INTERVAL '52 weeks';
  v_delete_week_end DATE := v_delete_week_start + INTERVAL '6 days';
  v_new_week_start DATE := CURRENT_DATE + INTERVAL '52 weeks';
  v_new_week_end DATE := v_new_week_start + INTERVAL '6 days';
  v_current_date DATE;
  v_jour_semaine INTEGER;
  v_medecin RECORD;
  v_horaire RECORD;
  v_secretaire RECORD;
  v_abs_full INTEGER;
  v_semaines_diff INTEGER;
  v_should_work BOOLEAN;
  v_has_partial_absence BOOLEAN;
  v_bloc RECORD;
  v_bloc_site_id UUID;
BEGIN
  SELECT id INTO v_bloc_site_id FROM public.sites WHERE nom = 'Clinique La Vallée - Bloc opératoire' LIMIT 1;

  DELETE FROM public.besoin_effectif 
  WHERE date >= v_delete_week_start AND date <= v_delete_week_end;
  
  DELETE FROM public.capacite_effective 
  WHERE date >= v_delete_week_start AND date <= v_delete_week_end;

  v_current_date := v_new_week_start;
  
  WHILE v_current_date <= v_new_week_end LOOP
    v_jour_semaine := EXTRACT(ISODOW FROM v_current_date);
    
    FOR v_medecin IN
      SELECT id FROM public.medecins WHERE actif = true
    LOOP
      FOR v_horaire IN
        SELECT * FROM public.horaires_base_medecins
        WHERE medecin_id = v_medecin.id
          AND jour_semaine = v_jour_semaine
          AND actif = true
          AND (date_debut IS NULL OR date_debut <= v_current_date)
          AND (date_fin IS NULL OR date_fin >= v_current_date)
      LOOP
        v_semaines_diff := FLOOR((v_current_date - v_horaire.alternance_semaine_reference) / 7);
        
        v_should_work := CASE v_horaire.alternance_type
          WHEN 'hebdomadaire' THEN true
          WHEN 'une_sur_deux' THEN (v_semaines_diff % 2 = 0)
          WHEN 'une_sur_trois' THEN (v_semaines_diff % 3 = 0)
          WHEN 'une_sur_quatre' THEN (v_semaines_diff % 4 = 0)
          ELSE true
        END;
        
        IF v_should_work THEN
          SELECT COUNT(*) INTO v_abs_full
          FROM public.absences
          WHERE medecin_id = v_medecin.id
            AND v_current_date BETWEEN date_debut AND date_fin
            AND statut IN ('approuve', 'en_attente')
            AND heure_debut IS NULL AND heure_fin IS NULL;
          
          IF v_abs_full = 0 THEN
            SELECT EXISTS(
              SELECT 1 FROM public.absences
              WHERE medecin_id = v_medecin.id
                AND v_current_date BETWEEN date_debut AND date_fin
                AND statut IN ('approuve', 'en_attente')
                AND heure_debut IS NOT NULL AND heure_fin IS NOT NULL
            ) INTO v_has_partial_absence;

            IF NOT v_has_partial_absence THEN
              INSERT INTO public.besoin_effectif (
                date, type, medecin_id, site_id, demi_journee
              ) VALUES (
                v_current_date, 'medecin', v_medecin.id, v_horaire.site_id, v_horaire.demi_journee
              )
              ON CONFLICT DO NOTHING;
            END IF;
          END IF;
        END IF;
      END LOOP;
    END LOOP;
    
    FOR v_bloc IN
      SELECT * FROM public.bloc_operatoire_besoins
      WHERE date = v_current_date AND actif = true
    LOOP
      INSERT INTO public.besoin_effectif (
        date, type, bloc_operatoire_besoin_id, site_id, demi_journee
      ) VALUES (
        v_bloc.date, 'bloc_operatoire', v_bloc.id, v_bloc_site_id, 'toute_journee'::demi_journee
      )
      ON CONFLICT DO NOTHING;
    END LOOP;
    
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;

  v_current_date := v_new_week_start;
  
  WHILE v_current_date <= v_new_week_end LOOP
    v_jour_semaine := EXTRACT(ISODOW FROM v_current_date);
    
    FOR v_secretaire IN
      SELECT id FROM public.secretaires WHERE actif = true
    LOOP
      FOR v_horaire IN
        SELECT * FROM public.horaires_base_secretaires
        WHERE secretaire_id = v_secretaire.id
          AND jour_semaine = v_jour_semaine
          AND actif = true
          AND (date_debut IS NULL OR date_debut <= v_current_date)
          AND (date_fin IS NULL OR date_fin >= v_current_date)
      LOOP
        SELECT COUNT(*) INTO v_abs_full
        FROM public.absences
        WHERE secretaire_id = v_secretaire.id
          AND v_current_date BETWEEN date_debut AND date_fin
          AND statut IN ('approuve', 'en_attente')
          AND heure_debut IS NULL AND heure_fin IS NULL;
        
        IF v_abs_full = 0 THEN
          SELECT EXISTS(
            SELECT 1 FROM public.absences
            WHERE secretaire_id = v_secretaire.id
              AND v_current_date BETWEEN date_debut AND date_fin
              AND statut IN ('approuve', 'en_attente')
              AND heure_debut IS NOT NULL AND heure_fin IS NOT NULL
          ) INTO v_has_partial_absence;

          IF NOT v_has_partial_absence THEN
            INSERT INTO public.capacite_effective (
              date, secretaire_id, demi_journee
            ) VALUES (
              v_current_date, v_secretaire.id, v_horaire.demi_journee
            )
            ON CONFLICT DO NOTHING;
          END IF;
        END IF;
      END LOOP;
    END LOOP;
    
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
  
  RAISE NOTICE 'Weekly planning maintenance completed: deleted week % and generated week %', 
    v_delete_week_start, v_new_week_start;
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
  v_end_date DATE := CURRENT_DATE + INTERVAL '52 weeks';
  v_current_date DATE;
  v_jour_semaine INTEGER;
  v_secretaire RECORD;
  v_horaire RECORD;
  v_abs_full INTEGER;
  v_has_partial_absence BOOLEAN;
BEGIN
  DELETE FROM public.capacite_effective 
  WHERE date >= v_start_date AND date <= v_end_date;

  DELETE FROM public.capacite_effective WHERE date < CURRENT_DATE;

  v_current_date := v_start_date;
  
  WHILE v_current_date <= v_end_date LOOP
    v_jour_semaine := EXTRACT(ISODOW FROM v_current_date);
    
    FOR v_secretaire IN
      SELECT id FROM public.secretaires WHERE actif = true
    LOOP
      FOR v_horaire IN
        SELECT * FROM public.horaires_base_secretaires
        WHERE secretaire_id = v_secretaire.id
          AND jour_semaine = v_jour_semaine
          AND actif = true
      LOOP
        SELECT COUNT(*) INTO v_abs_full
        FROM public.absences
        WHERE secretaire_id = v_secretaire.id
          AND v_current_date BETWEEN date_debut AND date_fin
          AND statut IN ('approuve', 'en_attente')
          AND heure_debut IS NULL AND heure_fin IS NULL;
        
        IF v_abs_full = 0 THEN
          SELECT EXISTS(
            SELECT 1 FROM public.absences
            WHERE secretaire_id = v_secretaire.id
              AND v_current_date BETWEEN date_debut AND date_fin
              AND statut IN ('approuve', 'en_attente')
              AND heure_debut IS NOT NULL AND heure_fin IS NOT NULL
          ) INTO v_has_partial_absence;

          IF NOT v_has_partial_absence THEN
            INSERT INTO public.capacite_effective (
              date, secretaire_id, demi_journee
            ) VALUES (
              v_current_date, v_secretaire.id, v_horaire.demi_journee
            )
            ON CONFLICT DO NOTHING;
          END IF;
        END IF;
      END LOOP;
    END LOOP;
    
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
END;
$function$;