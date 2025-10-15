-- Create a new function to swap secretaries based on planning_genere_personnel
CREATE OR REPLACE FUNCTION public.swap_secretaries_personnel(
  p_assignment_id_1 UUID,
  p_assignment_id_2 UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_assignment_1 RECORD;
  v_assignment_2 RECORD;
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
  
  -- Swap sites and keep responsibilities
  UPDATE public.planning_genere_personnel
  SET site_id = v_assignment_2.site_id
  WHERE id = p_assignment_id_1;
  
  UPDATE public.planning_genere_personnel
  SET site_id = v_assignment_1.site_id
  WHERE id = p_assignment_id_2;
  
  RETURN jsonb_build_object('success', true, 'message', 'Échange effectué avec succès');
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Erreur lors de l''échange: %', SQLERRM;
END;
$$;