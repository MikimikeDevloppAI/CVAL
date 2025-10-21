-- Fix handle_absence_creation to only delete capacities without regenerating
CREATE OR REPLACE FUNCTION public.handle_absence_creation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_current_date date;
BEGIN
  IF NEW.type_personne = 'medecin' THEN
    v_current_date := NEW.date_debut;
    WHILE v_current_date <= NEW.date_fin LOOP
      DELETE FROM public.besoin_effectif
      WHERE medecin_id = NEW.medecin_id AND date = v_current_date;
      v_current_date := v_current_date + INTERVAL '1 day';
    END LOOP;
    -- Removed recreate_doctor_besoin call - only delete on creation
  ELSIF NEW.type_personne = 'secretaire' THEN
    v_current_date := NEW.date_debut;
    WHILE v_current_date <= NEW.date_fin LOOP
      DELETE FROM public.capacite_effective
      WHERE secretaire_id = NEW.secretaire_id AND date = v_current_date;
      v_current_date := v_current_date + INTERVAL '1 day';
    END LOOP;
    -- Removed recreate_secretary_capacite call - only delete on creation
  END IF;
  RETURN NEW;
END;
$function$;