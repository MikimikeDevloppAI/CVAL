-- Retirer la colonne specialite_id de la table sites
ALTER TABLE public.sites DROP COLUMN IF EXISTS specialite_id;