-- Function to swap two secretaries' assignments for a given date and period
CREATE OR REPLACE FUNCTION public.swap_secretaries(
  p_date DATE,
  p_period TEXT, -- 'matin', 'apres_midi', or 'both'
  p_secretary_id_1 UUID,
  p_secretary_id_2 UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_creneau_1_matin RECORD;
  v_creneau_2_matin RECORD;
  v_creneau_1_am RECORD;
  v_creneau_2_am RECORD;
  v_is_1r_1 BOOLEAN;
  v_is_2f_1 BOOLEAN;
  v_is_1r_2 BOOLEAN;
  v_is_2f_2 BOOLEAN;
  v_is_backup_1 BOOLEAN;
  v_is_backup_2 BOOLEAN;
  v_new_secretaires_1 UUID[];
  v_new_backups_1 UUID[];
  v_new_secretaires_2 UUID[];
  v_new_backups_2 UUID[];
BEGIN
  -- Process morning period if requested
  IF p_period IN ('matin', 'both') THEN
    -- Find creneaux for morning (07:30:00)
    SELECT * INTO v_creneau_1_matin
    FROM public.planning_genere
    WHERE date = p_date
      AND heure_debut = '07:30:00'::time
      AND statut != 'annule'
      AND (p_secretary_id_1 = ANY(secretaires_ids) OR p_secretary_id_1 = ANY(backups_ids) 
           OR responsable_1r_id = p_secretary_id_1 OR responsable_2f_id = p_secretary_id_1);

    SELECT * INTO v_creneau_2_matin
    FROM public.planning_genere
    WHERE date = p_date
      AND heure_debut = '07:30:00'::time
      AND statut != 'annule'
      AND (p_secretary_id_2 = ANY(secretaires_ids) OR p_secretary_id_2 = ANY(backups_ids)
           OR responsable_1r_id = p_secretary_id_2 OR responsable_2f_id = p_secretary_id_2);

    IF v_creneau_1_matin.id IS NOT NULL AND v_creneau_2_matin.id IS NOT NULL THEN
      -- Determine roles and types for secretary 1
      v_is_1r_1 := (v_creneau_1_matin.responsable_1r_id = p_secretary_id_1);
      v_is_2f_1 := (v_creneau_1_matin.responsable_2f_id = p_secretary_id_1);
      v_is_backup_1 := (p_secretary_id_1 = ANY(v_creneau_1_matin.backups_ids));

      -- Determine roles and types for secretary 2
      v_is_1r_2 := (v_creneau_2_matin.responsable_1r_id = p_secretary_id_2);
      v_is_2f_2 := (v_creneau_2_matin.responsable_2f_id = p_secretary_id_2);
      v_is_backup_2 := (p_secretary_id_2 = ANY(v_creneau_2_matin.backups_ids));

      -- Phase 1: Remove both secretaries from their current creneaux
      -- Remove secretary 1 from creneau 1
      v_new_secretaires_1 := array_remove(v_creneau_1_matin.secretaires_ids, p_secretary_id_1);
      v_new_backups_1 := array_remove(v_creneau_1_matin.backups_ids, p_secretary_id_1);
      
      UPDATE public.planning_genere
      SET 
        secretaires_ids = v_new_secretaires_1,
        backups_ids = v_new_backups_1,
        responsable_1r_id = CASE WHEN v_is_1r_1 THEN NULL ELSE responsable_1r_id END,
        responsable_2f_id = CASE WHEN v_is_2f_1 THEN NULL ELSE responsable_2f_id END
      WHERE id = v_creneau_1_matin.id;

      -- Remove secretary 2 from creneau 2
      v_new_secretaires_2 := array_remove(v_creneau_2_matin.secretaires_ids, p_secretary_id_2);
      v_new_backups_2 := array_remove(v_creneau_2_matin.backups_ids, p_secretary_id_2);
      
      UPDATE public.planning_genere
      SET 
        secretaires_ids = v_new_secretaires_2,
        backups_ids = v_new_backups_2,
        responsable_1r_id = CASE WHEN v_is_1r_2 THEN NULL ELSE responsable_1r_id END,
        responsable_2f_id = CASE WHEN v_is_2f_2 THEN NULL ELSE responsable_2f_id END
      WHERE id = v_creneau_2_matin.id;

      -- Phase 2: Add secretaries to their new creneaux
      -- Add secretary 2 to creneau 1 (with secretary 1's roles)
      IF v_is_backup_1 THEN
        v_new_backups_1 := array_append(v_new_backups_1, p_secretary_id_2);
      ELSE
        v_new_secretaires_1 := array_append(v_new_secretaires_1, p_secretary_id_2);
      END IF;

      UPDATE public.planning_genere
      SET 
        secretaires_ids = v_new_secretaires_1,
        backups_ids = v_new_backups_1,
        responsable_1r_id = CASE WHEN v_is_1r_1 THEN p_secretary_id_2 ELSE responsable_1r_id END,
        responsable_2f_id = CASE WHEN v_is_2f_1 THEN p_secretary_id_2 ELSE responsable_2f_id END
      WHERE id = v_creneau_1_matin.id;

      -- Add secretary 1 to creneau 2 (with secretary 2's roles)
      IF v_is_backup_2 THEN
        v_new_backups_2 := array_append(v_new_backups_2, p_secretary_id_1);
      ELSE
        v_new_secretaires_2 := array_append(v_new_secretaires_2, p_secretary_id_1);
      END IF;

      UPDATE public.planning_genere
      SET 
        secretaires_ids = v_new_secretaires_2,
        backups_ids = v_new_backups_2,
        responsable_1r_id = CASE WHEN v_is_1r_2 THEN p_secretary_id_1 ELSE responsable_1r_id END,
        responsable_2f_id = CASE WHEN v_is_2f_2 THEN p_secretary_id_1 ELSE responsable_2f_id END
      WHERE id = v_creneau_2_matin.id;
    END IF;
  END IF;

  -- Process afternoon period if requested
  IF p_period IN ('apres_midi', 'both') THEN
    -- Find creneaux for afternoon (13:00:00)
    SELECT * INTO v_creneau_1_am
    FROM public.planning_genere
    WHERE date = p_date
      AND heure_debut = '13:00:00'::time
      AND statut != 'annule'
      AND (p_secretary_id_1 = ANY(secretaires_ids) OR p_secretary_id_1 = ANY(backups_ids)
           OR responsable_1r_id = p_secretary_id_1 OR responsable_2f_id = p_secretary_id_1);

    SELECT * INTO v_creneau_2_am
    FROM public.planning_genere
    WHERE date = p_date
      AND heure_debut = '13:00:00'::time
      AND statut != 'annule'
      AND (p_secretary_id_2 = ANY(secretaires_ids) OR p_secretary_id_2 = ANY(backups_ids)
           OR responsable_1r_id = p_secretary_id_2 OR responsable_2f_id = p_secretary_id_2);

    IF v_creneau_1_am.id IS NOT NULL AND v_creneau_2_am.id IS NOT NULL THEN
      -- Determine roles and types for secretary 1
      v_is_1r_1 := (v_creneau_1_am.responsable_1r_id = p_secretary_id_1);
      v_is_2f_1 := (v_creneau_1_am.responsable_2f_id = p_secretary_id_1);
      v_is_backup_1 := (p_secretary_id_1 = ANY(v_creneau_1_am.backups_ids));

      -- Determine roles and types for secretary 2
      v_is_1r_2 := (v_creneau_2_am.responsable_1r_id = p_secretary_id_2);
      v_is_2f_2 := (v_creneau_2_am.responsable_2f_id = p_secretary_id_2);
      v_is_backup_2 := (p_secretary_id_2 = ANY(v_creneau_2_am.backups_ids));

      -- Phase 1: Remove both secretaries from their current creneaux
      -- Remove secretary 1 from creneau 1
      v_new_secretaires_1 := array_remove(v_creneau_1_am.secretaires_ids, p_secretary_id_1);
      v_new_backups_1 := array_remove(v_creneau_1_am.backups_ids, p_secretary_id_1);
      
      UPDATE public.planning_genere
      SET 
        secretaires_ids = v_new_secretaires_1,
        backups_ids = v_new_backups_1,
        responsable_1r_id = CASE WHEN v_is_1r_1 THEN NULL ELSE responsable_1r_id END,
        responsable_2f_id = CASE WHEN v_is_2f_1 THEN NULL ELSE responsable_2f_id END
      WHERE id = v_creneau_1_am.id;

      -- Remove secretary 2 from creneau 2
      v_new_secretaires_2 := array_remove(v_creneau_2_am.secretaires_ids, p_secretary_id_2);
      v_new_backups_2 := array_remove(v_creneau_2_am.backups_ids, p_secretary_id_2);
      
      UPDATE public.planning_genere
      SET 
        secretaires_ids = v_new_secretaires_2,
        backups_ids = v_new_backups_2,
        responsable_1r_id = CASE WHEN v_is_1r_2 THEN NULL ELSE responsable_1r_id END,
        responsable_2f_id = CASE WHEN v_is_2f_2 THEN NULL ELSE responsable_2f_id END
      WHERE id = v_creneau_2_am.id;

      -- Phase 2: Add secretaries to their new creneaux
      -- Add secretary 2 to creneau 1 (with secretary 1's roles)
      IF v_is_backup_1 THEN
        v_new_backups_1 := array_append(v_new_backups_1, p_secretary_id_2);
      ELSE
        v_new_secretaires_1 := array_append(v_new_secretaires_1, p_secretary_id_2);
      END IF;

      UPDATE public.planning_genere
      SET 
        secretaires_ids = v_new_secretaires_1,
        backups_ids = v_new_backups_1,
        responsable_1r_id = CASE WHEN v_is_1r_1 THEN p_secretary_id_2 ELSE responsable_1r_id END,
        responsable_2f_id = CASE WHEN v_is_2f_1 THEN p_secretary_id_2 ELSE responsable_2f_id END
      WHERE id = v_creneau_1_am.id;

      -- Add secretary 1 to creneau 2 (with secretary 2's roles)
      IF v_is_backup_2 THEN
        v_new_backups_2 := array_append(v_new_backups_2, p_secretary_id_1);
      ELSE
        v_new_secretaires_2 := array_append(v_new_secretaires_2, p_secretary_id_1);
      END IF;

      UPDATE public.planning_genere
      SET 
        secretaires_ids = v_new_secretaires_2,
        backups_ids = v_new_backups_2,
        responsable_1r_id = CASE WHEN v_is_1r_2 THEN p_secretary_id_1 ELSE responsable_1r_id END,
        responsable_2f_id = CASE WHEN v_is_2f_2 THEN p_secretary_id_1 ELSE responsable_2f_id END
      WHERE id = v_creneau_2_am.id;
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'message', 'Échange effectué avec succès');
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Erreur lors de l''échange: %', SQLERRM;
END;
$$;