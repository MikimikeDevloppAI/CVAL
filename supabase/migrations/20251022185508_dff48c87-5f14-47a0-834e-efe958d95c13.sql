-- Créer les nouveaux triggers d'absence avec la logique demi_journee

-- 1. Trigger pour la création d'absence
CREATE OR REPLACE FUNCTION public.handle_absence_creation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Supprimer les créneaux affectés par l'absence
  IF NEW.medecin_id IS NOT NULL THEN
    DELETE FROM public.besoin_effectif
    WHERE medecin_id = NEW.medecin_id
      AND date >= NEW.date_debut
      AND date <= NEW.date_fin
      AND (
        NEW.demi_journee = 'toute_journee' OR
        demi_journee = NEW.demi_journee
      );
  END IF;

  IF NEW.secretaire_id IS NOT NULL THEN
    DELETE FROM public.capacite_effective
    WHERE secretaire_id = NEW.secretaire_id
      AND date >= NEW.date_debut
      AND date <= NEW.date_fin
      AND (
        NEW.demi_journee = 'toute_journee' OR
        demi_journee = NEW.demi_journee
      );
  END IF;

  RETURN NEW;
END;
$$;

-- 2. Trigger pour la suppression d'absence
CREATE OR REPLACE FUNCTION public.handle_absence_deletion_new()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Supprimer les créneaux de la période d'absence
  IF OLD.medecin_id IS NOT NULL THEN
    DELETE FROM public.besoin_effectif
    WHERE medecin_id = OLD.medecin_id
      AND date >= OLD.date_debut
      AND date <= OLD.date_fin
      AND (
        OLD.demi_journee = 'toute_journee' OR
        demi_journee = OLD.demi_journee
      );
    
    -- Recréer les créneaux pour cette période
    PERFORM public.recreate_doctor_besoin(OLD.medecin_id, OLD.date_debut, OLD.date_fin);
  END IF;

  IF OLD.secretaire_id IS NOT NULL THEN
    DELETE FROM public.capacite_effective
    WHERE secretaire_id = OLD.secretaire_id
      AND date >= OLD.date_debut
      AND date <= OLD.date_fin
      AND (
        OLD.demi_journee = 'toute_journee' OR
        demi_journee = OLD.demi_journee
      );
    
    -- Recréer les créneaux pour cette période
    PERFORM public.recreate_secretary_capacite(OLD.secretaire_id, OLD.date_debut, OLD.date_fin);
  END IF;

  RETURN OLD;
END;
$$;

-- 3. Trigger pour la modification d'absence
CREATE OR REPLACE FUNCTION public.handle_absence_modification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_min_date DATE;
  v_max_date DATE;
BEGIN
  v_min_date := LEAST(OLD.date_debut, NEW.date_debut);
  v_max_date := GREATEST(OLD.date_fin, NEW.date_fin);
  
  -- Supprimer les créneaux de l'ancienne ET la nouvelle période
  IF NEW.medecin_id IS NOT NULL THEN
    DELETE FROM public.besoin_effectif
    WHERE medecin_id = COALESCE(NEW.medecin_id, OLD.medecin_id)
      AND date >= v_min_date
      AND date <= v_max_date;
    
    -- Recréer seulement pour l'ancienne période (pas la nouvelle)
    PERFORM public.recreate_doctor_besoin(OLD.medecin_id, OLD.date_debut, OLD.date_fin);
  END IF;

  IF NEW.secretaire_id IS NOT NULL THEN
    DELETE FROM public.capacite_effective
    WHERE secretaire_id = COALESCE(NEW.secretaire_id, OLD.secretaire_id)
      AND date >= v_min_date
      AND date <= v_max_date;
    
    -- Recréer seulement pour l'ancienne période (pas la nouvelle)
    PERFORM public.recreate_secretary_capacite(OLD.secretaire_id, OLD.date_debut, OLD.date_fin);
  END IF;

  RETURN NEW;
END;
$$;

-- Attacher les triggers
DROP TRIGGER IF EXISTS handle_absence_creation_trigger ON public.absences;
CREATE TRIGGER handle_absence_creation_trigger
  AFTER INSERT ON public.absences
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_absence_creation();

DROP TRIGGER IF EXISTS handle_absence_deletion_trigger ON public.absences;
CREATE TRIGGER handle_absence_deletion_trigger
  BEFORE DELETE ON public.absences
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_absence_deletion_new();

DROP TRIGGER IF EXISTS handle_absence_modification_trigger ON public.absences;
CREATE TRIGGER handle_absence_modification_trigger
  AFTER UPDATE ON public.absences
  FOR EACH ROW
  WHEN (
    OLD.date_debut IS DISTINCT FROM NEW.date_debut OR
    OLD.date_fin IS DISTINCT FROM NEW.date_fin OR
    OLD.demi_journee IS DISTINCT FROM NEW.demi_journee OR
    OLD.statut IS DISTINCT FROM NEW.statut
  )
  EXECUTE FUNCTION public.handle_absence_modification();