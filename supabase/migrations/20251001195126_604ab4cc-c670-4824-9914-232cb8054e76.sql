-- Drop old triggers
DROP TRIGGER IF EXISTS trigger_generate_besoin_on_horaire_insert ON public.horaires_base_medecins;
DROP TRIGGER IF EXISTS trigger_generate_besoin_on_horaire_update ON public.horaires_base_medecins;
DROP TRIGGER IF EXISTS trigger_generate_besoin_on_horaire_delete ON public.horaires_base_medecins;
DROP TRIGGER IF EXISTS trigger_generate_capacite_on_horaire_insert ON public.horaires_base_secretaires;
DROP TRIGGER IF EXISTS trigger_generate_capacite_on_horaire_update ON public.horaires_base_secretaires;
DROP TRIGGER IF EXISTS trigger_generate_capacite_on_horaire_delete ON public.horaires_base_secretaires;

-- Drop old trigger functions
DROP FUNCTION IF EXISTS public.trigger_generate_besoin();
DROP FUNCTION IF EXISTS public.trigger_generate_capacite();

-- Create individual regeneration trigger function for doctors
CREATE OR REPLACE FUNCTION public.trigger_regenerate_doctor_individual()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_medecin_id uuid;
BEGIN
  -- Get medecin_id from NEW or OLD record
  v_medecin_id := COALESCE(NEW.medecin_id, OLD.medecin_id);
  
  -- Regenerate only for this doctor
  PERFORM public.recreate_doctor_besoin(v_medecin_id, CURRENT_DATE, CURRENT_DATE + INTERVAL '52 weeks');
  
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Create individual regeneration trigger function for secretaries
CREATE OR REPLACE FUNCTION public.trigger_regenerate_secretary_individual()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secretaire_id uuid;
BEGIN
  -- Get secretaire_id from NEW or OLD record
  v_secretaire_id := COALESCE(NEW.secretaire_id, OLD.secretaire_id);
  
  -- Regenerate only for this secretary
  PERFORM public.recreate_secretary_capacite(v_secretaire_id, CURRENT_DATE, CURRENT_DATE + INTERVAL '52 weeks');
  
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Create trigger function for medecins table changes
CREATE OR REPLACE FUNCTION public.trigger_regenerate_medecin_on_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only regenerate if doctor is active
  IF NEW.actif = true THEN
    PERFORM public.recreate_doctor_besoin(NEW.id, CURRENT_DATE, CURRENT_DATE + INTERVAL '52 weeks');
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger function for secretaires table changes
CREATE OR REPLACE FUNCTION public.trigger_regenerate_secretaire_on_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only regenerate if secretary is active
  IF NEW.actif = true THEN
    PERFORM public.recreate_secretary_capacite(NEW.id, CURRENT_DATE, CURRENT_DATE + INTERVAL '52 weeks');
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create triggers for horaires_base_medecins (individual regeneration)
CREATE TRIGGER trigger_regenerate_doctor_on_horaire_change
AFTER INSERT OR UPDATE OR DELETE ON public.horaires_base_medecins
FOR EACH ROW
EXECUTE FUNCTION public.trigger_regenerate_doctor_individual();

-- Create triggers for horaires_base_secretaires (individual regeneration)
CREATE TRIGGER trigger_regenerate_secretary_on_horaire_change
AFTER INSERT OR UPDATE OR DELETE ON public.horaires_base_secretaires
FOR EACH ROW
EXECUTE FUNCTION public.trigger_regenerate_secretary_individual();

-- Create triggers for medecins table (INSERT and UPDATE)
CREATE TRIGGER trigger_regenerate_medecin_on_insert_or_update
AFTER INSERT OR UPDATE ON public.medecins
FOR EACH ROW
EXECUTE FUNCTION public.trigger_regenerate_medecin_on_change();

-- Create triggers for secretaires table (INSERT and UPDATE)
CREATE TRIGGER trigger_regenerate_secretaire_on_insert_or_update
AFTER INSERT OR UPDATE ON public.secretaires
FOR EACH ROW
EXECUTE FUNCTION public.trigger_regenerate_secretaire_on_change();