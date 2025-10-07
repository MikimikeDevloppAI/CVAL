-- Fix the infinite recursion in user_roles RLS policy
-- The policy was querying user_roles itself, causing recursion
-- We must use the SECURITY DEFINER function instead

DROP POLICY IF EXISTS "Only admins can manage roles" ON public.user_roles;

-- Create a new policy that uses the security definer function
-- This bypasses RLS and prevents infinite recursion
CREATE POLICY "Only admins can manage roles"
ON public.user_roles FOR ALL
USING (public.has_role(auth.uid(), 'admin'::app_role));