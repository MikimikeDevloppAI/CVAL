-- Remove role column from profiles table since we now use user_roles
ALTER TABLE public.profiles DROP COLUMN IF EXISTS role;

-- Update handle_new_user trigger to only insert into user_roles
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Create profile without role
  INSERT INTO public.profiles (id, prenom, nom, email, planning)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'prenom', ''),
    COALESCE(NEW.raw_user_meta_data->>'nom', ''),
    NEW.email,
    COALESCE((NEW.raw_user_meta_data->>'planning')::boolean, false)
  );
  
  -- Assign role in user_roles table only
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, COALESCE((NEW.raw_user_meta_data->>'role')::app_role, 'secretaire'::app_role));
  
  RETURN NEW;
END;
$$;