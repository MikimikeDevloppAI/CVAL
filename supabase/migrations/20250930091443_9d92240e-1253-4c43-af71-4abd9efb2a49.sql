-- Update handle_absence_changes to only delete affected rows, not regenerate everything
-- Regeneration will be done manually after all inserts/updates
CREATE OR REPLACE FUNCTION public.handle_absence_changes()
RETURNS trigger AS $function$
DECLARE
  v_start_date date := NEW.date_debut;
  v_end_date date := NEW.date_fin;
  v_current_date date;
BEGIN
  IF NEW.type_personne = 'medecin' THEN
    -- Only delete affected dates, don't regenerate yet
    v_current_date := v_start_date;
    WHILE v_current_date <= v_end_date LOOP
      DELETE FROM public.besoin_effectif
      WHERE medecin_id = COALESCE(NEW.medecin_id, OLD.medecin_id)
        AND date = v_current_date;
      v_current_date := v_current_date + INTERVAL '1 day';
    END LOOP;
  ELSIF NEW.type_personne = 'secretaire' THEN
    -- Only delete affected dates, don't regenerate yet
    v_current_date := v_start_date;
    WHILE v_current_date <= v_end_date LOOP
      DELETE FROM public.capacite_effective
      WHERE secretaire_id = COALESCE(NEW.secretaire_id, OLD.secretaire_id)
        AND date = v_current_date;
      v_current_date := v_current_date + INTERVAL '1 day';
    END LOOP;
  END IF;
  
  RETURN NEW;
END;
$function$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Keep deletion trigger with full regeneration since it's a single operation
-- No change needed for handle_absence_deletion