-- Create trigger to check overlapping base schedules for doctors
-- This prevents creating conflicting schedules considering alternance patterns

CREATE OR REPLACE FUNCTION public.check_horaire_medecin_overlap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_overlap_count integer;
  v_existing_horaire record;
  v_conflict_message text;
BEGIN
  -- Only check for active schedules
  IF NOT NEW.actif THEN
    RETURN NEW;
  END IF;

  -- Find overlapping schedules for same doctor/day
  FOR v_existing_horaire IN
    SELECT 
      id,
      demi_journee,
      alternance_type,
      alternance_semaine_modulo,
      s.nom as site_nom
    FROM public.horaires_base_medecins hbm
    LEFT JOIN public.sites s ON s.id = hbm.site_id
    WHERE hbm.medecin_id = NEW.medecin_id
      AND hbm.jour_semaine = NEW.jour_semaine
      AND hbm.actif = true
      AND hbm.id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND (
        -- Check if periods overlap (toute_journee overlaps with everything)
        NEW.demi_journee = 'toute_journee'::demi_journee
        OR hbm.demi_journee = 'toute_journee'::demi_journee
        OR hbm.demi_journee = NEW.demi_journee
      )
  LOOP
    -- Check if alternance patterns conflict
    -- Patterns conflict if they work on the same weeks
    IF (
      -- Both hebdomadaire = always conflict
      (v_existing_horaire.alternance_type = 'hebdomadaire' AND NEW.alternance_type = 'hebdomadaire')
      
      -- hebdomadaire conflicts with everything
      OR (v_existing_horaire.alternance_type = 'hebdomadaire')
      OR (NEW.alternance_type = 'hebdomadaire')
      
      -- Same alternance type with same modulo = conflict
      OR (
        v_existing_horaire.alternance_type = NEW.alternance_type
        AND COALESCE(v_existing_horaire.alternance_semaine_modulo, 0) = COALESCE(NEW.alternance_semaine_modulo, 0)
      )
      
      -- trois_sur_quatre with une_sur_quatre: conflict if modulo differs (they share 3 weeks)
      OR (
        v_existing_horaire.alternance_type = 'trois_sur_quatre' 
        AND NEW.alternance_type = 'une_sur_quatre'
        AND COALESCE(v_existing_horaire.alternance_semaine_modulo, 0) != COALESCE(NEW.alternance_semaine_modulo, 0)
      )
      OR (
        v_existing_horaire.alternance_type = 'une_sur_quatre' 
        AND NEW.alternance_type = 'trois_sur_quatre'
        AND COALESCE(v_existing_horaire.alternance_semaine_modulo, 0) != COALESCE(NEW.alternance_semaine_modulo, 0)
      )
    ) THEN
      -- Build conflict message
      v_conflict_message := format(
        'Conflit avec horaire existant: %s %s (%s, modulo %s) sur le site %s',
        CASE 
          WHEN v_existing_horaire.demi_journee = 'matin' THEN 'Matin'
          WHEN v_existing_horaire.demi_journee = 'apres_midi' THEN 'Après-midi'
          ELSE 'Toute journée'
        END,
        CASE v_existing_horaire.alternance_type
          WHEN 'hebdomadaire' THEN 'chaque semaine'
          WHEN 'une_sur_deux' THEN 'une semaine sur deux'
          WHEN 'une_sur_trois' THEN 'une semaine sur trois'
          WHEN 'une_sur_quatre' THEN 'une semaine sur quatre'
          WHEN 'trois_sur_quatre' THEN 'trois semaines sur quatre'
          ELSE ''
        END,
        v_existing_horaire.alternance_type,
        COALESCE(v_existing_horaire.alternance_semaine_modulo, 0),
        COALESCE(v_existing_horaire.site_nom, 'non défini')
      );
      
      RAISE EXCEPTION '%', v_conflict_message;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

-- Drop trigger if exists and recreate
DROP TRIGGER IF EXISTS trg_check_horaire_medecin_overlap ON public.horaires_base_medecins;

CREATE TRIGGER trg_check_horaire_medecin_overlap
BEFORE INSERT OR UPDATE ON public.horaires_base_medecins
FOR EACH ROW
EXECUTE FUNCTION public.check_horaire_medecin_overlap();