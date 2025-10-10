-- Add alternance fields to horaires_base_secretaires
ALTER TABLE public.horaires_base_secretaires
ADD COLUMN IF NOT EXISTS alternance_type type_alternance DEFAULT 'hebdomadaire',
ADD COLUMN IF NOT EXISTS alternance_semaine_reference date DEFAULT CURRENT_DATE;

-- Add constraint to prevent duplicate schedules for same secretary/day/period
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_horaire_secretaire 
ON public.horaires_base_secretaires(secretaire_id, jour_semaine, demi_journee, site_id)
WHERE actif = true;

-- Create function to check for overlapping schedules in horaires_base_secretaires
CREATE OR REPLACE FUNCTION public.check_horaire_secretaire_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_overlap_count INTEGER;
  v_existing_horaire TEXT;
BEGIN
  -- Check for overlapping schedules for the same secretary on the same day
  SELECT COUNT(*), MAX(
    CASE demi_journee
      WHEN 'toute_journee' THEN 'Journée complète'
      WHEN 'matin' THEN 'Matin'
      WHEN 'apres_midi' THEN 'Après-midi'
    END || 
    COALESCE(' - ' || (SELECT nom FROM public.sites WHERE id = site_id), '')
  )
  INTO v_overlap_count, v_existing_horaire
  FROM public.horaires_base_secretaires
  WHERE secretaire_id = NEW.secretaire_id
    AND jour_semaine = NEW.jour_semaine
    AND actif = true
    AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND (
      -- Check if new schedule conflicts with existing ones
      (NEW.demi_journee = 'toute_journee') OR
      (demi_journee = 'toute_journee') OR
      (NEW.demi_journee = demi_journee)
    );
  
  IF v_overlap_count > 0 THEN
    RAISE EXCEPTION 'Cette secrétaire a déjà un horaire qui chevauche sur ce jour: %. Veuillez modifier ou supprimer l''horaire existant avant d''ajouter un nouveau.', 
      v_existing_horaire;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger to check overlaps before insert/update
DROP TRIGGER IF EXISTS check_horaire_secretaire_overlap_trigger ON public.horaires_base_secretaires;
CREATE TRIGGER check_horaire_secretaire_overlap_trigger
BEFORE INSERT OR UPDATE ON public.horaires_base_secretaires
FOR EACH ROW
EXECUTE FUNCTION public.check_horaire_secretaire_overlap();

-- Update handle_horaire_secretaire_insert_logic to support alternance
CREATE OR REPLACE FUNCTION public.handle_horaire_secretaire_insert_logic(p_horaire record)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_current_date DATE;
  v_start_date DATE;
  v_end_date DATE;
  v_abs_full INTEGER;
  v_has_partial_absence BOOLEAN;
  v_is_holiday BOOLEAN;
  v_should_work BOOLEAN;
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
    
    -- Check if secretary should work according to alternance
    v_should_work := public.should_doctor_work(
      COALESCE(p_horaire.alternance_type, 'hebdomadaire'::type_alternance),
      COALESCE(p_horaire.alternance_semaine_reference, CURRENT_DATE),
      v_current_date
    );
    
    -- Only create capacite if not a holiday and secretary should work
    IF v_should_work AND NOT v_is_holiday THEN
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
$$;

-- Update recreate_secretary_capacite to support alternance
CREATE OR REPLACE FUNCTION public.recreate_secretary_capacite(p_secretaire_id uuid, p_date_debut date, p_date_fin date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_current_date date;
  v_jour_semaine integer;
  v_secretaire RECORD;
  v_horaire RECORD;
  v_abs_full integer;
  v_max_date date;
  v_is_holiday boolean;
  v_should_work boolean;
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
        -- Check if secretary should work according to alternance
        v_should_work := public.should_doctor_work(
          COALESCE(v_horaire.alternance_type, 'hebdomadaire'::type_alternance),
          COALESCE(v_horaire.alternance_semaine_reference, CURRENT_DATE),
          v_current_date
        );
        
        IF v_should_work THEN
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
        END IF;
      END LOOP;
    END IF;
    
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
END;
$$;