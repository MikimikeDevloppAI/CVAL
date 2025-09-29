-- Add nombre_jours_supplementaires column to secretaires table
ALTER TABLE public.secretaires 
ADD COLUMN nombre_jours_supplementaires integer DEFAULT 1;