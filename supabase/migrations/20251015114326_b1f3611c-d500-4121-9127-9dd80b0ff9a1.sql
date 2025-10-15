-- Drop and recreate the swap_secretaries_personnel function to handle full day swaps
DROP FUNCTION IF EXISTS public.swap_secretaries_personnel(uuid, uuid);

CREATE OR REPLACE FUNCTION public.swap_secretaries_personnel(
  p_assignment_id_1 uuid,
  p_assignment_id_2 uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_assignment_1 RECORD;
  v_assignment_2 RECORD;
  v_morning_id_1 UUID;
  v_afternoon_id_1 UUID;
  v_morning_id_2 UUID;
  v_afternoon_id_2 UUID;
  v_is_full_day_1 BOOLEAN := false;
  v_is_full_day_2 BOOLEAN := false;
  v_swap_count INTEGER := 0;
BEGIN
  -- Get both assignments
  SELECT * INTO v_assignment_1
  FROM public.planning_genere_personnel
  WHERE id = p_assignment_id_1;
  
  SELECT * INTO v_assignment_2
  FROM public.planning_genere_personnel
  WHERE id = p_assignment_id_2;
  
  IF v_assignment_1.id IS NULL OR v_assignment_2.id IS NULL THEN
    RAISE EXCEPTION 'Une ou plusieurs assignations introuvables';
  END IF;
  
  -- Check if assignment 1 is part of a full day (same date, same secretary, both periods exist with same site)
  IF v_assignment_1.periode = 'matin' THEN
    SELECT id INTO v_afternoon_id_1
    FROM public.planning_genere_personnel
    WHERE date = v_assignment_1.date
      AND secretaire_id = v_assignment_1.secretaire_id
      AND periode = 'apres_midi'
      AND site_id = v_assignment_1.site_id
      AND type_assignation = v_assignment_1.type_assignation;
    
    IF v_afternoon_id_1 IS NOT NULL THEN
      v_is_full_day_1 := true;
      v_morning_id_1 := v_assignment_1.id;
    END IF;
  ELSIF v_assignment_1.periode = 'apres_midi' THEN
    SELECT id INTO v_morning_id_1
    FROM public.planning_genere_personnel
    WHERE date = v_assignment_1.date
      AND secretaire_id = v_assignment_1.secretaire_id
      AND periode = 'matin'
      AND site_id = v_assignment_1.site_id
      AND type_assignation = v_assignment_1.type_assignation;
    
    IF v_morning_id_1 IS NOT NULL THEN
      v_is_full_day_1 := true;
      v_afternoon_id_1 := v_assignment_1.id;
    END IF;
  END IF;
  
  -- Check if assignment 2 is part of a full day
  IF v_assignment_2.periode = 'matin' THEN
    SELECT id INTO v_afternoon_id_2
    FROM public.planning_genere_personnel
    WHERE date = v_assignment_2.date
      AND secretaire_id = v_assignment_2.secretaire_id
      AND periode = 'apres_midi'
      AND site_id = v_assignment_2.site_id
      AND type_assignation = v_assignment_2.type_assignation;
    
    IF v_afternoon_id_2 IS NOT NULL THEN
      v_is_full_day_2 := true;
      v_morning_id_2 := v_assignment_2.id;
    END IF;
  ELSIF v_assignment_2.periode = 'apres_midi' THEN
    SELECT id INTO v_morning_id_2
    FROM public.planning_genere_personnel
    WHERE date = v_assignment_2.date
      AND secretaire_id = v_assignment_2.secretaire_id
      AND periode = 'matin'
      AND site_id = v_assignment_2.site_id
      AND type_assignation = v_assignment_2.type_assignation;
    
    IF v_morning_id_2 IS NOT NULL THEN
      v_is_full_day_2 := true;
      v_afternoon_id_2 := v_assignment_2.id;
    END IF;
  END IF;
  
  -- Perform the swaps
  IF v_is_full_day_1 AND v_is_full_day_2 THEN
    -- Both are full days: swap all 4 assignments
    UPDATE public.planning_genere_personnel
    SET site_id = v_assignment_2.site_id
    WHERE id IN (v_morning_id_1, v_afternoon_id_1);
    
    UPDATE public.planning_genere_personnel
    SET site_id = v_assignment_1.site_id
    WHERE id IN (v_morning_id_2, v_afternoon_id_2);
    
    v_swap_count := 4;
  ELSIF v_is_full_day_1 THEN
    -- Only assignment 1 is a full day: swap both periods with assignment 2's site
    UPDATE public.planning_genere_personnel
    SET site_id = v_assignment_2.site_id
    WHERE id IN (v_morning_id_1, v_afternoon_id_1);
    
    UPDATE public.planning_genere_personnel
    SET site_id = v_assignment_1.site_id
    WHERE id = p_assignment_id_2;
    
    v_swap_count := 3;
  ELSIF v_is_full_day_2 THEN
    -- Only assignment 2 is a full day: swap assignment 1 with both periods
    UPDATE public.planning_genere_personnel
    SET site_id = v_assignment_2.site_id
    WHERE id = p_assignment_id_1;
    
    UPDATE public.planning_genere_personnel
    SET site_id = v_assignment_1.site_id
    WHERE id IN (v_morning_id_2, v_afternoon_id_2);
    
    v_swap_count := 3;
  ELSE
    -- Neither is a full day: simple swap
    UPDATE public.planning_genere_personnel
    SET site_id = v_assignment_2.site_id
    WHERE id = p_assignment_id_1;
    
    UPDATE public.planning_genere_personnel
    SET site_id = v_assignment_1.site_id
    WHERE id = p_assignment_id_2;
    
    v_swap_count := 2;
  END IF;
  
  RETURN jsonb_build_object(
    'success', true, 
    'message', 'Échange effectué avec succès',
    'swapped_assignments', v_swap_count
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Erreur lors de l''échange: %', SQLERRM;
END;
$function$;