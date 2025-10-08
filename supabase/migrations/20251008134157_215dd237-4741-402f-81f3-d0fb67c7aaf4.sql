-- Étape 1: Corriger les RLS sur la table profiles
-- Supprimer la politique publique dangereuse
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;

-- Créer une politique sécurisée : chaque utilisateur authentifié ne peut lire que son propre profil
CREATE POLICY "Users can view own profile"
ON public.profiles
FOR SELECT
TO authenticated
USING (auth.uid() = id);

-- Étape 2: Corriger les RLS sur la table absences
-- Supprimer la politique publique dangereuse
DROP POLICY IF EXISTS "Users can view all absences" ON public.absences;

-- Créer une politique sécurisée : seuls les utilisateurs avec planning=true peuvent lire les absences
CREATE POLICY "Users with planning access can view absences"
ON public.absences
FOR SELECT
TO authenticated
USING (public.has_planning_access());