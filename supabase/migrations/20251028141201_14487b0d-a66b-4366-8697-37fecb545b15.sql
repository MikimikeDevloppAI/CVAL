-- Adjust overlap handling for besoin_effectif: skip when generated from base schedules
-- Create or replace the trigger function that checks overlaps on besoin_effectif
CREATE OR REPLACE FUNCTION public.check_besoin_effectif_overlap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_overlap_count integer;
BEGIN
  -- Only apply overlap validation for doctor-type needs
  IF NEW.type IS DISTINCT FROM 'medecin' THEN
    RETURN NEW;
  END IF;

  -- Count overlapping entries for the same doctor/date considering demi-journee rules
  SELECT COUNT(*) INTO v_overlap_count
  FROM public.besoin_effectif be
  WHERE be.date = NEW.date
    AND be.type = 'medecin'
    AND be.medecin_id = NEW.medecin_id
    AND (
      NEW.demi_journee = 'toute_journee'::demi_journee
      OR be.demi_journee = 'toute_journee'::demi_journee
      OR be.demi_journee = NEW.demi_journee
    );

  IF v_overlap_count > 0 THEN
    -- If this row comes from a base schedule generation, skip silently
    IF NEW.horaire_base_medecin_id IS NOT NULL THEN
      RETURN NULL; -- skip insertion
    ELSE
      -- Manual insertion: block as before
      RAISE EXCEPTION 'Chevauchement détecté pour ce médecin à cette date: un créneau existe déjà.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Ensure the trigger exists and points to the updated function
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'trg_check_besoin_effectif_overlap' 
      AND tgrelid = 'public.besoin_effectif'::regclass
  ) THEN
    -- Recreate to ensure it calls the latest function
    DROP TRIGGER trg_check_besoin_effectif_overlap ON public.besoin_effectif;
  END IF;

  CREATE TRIGGER trg_check_besoin_effectif_overlap
  BEFORE INSERT ON public.besoin_effectif
  FOR EACH ROW
  EXECUTE FUNCTION public.check_besoin_effectif_overlap();
END $$;