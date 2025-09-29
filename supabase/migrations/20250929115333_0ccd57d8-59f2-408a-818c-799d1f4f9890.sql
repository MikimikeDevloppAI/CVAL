-- Add INSERT policy for profiles table to allow profile creation
CREATE POLICY "Admins can insert profiles" 
ON public.profiles 
FOR INSERT 
WITH CHECK (is_admin());