-- =====================================================
-- TRIGGERS TO DELETE SCHEDULES WHEN STAFF BECOMES INACTIVE
-- =====================================================

-- Function to handle medecin status change
CREATE OR REPLACE FUNCTION public.handle_medecin_inactif()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- If medecin becomes inactive, delete all their schedules
  IF OLD.actif = true AND NEW.actif = false THEN
    DELETE FROM public.horaires_base_medecins
    WHERE medecin_id = NEW.id;
    
    -- Note: The DELETE triggers on horaires_base_medecins will automatically
    -- clean up besoin_effectif entries
  END IF;
  
  RETURN NEW;
END;
$function$;

-- Function to handle secretaire status change
CREATE OR REPLACE FUNCTION public.handle_secretaire_inactif()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- If secretaire becomes inactive, delete all their schedules
  IF OLD.actif = true AND NEW.actif = false THEN
    DELETE FROM public.horaires_base_secretaires
    WHERE secretaire_id = NEW.id;
    
    -- Note: The DELETE triggers on horaires_base_secretaires will automatically
    -- clean up capacite_effective entries
  END IF;
  
  RETURN NEW;
END;
$function$;

-- Create triggers
DROP TRIGGER IF EXISTS trigger_medecin_inactif ON public.medecins;
CREATE TRIGGER trigger_medecin_inactif
  AFTER UPDATE ON public.medecins
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_medecin_inactif();

DROP TRIGGER IF EXISTS trigger_secretaire_inactif ON public.secretaires;
CREATE TRIGGER trigger_secretaire_inactif
  AFTER UPDATE ON public.secretaires
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_secretaire_inactif();