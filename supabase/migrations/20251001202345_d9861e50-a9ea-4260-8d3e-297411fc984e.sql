-- Drop the nombre_secretaires_requis column from besoin_effectif
ALTER TABLE public.besoin_effectif DROP COLUMN IF EXISTS nombre_secretaires_requis;