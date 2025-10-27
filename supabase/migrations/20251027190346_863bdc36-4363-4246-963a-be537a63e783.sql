-- Fix absence handling for demi_journee IS NULL (full day absences)

-- 1. Update handle_absence_creation to treat NULL as full day
CREATE OR REPLACE FUNCTION public.handle_absence_creation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Supprimer les créneaux affectés par l'absence
  IF NEW.medecin_id IS NOT NULL THEN
    DELETE FROM public.besoin_effectif
    WHERE medecin_id = NEW.medecin_id
      AND date >= NEW.date_debut
      AND date <= NEW.date_fin
      AND (
        NEW.demi_journee IS NULL OR
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
        NEW.demi_journee IS NULL OR
        NEW.demi_journee = 'toute_journee' OR
        demi_journee = NEW.demi_journee
      );
  END IF;

  RETURN NEW;
END;
$function$;

-- 2. Update handle_absence_deletion_new to treat NULL as full day
CREATE OR REPLACE FUNCTION public.handle_absence_deletion_new()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Supprimer les créneaux de la période d'absence
  IF OLD.medecin_id IS NOT NULL THEN
    DELETE FROM public.besoin_effectif
    WHERE medecin_id = OLD.medecin_id
      AND date >= OLD.date_debut
      AND date <= OLD.date_fin
      AND (
        OLD.demi_journee IS NULL OR
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
        OLD.demi_journee IS NULL OR
        OLD.demi_journee = 'toute_journee' OR
        demi_journee = OLD.demi_journee
      );
    
    -- Recréer les créneaux pour cette période
    PERFORM public.recreate_secretary_capacite(OLD.secretaire_id, OLD.date_debut, OLD.date_fin);
  END IF;

  RETURN OLD;
END;
$function$;

-- 3. Update handle_absence_modification to treat NULL as full day
CREATE OR REPLACE FUNCTION public.handle_absence_modification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

-- 4. Clean up existing capacite_effective entries that overlap with NULL demi_journee absences
DELETE FROM public.capacite_effective ce
WHERE EXISTS (
  SELECT 1 FROM public.absences a
  WHERE a.type_personne = 'secretaire'
    AND a.secretaire_id = ce.secretaire_id
    AND ce.date BETWEEN a.date_debut AND a.date_fin
    AND a.statut IN ('approuve', 'en_attente')
    AND a.demi_journee IS NULL
);

-- 5. Clean up existing besoin_effectif entries that overlap with NULL demi_journee absences
DELETE FROM public.besoin_effectif be
WHERE EXISTS (
  SELECT 1 FROM public.absences a
  WHERE a.type_personne = 'medecin'
    AND a.medecin_id = be.medecin_id
    AND be.date BETWEEN a.date_debut AND a.date_fin
    AND a.statut IN ('approuve', 'en_attente')
    AND a.demi_journee IS NULL
);