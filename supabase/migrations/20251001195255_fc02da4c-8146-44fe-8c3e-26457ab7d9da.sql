-- Fix type casting issue in trigger functions

-- Recreate trigger function for doctors with proper type casting
CREATE OR REPLACE FUNCTION public.trigger_regenerate_doctor_individual()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_medecin_id uuid;
BEGIN
  v_medecin_id := COALESCE(NEW.medecin_id, OLD.medecin_id);
  
  -- Cast interval result to date
  PERFORM public.recreate_doctor_besoin(
    v_medecin_id, 
    CURRENT_DATE, 
    (CURRENT_DATE + INTERVAL '52 weeks')::date
  );
  
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Recreate trigger function for secretaries with proper type casting
CREATE OR REPLACE FUNCTION public.trigger_regenerate_secretary_individual()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secretaire_id uuid;
BEGIN
  v_secretaire_id := COALESCE(NEW.secretaire_id, OLD.secretaire_id);
  
  -- Cast interval result to date
  PERFORM public.recreate_secretary_capacite(
    v_secretaire_id, 
    CURRENT_DATE, 
    (CURRENT_DATE + INTERVAL '52 weeks')::date
  );
  
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Recreate trigger function for medecins table with proper type casting
CREATE OR REPLACE FUNCTION public.trigger_regenerate_medecin_on_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.actif = true THEN
    PERFORM public.recreate_doctor_besoin(
      NEW.id, 
      CURRENT_DATE, 
      (CURRENT_DATE + INTERVAL '52 weeks')::date
    );
  END IF;
  
  RETURN NEW;
END;
$$;

-- Recreate trigger function for secretaires table with proper type casting
CREATE OR REPLACE FUNCTION public.trigger_regenerate_secretaire_on_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.actif = true THEN
    PERFORM public.recreate_secretary_capacite(
      NEW.id, 
      CURRENT_DATE, 
      (CURRENT_DATE + INTERVAL '52 weeks')::date
    );
  END IF;
  
  RETURN NEW;
END;
$$;