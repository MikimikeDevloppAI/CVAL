-- Ajouter les politiques RLS pour la table salles_operation

-- Activer RLS si ce n'est pas déjà fait
ALTER TABLE public.salles_operation ENABLE ROW LEVEL SECURITY;

-- Politique pour permettre la lecture à tous les utilisateurs avec accès au planning
CREATE POLICY "Users with planning or admin can view salles_operation"
ON public.salles_operation
FOR SELECT
USING (has_planning_or_admin_access());

-- Politique pour permettre la gestion (INSERT, UPDATE, DELETE) aux utilisateurs avec accès au planning
CREATE POLICY "Users with planning access can manage salles_operation"
ON public.salles_operation
FOR ALL
USING (has_planning_access())
WITH CHECK (has_planning_access());