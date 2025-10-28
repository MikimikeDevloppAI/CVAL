-- Fix trigger error: avoid ambiguous column by fully qualifying selected columns
CREATE OR REPLACE FUNCTION public.check_horaire_medecin_overlap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_existing_horaire record;
  v_conflict_message text;
BEGIN
  -- Only check for active schedules
  IF NOT NEW.actif THEN
    RETURN NEW;
  END IF;

  -- Scan existing active schedules for same doctor/day and overlapping period
  FOR v_existing_horaire IN
    SELECT 
      hbm.demi_journee AS demi_journee,
      hbm.alternance_type AS alternance_type,
      hbm.alternance_semaine_modulo AS alternance_semaine_modulo,
      s.nom AS site_nom
    FROM public.horaires_base_medecins AS hbm
    LEFT JOIN public.sites AS s ON s.id = hbm.site_id
    WHERE hbm.medecin_id = NEW.medecin_id
      AND hbm.jour_semaine = NEW.jour_semaine
      AND hbm.actif = true
      AND hbm.id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND (
        NEW.demi_journee = 'toute_journee'::demi_journee
        OR hbm.demi_journee = 'toute_journee'::demi_journee
        OR hbm.demi_journee = NEW.demi_journee
      )
  LOOP
    -- Alternance conflict rules
    IF (
      -- Weekly always conflicts
      v_existing_horaire.alternance_type = 'hebdomadaire'
      OR NEW.alternance_type = 'hebdomadaire'
      -- Same alternance and same modulo => conflict
      OR (
        v_existing_horaire.alternance_type = NEW.alternance_type
        AND COALESCE(v_existing_horaire.alternance_semaine_modulo, 0) = COALESCE(NEW.alternance_semaine_modulo, 0)
      )
      -- 3/4 vs 1/4: conflict when modulo differs (they overlap 3 weeks)
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
      v_conflict_message := format(
        'Conflit avec un horaire existant: %s, %s (modulo %s) sur le site %s',
        CASE 
          WHEN v_existing_horaire.demi_journee = 'matin' THEN 'Matin'
          WHEN v_existing_horaire.demi_journee = 'apres_midi' THEN 'Après-midi'
          ELSE 'Toute journée'
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

-- Ensure trigger is attached
DROP TRIGGER IF EXISTS trg_check_horaire_medecin_overlap ON public.horaires_base_medecins;
CREATE TRIGGER trg_check_horaire_medecin_overlap
BEFORE INSERT OR UPDATE ON public.horaires_base_medecins
FOR EACH ROW
EXECUTE FUNCTION public.check_horaire_medecin_overlap();