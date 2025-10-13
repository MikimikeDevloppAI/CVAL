-- Add horaire_flexible and pourcentage_temps columns to secretaires table
ALTER TABLE public.secretaires 
ADD COLUMN horaire_flexible boolean NOT NULL DEFAULT false,
ADD COLUMN pourcentage_temps numeric(5,2) DEFAULT NULL;

-- Add check constraint to ensure pourcentage_temps is between 0 and 100 when horaire_flexible is true
ALTER TABLE public.secretaires 
ADD CONSTRAINT check_pourcentage_temps 
CHECK (
  (horaire_flexible = false AND pourcentage_temps IS NULL) OR 
  (horaire_flexible = true AND pourcentage_temps IS NOT NULL AND pourcentage_temps > 0 AND pourcentage_temps <= 100)
);