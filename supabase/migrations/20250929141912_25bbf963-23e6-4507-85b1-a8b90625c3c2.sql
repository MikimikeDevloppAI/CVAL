-- Add actif column to medecins table
ALTER TABLE public.medecins ADD COLUMN actif boolean NOT NULL DEFAULT true;