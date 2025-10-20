-- Fonction pour nettoyer les colonnes bloc opératoire si le site n'est pas le bloc
CREATE OR REPLACE FUNCTION public.cleanup_bloc_columns_on_site_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bloc_site_id UUID;
BEGIN
  -- Récupérer l'UUID du site bloc opératoire
  SELECT id INTO v_bloc_site_id 
  FROM public.sites 
  WHERE nom = 'Clinique La Vallée - Bloc opératoire' 
  LIMIT 1;
  
  -- Si le site n'est pas le bloc opératoire, nettoyer les colonnes
  IF NEW.site_id IS DISTINCT FROM v_bloc_site_id THEN
    NEW.planning_genere_bloc_operatoire_id := NULL;
    NEW.besoin_operation_id := NULL;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Créer le trigger sur INSERT et UPDATE
DROP TRIGGER IF EXISTS cleanup_bloc_on_capacite_effective ON public.capacite_effective;

CREATE TRIGGER cleanup_bloc_on_capacite_effective
  BEFORE INSERT OR UPDATE ON public.capacite_effective
  FOR EACH ROW
  EXECUTE FUNCTION public.cleanup_bloc_columns_on_site_change();