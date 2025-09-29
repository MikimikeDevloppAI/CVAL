-- Add fermeture column to sites table
ALTER TABLE public.sites ADD COLUMN fermeture boolean NOT NULL DEFAULT false;