-- Supprimer les anciennes colonnes (la colonne demi_journee existe déjà)
ALTER TABLE public.absences 
DROP COLUMN IF EXISTS heure_debut,
DROP COLUMN IF EXISTS heure_fin;