-- Make secretaire_id nullable in planning_genere_bloc_personnel
-- This allows us to create rows for all needs, even when no secretary is assigned

ALTER TABLE public.planning_genere_bloc_personnel
ALTER COLUMN secretaire_id DROP NOT NULL;