-- Ajouter la colonne actif à la table sites
ALTER TABLE public.sites 
ADD COLUMN actif BOOLEAN NOT NULL DEFAULT true;