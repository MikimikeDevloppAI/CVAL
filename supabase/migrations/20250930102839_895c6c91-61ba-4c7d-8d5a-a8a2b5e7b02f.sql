-- Fonction pour créer une ligne dans besoin_effectif à partir d'un besoin bloc opératoire
CREATE OR REPLACE FUNCTION public.create_besoin_from_bloc(p_bloc_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_bloc RECORD;
BEGIN
  -- Récupérer les informations du bloc opératoire
  SELECT * INTO v_bloc
  FROM public.bloc_operatoire_besoins
  WHERE id = p_bloc_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Créer la ligne dans besoin_effectif
  INSERT INTO public.besoin_effectif (
    date,
    type,
    bloc_operatoire_besoin_id,
    site_id,
    specialite_id,
    heure_debut,
    heure_fin,
    nombre_secretaires_requis
  )
  VALUES (
    v_bloc.date,
    'bloc_operatoire',
    v_bloc.id,
    (SELECT id FROM public.sites LIMIT 1), -- Site par défaut, à ajuster si besoin
    v_bloc.specialite_id,
    v_bloc.heure_debut,
    v_bloc.heure_fin,
    v_bloc.nombre_secretaires_requis
  );
END;
$$;

-- Trigger AFTER INSERT: créer la ligne dans besoin_effectif
CREATE OR REPLACE FUNCTION public.handle_bloc_operatoire_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM public.create_besoin_from_bloc(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_bloc_operatoire_after_insert ON public.bloc_operatoire_besoins;
CREATE TRIGGER tr_bloc_operatoire_after_insert
  AFTER INSERT ON public.bloc_operatoire_besoins
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_bloc_operatoire_insert();

-- Trigger AFTER UPDATE: supprimer l'ancienne ligne et créer la nouvelle
CREATE OR REPLACE FUNCTION public.handle_bloc_operatoire_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Supprimer l'ancienne ligne
  DELETE FROM public.besoin_effectif
  WHERE bloc_operatoire_besoin_id = OLD.id;

  -- Créer la nouvelle ligne
  PERFORM public.create_besoin_from_bloc(NEW.id);
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_bloc_operatoire_after_update ON public.bloc_operatoire_besoins;
CREATE TRIGGER tr_bloc_operatoire_after_update
  AFTER UPDATE ON public.bloc_operatoire_besoins
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_bloc_operatoire_update();

-- Trigger AFTER DELETE: supprimer la ligne dans besoin_effectif
CREATE OR REPLACE FUNCTION public.handle_bloc_operatoire_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.besoin_effectif
  WHERE bloc_operatoire_besoin_id = OLD.id;
  
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS tr_bloc_operatoire_after_delete ON public.bloc_operatoire_besoins;
CREATE TRIGGER tr_bloc_operatoire_after_delete
  AFTER DELETE ON public.bloc_operatoire_besoins
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_bloc_operatoire_delete();