-- Modify assign_room_for_operation to prioritize priority rooms over multi-flux configurations
-- Priority order: 1) Exclusive, 2) Priority (with displacement), 3) Multi-flux, 4) Preferential, 5) Free room

CREATE OR REPLACE FUNCTION public.assign_room_for_operation(
  p_date date, 
  p_periode demi_journee, 
  p_type_intervention_id uuid, 
  p_medecin_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count INTEGER;
  v_multi_flux_config RECORD;
  v_assigned_room UUID;
  v_preferential_room UUID;
  v_config_room UUID;
  v_ordre INTEGER;
  v_is_exclusive BOOLEAN;
  v_is_priority BOOLEAN;
  v_occupying_operation RECORD;
  v_free_room UUID;
BEGIN
  -- Count operations of this type in this slot
  SELECT COUNT(*) INTO v_count
  FROM planning_genere_bloc_operatoire
  WHERE date = p_date 
    AND periode = p_periode
    AND type_intervention_id = p_type_intervention_id
    AND statut != 'annule'::statut_planning;

  -- STEP 1: Check if this intervention has an EXCLUSIVE room
  SELECT salle_preferentielle, salle_exclusive 
  INTO v_preferential_room, v_is_exclusive
  FROM types_intervention
  WHERE id = p_type_intervention_id;
  
  IF v_is_exclusive AND v_preferential_room IS NOT NULL THEN
    -- Always return the exclusive room, even if occupied by same type
    RETURN v_preferential_room;
  END IF;

  -- STEP 2: Check if this intervention has a PRIORITY room
  SELECT salle_preferentielle, salle_prioritaire 
  INTO v_preferential_room, v_is_priority
  FROM types_intervention
  WHERE id = p_type_intervention_id;
  
  IF v_is_priority AND v_preferential_room IS NOT NULL THEN
    -- Check if priority room is free
    IF NOT EXISTS (
      SELECT 1 FROM planning_genere_bloc_operatoire
      WHERE date = p_date 
        AND periode = p_periode
        AND salle_assignee = v_preferential_room
        AND statut != 'annule'::statut_planning
        AND NOT (type_intervention_id = p_type_intervention_id AND medecin_id = p_medecin_id)
    ) THEN
      -- Room is free, assign it
      RETURN v_preferential_room;
    ELSE
      -- Room is occupied, check if we can displace the occupying operation
      SELECT pgbo.id, pgbo.type_intervention_id, pgbo.medecin_id
      INTO v_occupying_operation
      FROM planning_genere_bloc_operatoire pgbo
      WHERE pgbo.date = p_date 
        AND pgbo.periode = p_periode
        AND pgbo.salle_assignee = v_preferential_room
        AND pgbo.statut != 'annule'::statut_planning
        AND NOT (pgbo.type_intervention_id = p_type_intervention_id AND pgbo.medecin_id = p_medecin_id)
      LIMIT 1;
      
      IF FOUND THEN
        -- Check if occupying operation has exclusive or priority room
        IF NOT EXISTS (
          SELECT 1 FROM types_intervention
          WHERE id = v_occupying_operation.type_intervention_id
            AND (salle_exclusive = true OR salle_prioritaire = true)
        ) THEN
          -- Occupying operation doesn't have priority, we can displace it
          -- Find a free room for the displaced operation
          SELECT so.id INTO v_free_room
          FROM salles_operation so
          WHERE so.id != v_preferential_room
            AND NOT EXISTS (
              SELECT 1 FROM planning_genere_bloc_operatoire
              WHERE date = p_date 
                AND periode = p_periode
                AND salle_assignee = so.id
                AND statut != 'annule'::statut_planning
            )
            AND NOT EXISTS (
              -- Room not exclusive to another type
              SELECT 1 FROM types_intervention
              WHERE salle_preferentielle = so.id
                AND salle_exclusive = true
            )
            AND NOT EXISTS (
              -- Room not priority for another type that's present
              SELECT 1 FROM types_intervention ti
              WHERE ti.salle_preferentielle = so.id
                AND ti.salle_prioritaire = true
                AND EXISTS (
                  SELECT 1 FROM planning_genere_bloc_operatoire
                  WHERE date = p_date 
                    AND periode = p_periode
                    AND type_intervention_id = ti.id
                    AND statut != 'annule'::statut_planning
                )
            )
          ORDER BY so.name
          LIMIT 1;
          
          -- Update the occupying operation (either to free room or NULL)
          UPDATE planning_genere_bloc_operatoire
          SET salle_assignee = v_free_room
          WHERE id = v_occupying_operation.id;
          
          -- Return the priority room
          RETURN v_preferential_room;
        END IF;
      END IF;
    END IF;
  END IF;

  -- STEP 3: Try multi-flux configuration (if applicable)
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
      -- Get order of this operation
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

      -- Get configured room for this order
      SELECT salle INTO v_config_room
      FROM configurations_multi_flux_interventions
      WHERE configuration_id = v_multi_flux_config.id
        AND type_intervention_id = p_type_intervention_id
        AND ordre = v_ordre;

      -- Check if this room is available and not exclusive/priority to another type
      IF v_config_room IS NOT NULL THEN
        IF NOT EXISTS (
          SELECT 1 FROM planning_genere_bloc_operatoire
          WHERE date = p_date 
            AND periode = p_periode
            AND salle_assignee = v_config_room
            AND statut != 'annule'::statut_planning
            AND NOT (type_intervention_id = p_type_intervention_id AND medecin_id = p_medecin_id)
        ) AND NOT EXISTS (
          -- Check room is not exclusive to another type
          SELECT 1 FROM types_intervention
          WHERE salle_preferentielle = v_config_room
            AND salle_exclusive = true
            AND id != p_type_intervention_id
        ) AND NOT EXISTS (
          -- Check room is not priority for another type that's present
          SELECT 1 FROM types_intervention ti
          WHERE ti.salle_preferentielle = v_config_room
            AND ti.salle_prioritaire = true
            AND ti.id != p_type_intervention_id
            AND EXISTS (
              SELECT 1 FROM planning_genere_bloc_operatoire
              WHERE date = p_date 
                AND periode = p_periode
                AND type_intervention_id = ti.id
                AND statut != 'annule'::statut_planning
            )
        ) THEN
          RETURN v_config_room;
        END IF;
      END IF;
    END IF;
  END IF;

  -- STEP 4: Try preferential room if available and not exclusive/priority for another type
  IF v_preferential_room IS NOT NULL AND NOT v_is_exclusive AND NOT v_is_priority THEN
    IF NOT EXISTS (
      SELECT 1 FROM planning_genere_bloc_operatoire
      WHERE date = p_date 
        AND periode = p_periode
        AND salle_assignee = v_preferential_room
        AND statut != 'annule'::statut_planning
        AND NOT (type_intervention_id = p_type_intervention_id AND medecin_id = p_medecin_id)
    ) AND NOT EXISTS (
      -- Room not exclusive to another type
      SELECT 1 FROM types_intervention
      WHERE salle_preferentielle = v_preferential_room
        AND salle_exclusive = true
        AND id != p_type_intervention_id
    ) AND NOT EXISTS (
      -- Room not priority for another type that's present
      SELECT 1 FROM types_intervention ti
      WHERE ti.salle_preferentielle = v_preferential_room
        AND ti.salle_prioritaire = true
        AND ti.id != p_type_intervention_id
        AND EXISTS (
          SELECT 1 FROM planning_genere_bloc_operatoire
          WHERE date = p_date 
            AND periode = p_periode
            AND type_intervention_id = ti.id
            AND statut != 'annule'::statut_planning
        )
    ) THEN
      RETURN v_preferential_room;
    END IF;
  END IF;

  -- STEP 5: Find any free room, excluding exclusive and occupied priority rooms
  SELECT id INTO v_assigned_room
  FROM salles_operation
  WHERE NOT EXISTS (
    -- Room already occupied
    SELECT 1 FROM planning_genere_bloc_operatoire
    WHERE date = p_date 
      AND periode = p_periode
      AND salle_assignee = salles_operation.id
      AND statut != 'annule'::statut_planning
      AND NOT (type_intervention_id = p_type_intervention_id AND medecin_id = p_medecin_id)
  )
  AND NOT EXISTS (
    -- Room exclusive to another type
    SELECT 1 FROM types_intervention
    WHERE salle_preferentielle = salles_operation.id
      AND salle_exclusive = true
      AND id != p_type_intervention_id
  )
  AND NOT EXISTS (
    -- Room priority for another type that's present in this slot
    SELECT 1 FROM types_intervention ti
    WHERE ti.salle_preferentielle = salles_operation.id
      AND ti.salle_prioritaire = true
      AND ti.id != p_type_intervention_id
      AND EXISTS (
        SELECT 1 FROM planning_genere_bloc_operatoire
        WHERE date = p_date 
          AND periode = p_periode
          AND type_intervention_id = ti.id
          AND statut != 'annule'::statut_planning
      )
  )
  ORDER BY name
  LIMIT 1;

  RETURN v_assigned_room;
END;
$function$;

-- Trigger reassignment of all existing rooms
SELECT public.trigger_reassign_all_rooms();