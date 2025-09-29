-- Ajouter les colonnes manquantes à la table secretaires
ALTER TABLE public.secretaires 
ADD COLUMN prefere_port_en_truie BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN flexible_jours_supplementaires BOOLEAN NOT NULL DEFAULT FALSE;