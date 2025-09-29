-- Add actif column to secretaires table
ALTER TABLE public.secretaires ADD COLUMN actif boolean NOT NULL DEFAULT true;