-- Créer une fonction pour mettre à jour le rôle d'un utilisateur sans DELETE/INSERT
CREATE OR REPLACE FUNCTION public.update_user_role_upsert(_user_id uuid, _new_role app_role)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Vérifier que l'utilisateur actuel est admin
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can update user roles';
  END IF;

  -- Utiliser UPSERT (INSERT ... ON CONFLICT DO UPDATE) pour éviter DELETE/INSERT
  INSERT INTO public.user_roles (user_id, role)
  VALUES (_user_id, _new_role)
  ON CONFLICT (user_id, role) 
  DO NOTHING;

  -- Supprimer les autres rôles de cet utilisateur (s'il en avait d'autres)
  DELETE FROM public.user_roles
  WHERE user_id = _user_id
    AND role != _new_role;
END;
$function$;