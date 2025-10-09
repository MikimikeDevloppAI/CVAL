-- Add site_id to capacite_effective to support site assignment per day
ALTER TABLE public.capacite_effective
ADD COLUMN IF NOT EXISTS site_id uuid NULL REFERENCES public.sites(id) ON DELETE SET NULL;

-- Index for better filtering performance
CREATE INDEX IF NOT EXISTS idx_capacite_effective_site_id
  ON public.capacite_effective(site_id);

-- Update function to insert horaires with site_id
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
    -- Check if it's a public holiday
    SELECT EXISTS(
      SELECT 1 FROM public.jours_feries
      WHERE date = v_current_date AND actif = true
    ) INTO v_is_holiday;
    
    -- Only create capacite if not a holiday
    IF NOT v_is_holiday THEN
      -- Check for full-day absence
      SELECT COUNT(*) INTO v_abs_full
      FROM public.absences
      WHERE secretaire_id = p_horaire.secretaire_id
        AND v_current_date BETWEEN date_debut AND date_fin
        AND statut IN ('approuve', 'en_attente')
        AND heure_debut IS NULL AND heure_fin IS NULL;
      
      IF v_abs_full = 0 THEN
        -- Check for partial absence
        SELECT EXISTS(
          SELECT 1 FROM public.absences
          WHERE secretaire_id = p_horaire.secretaire_id
            AND v_current_date BETWEEN date_debut AND date_fin
            AND statut IN ('approuve', 'en_attente')
            AND heure_debut IS NOT NULL AND heure_fin IS NOT NULL
        ) INTO v_has_partial_absence;

        IF NOT v_has_partial_absence THEN
          INSERT INTO public.capacite_effective (
            date, secretaire_id, demi_journee, site_id
          ) VALUES (
            v_current_date, p_horaire.secretaire_id, p_horaire.demi_journee, p_horaire.site_id
          )
          ON CONFLICT DO NOTHING;
        END IF;
      END IF;
    END IF;
    
    v_current_date := v_current_date + INTERVAL '7 days';
  END LOOP;
END;
$function$;

-- Update function to recreate secretary capacities with site_id
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
    
    -- Check if it's a public holiday
    SELECT EXISTS(
      SELECT 1 FROM public.jours_feries
      WHERE date = v_current_date AND actif = true
    ) INTO v_is_holiday;
    
    -- Skip if it's a holiday
    IF NOT v_is_holiday THEN
      FOR v_horaire IN
        SELECT * FROM public.horaires_base_secretaires
        WHERE secretaire_id = p_secretaire_id
          AND jour_semaine = v_jour_semaine
          AND actif = true
      LOOP
        SELECT COUNT(*) INTO v_abs_full
        FROM public.absences
        WHERE secretaire_id = p_secretaire_id
          AND v_current_date BETWEEN date_debut AND date_fin
          AND statut IN ('approuve', 'en_attente')
          AND heure_debut IS NULL AND heure_fin IS NULL;
        
        IF v_abs_full = 0 THEN
          INSERT INTO public.capacite_effective (
            date, secretaire_id, demi_journee, site_id
          ) VALUES (
            v_current_date, v_secretaire.id, v_horaire.demi_journee, v_horaire.site_id
          )
          ON CONFLICT DO NOTHING;
        END IF;
      END LOOP;
    END IF;
    
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
END;
$function$;

-- Update horaire secretaire update trigger to handle site_id properly
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
      AND demi_journee = OLD.demi_journee
      AND date >= v_old_start
      AND date < v_new_start;
  END IF;
  
  IF v_new_end < v_old_end THEN
    DELETE FROM public.capacite_effective
    WHERE secretaire_id = OLD.secretaire_id
      AND demi_journee = OLD.demi_journee
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
      AND demi_journee = OLD.demi_journee
      AND date = v_current_date;
    v_current_date := v_current_date + INTERVAL '7 days';
  END LOOP;
  
  PERFORM public.handle_horaire_secretaire_insert_logic(NEW);
  
  RETURN NEW;
END;
$function$;

-- Update generate_capacite_effective to include site_id
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
              date, secretaire_id, demi_journee, site_id
            ) VALUES (
              v_current_date, v_secretaire.id, v_horaire.demi_journee, v_horaire.site_id
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