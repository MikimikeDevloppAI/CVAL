-- Create trigger function for absence deletion
CREATE OR REPLACE FUNCTION public.handle_absence_deletion()
RETURNS trigger AS $function$
DECLARE
  v_start_date date := OLD.date_debut;
  v_end_date date := OLD.date_fin;
  v_current_date date;
BEGIN
  IF OLD.type_personne = 'medecin' THEN
    -- Delete and regenerate besoin_effectif for the affected dates
    v_current_date := v_start_date;
    WHILE v_current_date <= v_end_date LOOP
      DELETE FROM public.besoin_effectif
      WHERE medecin_id = OLD.medecin_id
        AND date = v_current_date;
      v_current_date := v_current_date + INTERVAL '1 day';
    END LOOP;
    -- Regenerate for all 5 weeks
    PERFORM public.generate_besoin_effectif();
  ELSIF OLD.type_personne = 'secretaire' THEN
    -- Delete and regenerate capacite_effective for the affected dates
    v_current_date := v_start_date;
    WHILE v_current_date <= v_end_date LOOP
      DELETE FROM public.capacite_effective
      WHERE secretaire_id = OLD.secretaire_id
        AND date = v_current_date;
      v_current_date := v_current_date + INTERVAL '1 day';
    END LOOP;
    -- Regenerate for all 5 weeks
    PERFORM public.generate_capacite_effective();
  END IF;
  
  RETURN OLD;
END;
$function$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger for absence deletion
DROP TRIGGER IF EXISTS tr_absences_after_delete ON public.absences;
CREATE TRIGGER tr_absences_after_delete
AFTER DELETE ON public.absences
FOR EACH ROW EXECUTE FUNCTION public.handle_absence_deletion();