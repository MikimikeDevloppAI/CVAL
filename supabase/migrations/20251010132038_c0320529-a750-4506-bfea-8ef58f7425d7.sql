-- Add new boolean fields to secretaires table
ALTER TABLE public.secretaires
ADD COLUMN personnel_bloc_operatoire boolean NOT NULL DEFAULT false,
ADD COLUMN assignation_administrative boolean NOT NULL DEFAULT false,
ADD COLUMN anesthesiste boolean NOT NULL DEFAULT false,
ADD COLUMN instrumentaliste boolean NOT NULL DEFAULT false,
ADD COLUMN aide_de_salle boolean NOT NULL DEFAULT false,
ADD COLUMN bloc_ophtalmo_accueil boolean NOT NULL DEFAULT false,
ADD COLUMN bloc_dermato_accueil boolean NOT NULL DEFAULT false;