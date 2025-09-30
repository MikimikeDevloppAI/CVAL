-- Fonction pour vérifier les chevauchements dans besoin_effectif
CREATE OR REPLACE FUNCTION public.check_besoin_effectif_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_overlap_count INTEGER;
  v_existing_site TEXT;
  v_existing_hours TEXT;
BEGIN
  -- Vérifier uniquement pour les besoins de type 'medecin' avec un medecin_id
  IF NEW.type = 'medecin' AND NEW.medecin_id IS NOT NULL THEN
    -- Chercher les chevauchements pour ce médecin ce jour-là
    SELECT COUNT(*), 
           MAX(s.nom),
           MAX(be.heure_debut::text || ' - ' || be.heure_fin::text)
    INTO v_overlap_count, v_existing_site, v_existing_hours
    FROM public.besoin_effectif be
    LEFT JOIN public.sites s ON s.id = be.site_id
    WHERE be.medecin_id = NEW.medecin_id
      AND be.date = NEW.date
      AND be.actif = true
      AND be.id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND (
        -- Vérifier le chevauchement des horaires
        (NEW.heure_debut, NEW.heure_fin) OVERLAPS (be.heure_debut, be.heure_fin)
      );
    
    IF v_overlap_count > 0 THEN
      RAISE EXCEPTION 'Ce médecin est déjà attribué à % pour les horaires %. Veuillez d''abord supprimer cette ligne pour le réattribuer.', 
        v_existing_site, v_existing_hours;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Fonction pour vérifier les chevauchements dans capacite_effective
CREATE OR REPLACE FUNCTION public.check_capacite_effective_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_overlap_count INTEGER;
  v_existing_site TEXT;
  v_existing_hours TEXT;
BEGIN
  -- Chercher les chevauchements pour cette secrétaire ce jour-là
  SELECT COUNT(*),
         MAX(s.nom),
         MAX(ce.heure_debut::text || ' - ' || ce.heure_fin::text)
  INTO v_overlap_count, v_existing_site, v_existing_hours
  FROM public.capacite_effective ce
  LEFT JOIN public.sites s ON s.id = ce.site_id
  WHERE ce.secretaire_id = NEW.secretaire_id
    AND ce.date = NEW.date
    AND ce.actif = true
    AND ce.id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND (
      -- Vérifier le chevauchement des horaires
      (NEW.heure_debut, NEW.heure_fin) OVERLAPS (ce.heure_debut, ce.heure_fin)
    );
  
  IF v_overlap_count > 0 THEN
    RAISE EXCEPTION 'Cette secrétaire est déjà attribuée à % pour les horaires %. Veuillez d''abord supprimer cette ligne pour la réattribuer.', 
      v_existing_site, v_existing_hours;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Créer les triggers
DROP TRIGGER IF EXISTS trigger_check_besoin_effectif_overlap ON public.besoin_effectif;
CREATE TRIGGER trigger_check_besoin_effectif_overlap
  BEFORE INSERT OR UPDATE ON public.besoin_effectif
  FOR EACH ROW
  EXECUTE FUNCTION public.check_besoin_effectif_overlap();

DROP TRIGGER IF EXISTS trigger_check_capacite_effective_overlap ON public.capacite_effective;
CREATE TRIGGER trigger_check_capacite_effective_overlap
  BEFORE INSERT OR UPDATE ON public.capacite_effective
  FOR EACH ROW
  EXECUTE FUNCTION public.check_capacite_effective_overlap();