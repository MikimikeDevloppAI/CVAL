-- Fix search_path security warning for check_horaire_secretaire_overlap
CREATE OR REPLACE FUNCTION public.check_horaire_secretaire_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_overlap_count INTEGER;
  v_existing_horaire TEXT;
BEGIN
  -- Check for overlapping schedules for the same secretary on the same day
  SELECT COUNT(*), MAX(
    CASE demi_journee
      WHEN 'toute_journee' THEN 'Journée complète'
      WHEN 'matin' THEN 'Matin'
      WHEN 'apres_midi' THEN 'Après-midi'
    END || 
    COALESCE(' - ' || (SELECT nom FROM public.sites WHERE id = site_id), '')
  )
  INTO v_overlap_count, v_existing_horaire
  FROM public.horaires_base_secretaires
  WHERE secretaire_id = NEW.secretaire_id
    AND jour_semaine = NEW.jour_semaine
    AND actif = true
    AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND (
      -- Check if new schedule conflicts with existing ones
      (NEW.demi_journee = 'toute_journee') OR
      (demi_journee = 'toute_journee') OR
      (NEW.demi_journee = demi_journee)
    );
  
  IF v_overlap_count > 0 THEN
    RAISE EXCEPTION 'Cette secrétaire a déjà un horaire qui chevauche sur ce jour: %. Veuillez modifier ou supprimer l''horaire existant avant d''ajouter un nouveau.', 
      v_existing_horaire;
  END IF;
  
  RETURN NEW;
END;
$$;