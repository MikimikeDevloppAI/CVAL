-- Migration complète : Attribution automatique des salles pour le bloc opératoire (VERSION FINALE)

-- 1. Ajouter de nouvelles colonnes UUID temporaires
ALTER TABLE public.types_intervention
ADD COLUMN IF NOT EXISTS salle_preferentielle_uuid UUID;

ALTER TABLE public.configurations_multi_flux_interventions
ADD COLUMN IF NOT EXISTS salle_uuid UUID;

ALTER TABLE public.planning_genere_bloc_operatoire
ADD COLUMN IF NOT EXISTS salle_assignee_uuid UUID;

-- 2. Migrer les données TEXT vers UUID
UPDATE public.types_intervention
SET salle_preferentielle_uuid = CASE salle_preferentielle
  WHEN 'Rouge' THEN '11111111-1111-1111-1111-111111111111'::uuid
  WHEN 'Verte' THEN '22222222-2222-2222-2222-222222222222'::uuid
  WHEN 'Jaune' THEN '33333333-3333-3333-3333-333333333333'::uuid
  ELSE NULL
END
WHERE salle_preferentielle IS NOT NULL;

UPDATE public.configurations_multi_flux_interventions
SET salle_uuid = CASE salle
  WHEN 'Rouge' THEN '11111111-1111-1111-1111-111111111111'::uuid
  WHEN 'Verte' THEN '22222222-2222-2222-2222-222222222222'::uuid
  WHEN 'Jaune' THEN '33333333-3333-3333-3333-333333333333'::uuid
  ELSE NULL
END
WHERE salle IS NOT NULL;

UPDATE public.planning_genere_bloc_operatoire
SET salle_assignee_uuid = CASE salle_assignee
  WHEN 'Rouge' THEN '11111111-1111-1111-1111-111111111111'::uuid
  WHEN 'Verte' THEN '22222222-2222-2222-2222-222222222222'::uuid
  WHEN 'Jaune' THEN '33333333-3333-3333-3333-333333333333'::uuid
  ELSE NULL
END
WHERE salle_assignee IS NOT NULL;

-- 3. Supprimer les anciennes colonnes TEXT
ALTER TABLE public.types_intervention
DROP COLUMN IF EXISTS salle_preferentielle;

ALTER TABLE public.configurations_multi_flux_interventions
DROP COLUMN IF EXISTS salle;

ALTER TABLE public.planning_genere_bloc_operatoire
DROP COLUMN IF EXISTS salle_assignee;

-- 4. Renommer les colonnes UUID
ALTER TABLE public.types_intervention
RENAME COLUMN salle_preferentielle_uuid TO salle_preferentielle;

ALTER TABLE public.configurations_multi_flux_interventions
RENAME COLUMN salle_uuid TO salle;

ALTER TABLE public.planning_genere_bloc_operatoire
RENAME COLUMN salle_assignee_uuid TO salle_assignee;

-- 5. Ajouter les foreign keys
ALTER TABLE public.types_intervention
ADD CONSTRAINT fk_types_intervention_salle
FOREIGN KEY (salle_preferentielle) REFERENCES public.salles_operation(id) ON DELETE SET NULL;

ALTER TABLE public.configurations_multi_flux_interventions
ADD CONSTRAINT fk_multi_flux_salle
FOREIGN KEY (salle) REFERENCES public.salles_operation(id) ON DELETE CASCADE;

ALTER TABLE public.planning_genere_bloc_operatoire
ADD CONSTRAINT fk_planning_bloc_salle
FOREIGN KEY (salle_assignee) REFERENCES public.salles_operation(id) ON DELETE SET NULL;

-- 6. Ajouter contrainte d'unicité
ALTER TABLE public.planning_genere_bloc_operatoire
DROP CONSTRAINT IF EXISTS unique_bloc_operation;

ALTER TABLE public.planning_genere_bloc_operatoire
ADD CONSTRAINT unique_bloc_operation 
UNIQUE (date, periode, type_intervention_id, medecin_id);

-- 7. Créer la fonction d'attribution de salle
CREATE OR REPLACE FUNCTION public.assign_room_for_operation(
  p_date DATE,
  p_periode demi_journee,
  p_type_intervention_id UUID,
  p_medecin_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
  v_multi_flux_config RECORD;
  v_assigned_room UUID;
  v_preferential_room UUID;
  v_config_room UUID;
  v_ordre INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM planning_genere_bloc_operatoire
  WHERE date = p_date 
    AND periode = p_periode
    AND type_intervention_id = p_type_intervention_id
    AND statut != 'annule'::statut_planning;

  IF v_count >= 2 THEN
    SELECT cf.* INTO v_multi_flux_config
    FROM configurations_multi_flux cf
    WHERE cf.actif = true
      AND cf.type_flux = CASE 
        WHEN v_count = 2 THEN 'double_flux'
        WHEN v_count >= 3 THEN 'triple_flux'
        ELSE 'double_flux'
      END
      AND EXISTS (
        SELECT 1 
        FROM configurations_multi_flux_interventions cfi
        WHERE cfi.configuration_id = cf.id
          AND cfi.type_intervention_id = p_type_intervention_id
      )
    LIMIT 1;

    IF FOUND THEN
      SELECT ROW_NUMBER() OVER (ORDER BY id) INTO v_ordre
      FROM (
        SELECT id FROM planning_genere_bloc_operatoire
        WHERE date = p_date 
          AND periode = p_periode
          AND type_intervention_id = p_type_intervention_id
          AND statut != 'annule'::statut_planning
      ) sub
      WHERE id = (
        SELECT id FROM planning_genere_bloc_operatoire
        WHERE date = p_date 
          AND periode = p_periode
          AND type_intervention_id = p_type_intervention_id
          AND medecin_id = p_medecin_id
          AND statut != 'annule'::statut_planning
        LIMIT 1
      );

      SELECT salle INTO v_config_room
      FROM configurations_multi_flux_interventions
      WHERE configuration_id = v_multi_flux_config.id
        AND type_intervention_id = p_type_intervention_id
        AND ordre = v_ordre;

      IF v_config_room IS NOT NULL THEN
        IF NOT EXISTS (
          SELECT 1 FROM planning_genere_bloc_operatoire
          WHERE date = p_date 
            AND periode = p_periode
            AND salle_assignee = v_config_room
            AND statut != 'annule'::statut_planning
            AND NOT (type_intervention_id = p_type_intervention_id AND medecin_id = p_medecin_id)
        ) THEN
          RETURN v_config_room;
        END IF;
      END IF;
    END IF;
  END IF;

  SELECT salle_preferentielle INTO v_preferential_room
  FROM types_intervention
  WHERE id = p_type_intervention_id;

  IF v_preferential_room IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM planning_genere_bloc_operatoire
      WHERE date = p_date 
        AND periode = p_periode
        AND salle_assignee = v_preferential_room
        AND statut != 'annule'::statut_planning
        AND NOT (type_intervention_id = p_type_intervention_id AND medecin_id = p_medecin_id)
    ) THEN
      RETURN v_preferential_room;
    END IF;
  END IF;

  SELECT id INTO v_assigned_room
  FROM salles_operation
  WHERE NOT EXISTS (
    SELECT 1 FROM planning_genere_bloc_operatoire
    WHERE date = p_date 
      AND periode = p_periode
      AND salle_assignee = salles_operation.id
      AND statut != 'annule'::statut_planning
      AND NOT (type_intervention_id = p_type_intervention_id AND medecin_id = p_medecin_id)
  )
  ORDER BY name
  LIMIT 1;

  RETURN v_assigned_room;
END;
$$;

-- 8. Créer la fonction de réattribution globale
CREATE OR REPLACE FUNCTION public.reassign_all_rooms_for_slot(
  p_date DATE,
  p_periode demi_journee
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_operation RECORD;
BEGIN
  FOR v_operation IN 
    SELECT id, type_intervention_id, medecin_id
    FROM planning_genere_bloc_operatoire
    WHERE date = p_date 
      AND periode = p_periode
      AND statut != 'annule'::statut_planning
    ORDER BY id
  LOOP
    UPDATE planning_genere_bloc_operatoire
    SET salle_assignee = assign_room_for_operation(
      p_date, 
      p_periode, 
      v_operation.type_intervention_id,
      v_operation.medecin_id
    )
    WHERE id = v_operation.id;
  END LOOP;
END;
$$;

-- 9. Créer le trigger INSERT
CREATE OR REPLACE FUNCTION public.handle_besoin_bloc_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.type_intervention_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO planning_genere_bloc_operatoire (
    date,
    periode,
    type_intervention_id,
    medecin_id,
    salle_assignee,
    statut
  ) VALUES (
    NEW.date,
    NEW.demi_journee,
    NEW.type_intervention_id,
    NEW.medecin_id,
    NULL::uuid,
    'planifie'::statut_planning
  )
  ON CONFLICT (date, periode, type_intervention_id, medecin_id) DO NOTHING;

  PERFORM reassign_all_rooms_for_slot(NEW.date, NEW.demi_journee);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_besoin_bloc_insert ON public.besoin_effectif;
CREATE TRIGGER trigger_besoin_bloc_insert
AFTER INSERT ON public.besoin_effectif
FOR EACH ROW
EXECUTE FUNCTION handle_besoin_bloc_insert();

-- 10. Créer le trigger UPDATE
CREATE OR REPLACE FUNCTION public.handle_besoin_bloc_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.type_intervention_id IS NOT NULL THEN
    IF NEW.type_intervention_id IS NULL THEN
      DELETE FROM planning_genere_bloc_operatoire
      WHERE date = OLD.date
        AND periode = OLD.demi_journee
        AND type_intervention_id = OLD.type_intervention_id
        AND medecin_id = OLD.medecin_id;
      
      PERFORM reassign_all_rooms_for_slot(OLD.date, OLD.demi_journee);
      RETURN NEW;
    END IF;

    IF (OLD.date != NEW.date OR 
        OLD.demi_journee != NEW.demi_journee OR 
        OLD.type_intervention_id != NEW.type_intervention_id OR
        OLD.medecin_id != NEW.medecin_id) THEN
      
      DELETE FROM planning_genere_bloc_operatoire
      WHERE date = OLD.date
        AND periode = OLD.demi_journee
        AND type_intervention_id = OLD.type_intervention_id
        AND medecin_id = OLD.medecin_id;

      INSERT INTO planning_genere_bloc_operatoire (
        date,
        periode,
        type_intervention_id,
        medecin_id,
        salle_assignee,
        statut
      ) VALUES (
        NEW.date,
        NEW.demi_journee,
        NEW.type_intervention_id,
        NEW.medecin_id,
        NULL::uuid,
        'planifie'::statut_planning
      )
      ON CONFLICT (date, periode, type_intervention_id, medecin_id) DO NOTHING;

      PERFORM reassign_all_rooms_for_slot(OLD.date, OLD.demi_journee);
      PERFORM reassign_all_rooms_for_slot(NEW.date, NEW.demi_journee);
    END IF;
  ELSIF NEW.type_intervention_id IS NOT NULL THEN
    INSERT INTO planning_genere_bloc_operatoire (
      date,
      periode,
      type_intervention_id,
      medecin_id,
      salle_assignee,
      statut
    ) VALUES (
      NEW.date,
      NEW.demi_journee,
      NEW.type_intervention_id,
      NEW.medecin_id,
      NULL::uuid,
      'planifie'::statut_planning
    )
    ON CONFLICT (date, periode, type_intervention_id, medecin_id) DO NOTHING;

    PERFORM reassign_all_rooms_for_slot(NEW.date, NEW.demi_journee);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_besoin_bloc_update ON public.besoin_effectif;
CREATE TRIGGER trigger_besoin_bloc_update
AFTER UPDATE ON public.besoin_effectif
FOR EACH ROW
EXECUTE FUNCTION handle_besoin_bloc_update();

-- 11. Créer le trigger DELETE
CREATE OR REPLACE FUNCTION public.handle_besoin_bloc_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.type_intervention_id IS NULL THEN
    RETURN OLD;
  END IF;

  DELETE FROM planning_genere_bloc_operatoire
  WHERE date = OLD.date
    AND periode = OLD.demi_journee
    AND type_intervention_id = OLD.type_intervention_id
    AND medecin_id = OLD.medecin_id;

  PERFORM reassign_all_rooms_for_slot(OLD.date, OLD.demi_journee);

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trigger_besoin_bloc_delete ON public.besoin_effectif;
CREATE TRIGGER trigger_besoin_bloc_delete
AFTER DELETE ON public.besoin_effectif
FOR EACH ROW
EXECUTE FUNCTION handle_besoin_bloc_delete();

-- 12. Peupler planning_genere_bloc_operatoire depuis besoin_effectif
INSERT INTO planning_genere_bloc_operatoire (
  date,
  periode,
  type_intervention_id,
  medecin_id,
  salle_assignee,
  statut
)
SELECT DISTINCT
  be.date,
  be.demi_journee,
  be.type_intervention_id,
  be.medecin_id,
  NULL::uuid,
  'planifie'::statut_planning
FROM besoin_effectif be
WHERE be.type_intervention_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM planning_genere_bloc_operatoire pgb
    WHERE pgb.date = be.date
      AND pgb.periode = be.demi_journee
      AND pgb.type_intervention_id = be.type_intervention_id
      AND pgb.medecin_id = be.medecin_id
  )
ON CONFLICT (date, periode, type_intervention_id, medecin_id) DO NOTHING;

-- 13. Assigner les salles pour toutes les opérations existantes
DO $$
DECLARE
  v_slot RECORD;
BEGIN
  FOR v_slot IN
    SELECT DISTINCT date, periode
    FROM planning_genere_bloc_operatoire
    WHERE statut != 'annule'::statut_planning
  LOOP
    PERFORM reassign_all_rooms_for_slot(v_slot.date, v_slot.periode);
  END LOOP;
END;
$$;