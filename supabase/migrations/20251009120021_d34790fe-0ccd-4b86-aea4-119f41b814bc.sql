-- Drop functions with CASCADE to remove all dependent triggers
DROP FUNCTION IF EXISTS public.handle_jour_ferie_insert() CASCADE;
DROP FUNCTION IF EXISTS public.handle_jour_ferie_update() CASCADE;
DROP FUNCTION IF EXISTS public.handle_jour_ferie_delete() CASCADE;

-- Create new function to recreate besoins/capacites for a specific date only
CREATE OR REPLACE FUNCTION public.recreate_besoins_capacites_for_date(p_date DATE)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_jour_semaine INTEGER;
  v_horaire RECORD;
  v_abs_full INTEGER;
  v_should_work BOOLEAN;
BEGIN
  v_jour_semaine := EXTRACT(ISODOW FROM p_date);
  
  -- Recreate besoins for medecins for this specific date
  FOR v_horaire IN
    SELECT * FROM public.horaires_base_medecins
    WHERE jour_semaine = v_jour_semaine
      AND actif = true
      AND (date_debut IS NULL OR date_debut <= p_date)
      AND (date_fin IS NULL OR date_fin >= p_date)
  LOOP
    -- Check if doctor should work according to alternance
    v_should_work := public.should_doctor_work(
      v_horaire.alternance_type,
      v_horaire.alternance_semaine_modulo,
      p_date
    );
    
    IF v_should_work THEN
      -- Check for full-day absence
      SELECT COUNT(*) INTO v_abs_full
      FROM public.absences
      WHERE medecin_id = v_horaire.medecin_id
        AND p_date BETWEEN date_debut AND date_fin
        AND statut IN ('approuve', 'en_attente')
        AND heure_debut IS NULL AND heure_fin IS NULL;
      
      IF v_abs_full = 0 THEN
        INSERT INTO public.besoin_effectif (
          date, type, medecin_id, site_id, demi_journee
        ) VALUES (
          p_date, 'medecin', v_horaire.medecin_id, v_horaire.site_id, v_horaire.demi_journee
        )
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  END LOOP;
  
  -- Recreate capacites for secretaires for this specific date
  FOR v_horaire IN
    SELECT * FROM public.horaires_base_secretaires
    WHERE jour_semaine = v_jour_semaine
      AND actif = true
      AND (date_debut IS NULL OR date_debut <= p_date)
      AND (date_fin IS NULL OR date_fin >= p_date)
  LOOP
    -- Check for full-day absence
    SELECT COUNT(*) INTO v_abs_full
    FROM public.absences
    WHERE secretaire_id = v_horaire.secretaire_id
      AND p_date BETWEEN date_debut AND date_fin
      AND statut IN ('approuve', 'en_attente')
      AND heure_debut IS NULL AND heure_fin IS NULL;
    
    IF v_abs_full = 0 THEN
      INSERT INTO public.capacite_effective (
        date, secretaire_id, demi_journee
      ) VALUES (
        p_date, v_horaire.secretaire_id, v_horaire.demi_journee
      )
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END;
$$;

-- Recreate insert trigger - deletes besoins/capacites for the holiday date
CREATE OR REPLACE FUNCTION public.handle_jour_ferie_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Delete all besoins effectifs for this specific date
  DELETE FROM public.besoin_effectif WHERE date = NEW.date;
  
  -- Delete all capacites effectives for this specific date
  DELETE FROM public.capacite_effective WHERE date = NEW.date;
  
  RETURN NEW;
END;
$$;

-- Recreate update trigger - handles activation/deactivation for specific date only
CREATE OR REPLACE FUNCTION public.handle_jour_ferie_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- If holiday is being deactivated, regenerate besoins/capacites for that specific date
  IF OLD.actif = true AND NEW.actif = false THEN
    PERFORM public.recreate_besoins_capacites_for_date(NEW.date);
  END IF;
  
  -- If holiday is being activated, clean up besoins/capacites for that specific date
  IF OLD.actif = false AND NEW.actif = true THEN
    DELETE FROM public.besoin_effectif WHERE date = NEW.date;
    DELETE FROM public.capacite_effective WHERE date = NEW.date;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Recreate delete trigger - regenerates for specific date only
CREATE OR REPLACE FUNCTION public.handle_jour_ferie_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.actif = true THEN
    -- Regenerate besoins/capacites only for this specific date
    PERFORM public.recreate_besoins_capacites_for_date(OLD.date);
  END IF;
  
  RETURN OLD;
END;
$$;

-- Recreate triggers
CREATE TRIGGER handle_jour_ferie_insert_trigger
  AFTER INSERT ON public.jours_feries
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_jour_ferie_insert();

CREATE TRIGGER handle_jour_ferie_update_trigger
  AFTER UPDATE ON public.jours_feries
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_jour_ferie_update();

CREATE TRIGGER handle_jour_ferie_delete_trigger
  AFTER DELETE ON public.jours_feries
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_jour_ferie_delete();