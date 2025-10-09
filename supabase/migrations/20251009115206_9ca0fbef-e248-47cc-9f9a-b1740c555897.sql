-- Drop trigger first, then function
DROP TRIGGER IF EXISTS check_besoin_effectif_overlap_trigger ON public.besoin_effectif;
DROP FUNCTION IF EXISTS public.check_besoin_effectif_overlap();

-- Recreate function with proper search_path
CREATE OR REPLACE FUNCTION public.check_besoin_effectif_overlap()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_overlap_count INTEGER;
  v_existing_site TEXT;
  v_existing_period TEXT;
BEGIN
  -- Only check for medical besoins (not bloc_operatoire)
  IF NEW.type = 'medecin' AND NEW.medecin_id IS NOT NULL THEN
    -- Check if this medecin already has a conflicting besoin for the same date
    SELECT COUNT(*), MAX(s.nom || ' (' || be.demi_journee || ')')
    INTO v_overlap_count, v_existing_site
    FROM public.besoin_effectif be
    LEFT JOIN public.sites s ON s.id = be.site_id
    WHERE be.date = NEW.date
      AND be.medecin_id = NEW.medecin_id
      AND be.type = 'medecin'
      AND be.actif = true
      AND be.id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND (
        -- If NEW is toute_journee, it conflicts with any existing period
        (NEW.demi_journee = 'toute_journee' AND be.demi_journee IN ('matin', 'apres_midi', 'toute_journee'))
        OR
        -- If existing is toute_journee, it conflicts with NEW
        (be.demi_journee = 'toute_journee' AND NEW.demi_journee IN ('matin', 'apres_midi', 'toute_journee'))
        OR
        -- If same specific period (matin with matin, or apres_midi with apres_midi)
        (NEW.demi_journee = be.demi_journee AND NEW.demi_journee IN ('matin', 'apres_midi'))
      );
    
    IF v_overlap_count > 0 THEN
      RAISE EXCEPTION 'Ce médecin a déjà un besoin effectif qui chevauche sur cette date: %. Un médecin ne peut pas travailler à deux endroits différents en même temps.', 
        v_existing_site;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Recreate trigger
CREATE TRIGGER check_besoin_effectif_overlap_trigger
  BEFORE INSERT OR UPDATE ON public.besoin_effectif
  FOR EACH ROW
  EXECUTE FUNCTION public.check_besoin_effectif_overlap();