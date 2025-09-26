-- Corriger la fonction get_current_user_role pour la sécurité
CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS public.user_role 
LANGUAGE SQL 
SECURITY DEFINER 
STABLE 
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

-- Corriger la fonction is_admin pour la sécurité  
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN 
LANGUAGE SQL 
SECURITY DEFINER 
STABLE 
SET search_path = public
AS $$
  SELECT COALESCE(public.get_current_user_role() = 'admin', FALSE);
$$;