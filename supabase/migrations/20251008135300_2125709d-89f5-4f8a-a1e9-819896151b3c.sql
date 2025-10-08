-- Créer une fonction de sécurité qui vérifie planning=true OU admin
CREATE OR REPLACE FUNCTION public.has_planning_or_admin_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT planning FROM public.profiles WHERE id = auth.uid()),
    FALSE
  ) OR public.has_role(auth.uid(), 'admin'::app_role);
$$;

-- Sécuriser la table backup
DROP POLICY IF EXISTS "Users can view all backup" ON public.backup;
CREATE POLICY "Users with planning or admin can view backup"
ON public.backup FOR SELECT
TO authenticated
USING (public.has_planning_or_admin_access());

-- Sécuriser la table besoin_effectif
DROP POLICY IF EXISTS "Users can view besoin_effectif" ON public.besoin_effectif;
CREATE POLICY "Users with planning or admin can view besoin_effectif"
ON public.besoin_effectif FOR SELECT
TO authenticated
USING (public.has_planning_or_admin_access());

-- Sécuriser la table besoins_sites
DROP POLICY IF EXISTS "Users can view besoins sites" ON public.besoins_sites;
CREATE POLICY "Users with planning or admin can view besoins sites"
ON public.besoins_sites FOR SELECT
TO authenticated
USING (public.has_planning_or_admin_access());

-- Sécuriser la table bloc_operatoire_besoins
DROP POLICY IF EXISTS "Users can view bloc operatoire besoins" ON public.bloc_operatoire_besoins;
CREATE POLICY "Users with planning or admin can view bloc operatoire besoins"
ON public.bloc_operatoire_besoins FOR SELECT
TO authenticated
USING (public.has_planning_or_admin_access());

-- Sécuriser la table capacite_effective
DROP POLICY IF EXISTS "Users can view capacite_effective" ON public.capacite_effective;
CREATE POLICY "Users with planning or admin can view capacite_effective"
ON public.capacite_effective FOR SELECT
TO authenticated
USING (public.has_planning_or_admin_access());

-- Sécuriser la table horaires_base_medecins
DROP POLICY IF EXISTS "Users can view all horaires medecins" ON public.horaires_base_medecins;
CREATE POLICY "Users with planning or admin can view horaires medecins"
ON public.horaires_base_medecins FOR SELECT
TO authenticated
USING (public.has_planning_or_admin_access());

-- Sécuriser la table horaires_base_secretaires
DROP POLICY IF EXISTS "Users can view all horaires secretaires" ON public.horaires_base_secretaires;
CREATE POLICY "Users with planning or admin can view horaires secretaires"
ON public.horaires_base_secretaires FOR SELECT
TO authenticated
USING (public.has_planning_or_admin_access());

-- Sécuriser la table horaires_effectifs
DROP POLICY IF EXISTS "Users can view all horaires effectifs" ON public.horaires_effectifs;
CREATE POLICY "Users with planning or admin can view horaires effectifs"
ON public.horaires_effectifs FOR SELECT
TO authenticated
USING (public.has_planning_or_admin_access());

-- Sécuriser la table medecins
DROP POLICY IF EXISTS "Users can view all medecins" ON public.medecins;
CREATE POLICY "Users with planning or admin can view medecins"
ON public.medecins FOR SELECT
TO authenticated
USING (public.has_planning_or_admin_access());

-- Sécuriser la table optimisation_horaires_base
DROP POLICY IF EXISTS "Users can view optimisation results" ON public.optimisation_horaires_base;
CREATE POLICY "Users with planning or admin can view optimisation results"
ON public.optimisation_horaires_base FOR SELECT
TO authenticated
USING (public.has_planning_or_admin_access());

-- Sécuriser la table planning
DROP POLICY IF EXISTS "Users can view all planning metadata" ON public.planning;
CREATE POLICY "Users with planning or admin can view planning metadata"
ON public.planning FOR SELECT
TO authenticated
USING (public.has_planning_or_admin_access());

-- Sécuriser la table planning_genere
DROP POLICY IF EXISTS "Users can view all planning" ON public.planning_genere;
CREATE POLICY "Users with planning or admin can view planning"
ON public.planning_genere FOR SELECT
TO authenticated
USING (public.has_planning_or_admin_access());

-- Sécuriser la table secretaires
DROP POLICY IF EXISTS "Users can view all secretaires" ON public.secretaires;
CREATE POLICY "Users with planning or admin can view secretaires"
ON public.secretaires FOR SELECT
TO authenticated
USING (public.has_planning_or_admin_access());

-- Sécuriser la table sites
DROP POLICY IF EXISTS "Users can view all sites" ON public.sites;
CREATE POLICY "Users with planning or admin can view sites"
ON public.sites FOR SELECT
TO authenticated
USING (public.has_planning_or_admin_access());

-- Sécuriser la table specialites
DROP POLICY IF EXISTS "Users can view all specialites" ON public.specialites;
CREATE POLICY "Users with planning or admin can view specialites"
ON public.specialites FOR SELECT
TO authenticated
USING (public.has_planning_or_admin_access());

-- Sécuriser la table user_roles (vue par les utilisateurs authentifiés)
DROP POLICY IF EXISTS "Anyone can view roles" ON public.user_roles;
CREATE POLICY "Authenticated users can view roles"
ON public.user_roles FOR SELECT
TO authenticated
USING (true);