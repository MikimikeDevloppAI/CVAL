-- Ajouter les colonnes prefered_admin et personnel_bloc à la table secretaires
ALTER TABLE public.secretaires
  ADD COLUMN prefered_admin BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN personnel_bloc BOOLEAN NOT NULL DEFAULT false;

-- Mettre à jour les commentaires pour documenter ces colonnes
COMMENT ON COLUMN public.secretaires.prefered_admin IS 'Indique si la secrétaire préfère les assignations administratives';
COMMENT ON COLUMN public.secretaires.personnel_bloc IS 'Indique si la secrétaire fait partie du personnel de bloc opératoire';