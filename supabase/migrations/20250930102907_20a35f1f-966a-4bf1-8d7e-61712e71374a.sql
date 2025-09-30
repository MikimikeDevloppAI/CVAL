-- Fix security warnings by setting search_path on new functions

CREATE OR REPLACE FUNCTION public.create_besoin_from_bloc(p_bloc_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_bloc RECORD;
BEGIN
  SELECT * INTO v_bloc
  FROM public.bloc_operatoire_besoins
  WHERE id = p_bloc_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

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
    (SELECT id FROM public.sites LIMIT 1),
    v_bloc.specialite_id,
    v_bloc.heure_debut,
    v_bloc.heure_fin,
    v_bloc.nombre_secretaires_requis
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_bloc_operatoire_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  PERFORM public.create_besoin_from_bloc(NEW.id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_bloc_operatoire_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  DELETE FROM public.besoin_effectif
  WHERE bloc_operatoire_besoin_id = OLD.id;

  PERFORM public.create_besoin_from_bloc(NEW.id);
  
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_bloc_operatoire_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  DELETE FROM public.besoin_effectif
  WHERE bloc_operatoire_besoin_id = OLD.id;
  
  RETURN OLD;
END;
$$;