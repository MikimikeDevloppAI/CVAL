-- Create public holidays table
CREATE TABLE IF NOT EXISTS public.jours_feries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE NOT NULL UNIQUE,
  nom TEXT NOT NULL,
  actif BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.jours_feries ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users with planning access can manage jours_feries"
ON public.jours_feries
FOR ALL
USING (has_planning_access())
WITH CHECK (has_planning_access());

CREATE POLICY "Users with planning or admin can view jours_feries"
ON public.jours_feries
FOR SELECT
USING (has_planning_or_admin_access());

-- Create trigger for updated_at
CREATE TRIGGER update_jours_feries_updated_at
BEFORE UPDATE ON public.jours_feries
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Update handle_horaire_medecin_insert_logic to check for public holidays
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
  v_should_work BOOLEAN;
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
    
    -- Check if doctor should work according to alternance
    v_should_work := public.should_doctor_work(
      p_horaire.alternance_type,
      p_horaire.alternance_semaine_modulo,
      v_current_date
    );
    
    -- Only create besoin if not a holiday and doctor should work
    IF v_should_work AND NOT v_is_holiday THEN
      -- Check for full-day absence
      SELECT COUNT(*) INTO v_abs_full
      FROM public.absences
      WHERE medecin_id = p_horaire.medecin_id
        AND v_current_date BETWEEN date_debut AND date_fin
        AND statut IN ('approuve', 'en_attente')
        AND heure_debut IS NULL AND heure_fin IS NULL;
      
      IF v_abs_full = 0 THEN
        -- Check for partial absence
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
          );
        END IF;
      END IF;
    END IF;
    
    v_current_date := v_current_date + INTERVAL '7 days';
  END LOOP;
END;
$function$;

-- Update handle_horaire_secretaire_insert_logic to check for public holidays
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
            date, secretaire_id, demi_journee
          ) VALUES (
            v_current_date, p_horaire.secretaire_id, p_horaire.demi_journee
          )
          ON CONFLICT DO NOTHING;
        END IF;
      END IF;
    END IF;
    
    v_current_date := v_current_date + INTERVAL '7 days';
  END LOOP;
END;
$function$;

-- Create trigger to clean up besoins/capacites when a holiday is added
CREATE OR REPLACE FUNCTION public.handle_jour_ferie_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Delete all besoins effectifs for this date
  DELETE FROM public.besoin_effectif WHERE date = NEW.date;
  
  -- Delete all capacites effectives for this date
  DELETE FROM public.capacite_effective WHERE date = NEW.date;
  
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trigger_jour_ferie_insert
AFTER INSERT ON public.jours_feries
FOR EACH ROW
WHEN (NEW.actif = true)
EXECUTE FUNCTION public.handle_jour_ferie_insert();

-- Create trigger to restore besoins/capacites when a holiday is deactivated
CREATE OR REPLACE FUNCTION public.handle_jour_ferie_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_horaire RECORD;
  v_jour_semaine INTEGER;
BEGIN
  -- If holiday is being deactivated, regenerate besoins/capacites for that day
  IF OLD.actif = true AND NEW.actif = false THEN
    v_jour_semaine := EXTRACT(ISODOW FROM NEW.date);
    
    -- Regenerate besoins for medecins
    FOR v_horaire IN
      SELECT * FROM public.horaires_base_medecins
      WHERE jour_semaine = v_jour_semaine
        AND actif = true
        AND (date_debut IS NULL OR date_debut <= NEW.date)
        AND (date_fin IS NULL OR date_fin >= NEW.date)
    LOOP
      PERFORM public.handle_horaire_medecin_insert_logic(v_horaire);
    END LOOP;
    
    -- Regenerate capacites for secretaires
    FOR v_horaire IN
      SELECT * FROM public.horaires_base_secretaires
      WHERE jour_semaine = v_jour_semaine
        AND actif = true
        AND (date_debut IS NULL OR date_debut <= NEW.date)
        AND (date_fin IS NULL OR date_fin >= NEW.date)
    LOOP
      PERFORM public.handle_horaire_secretaire_insert_logic(v_horaire);
    END LOOP;
  END IF;
  
  -- If holiday is being activated, clean up besoins/capacites
  IF OLD.actif = false AND NEW.actif = true THEN
    DELETE FROM public.besoin_effectif WHERE date = NEW.date;
    DELETE FROM public.capacite_effective WHERE date = NEW.date;
  END IF;
  
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trigger_jour_ferie_update
AFTER UPDATE ON public.jours_feries
FOR EACH ROW
EXECUTE FUNCTION public.handle_jour_ferie_update();

-- Create trigger to restore besoins/capacites when a holiday is deleted
CREATE OR REPLACE FUNCTION public.handle_jour_ferie_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_horaire RECORD;
  v_jour_semaine INTEGER;
BEGIN
  IF OLD.actif = true THEN
    v_jour_semaine := EXTRACT(ISODOW FROM OLD.date);
    
    -- Regenerate besoins for medecins
    FOR v_horaire IN
      SELECT * FROM public.horaires_base_medecins
      WHERE jour_semaine = v_jour_semaine
        AND actif = true
        AND (date_debut IS NULL OR date_debut <= OLD.date)
        AND (date_fin IS NULL OR date_fin >= OLD.date)
    LOOP
      PERFORM public.handle_horaire_medecin_insert_logic(v_horaire);
    END LOOP;
    
    -- Regenerate capacites for secretaires
    FOR v_horaire IN
      SELECT * FROM public.horaires_base_secretaires
      WHERE jour_semaine = v_jour_semaine
        AND actif = true
        AND (date_debut IS NULL OR date_debut <= OLD.date)
        AND (date_fin IS NULL OR date_fin >= OLD.date)
    LOOP
      PERFORM public.handle_horaire_secretaire_insert_logic(v_horaire);
    END LOOP;
  END IF;
  
  RETURN OLD;
END;
$function$;

CREATE TRIGGER trigger_jour_ferie_delete
AFTER DELETE ON public.jours_feries
FOR EACH ROW
EXECUTE FUNCTION public.handle_jour_ferie_delete();