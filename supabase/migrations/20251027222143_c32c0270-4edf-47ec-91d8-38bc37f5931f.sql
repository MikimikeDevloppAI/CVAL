-- Add nombre_demi_journees_admin column to secretaires table
ALTER TABLE public.secretaires 
ADD COLUMN nombre_demi_journees_admin INTEGER 
CHECK (nombre_demi_journees_admin >= 1 AND nombre_demi_journees_admin <= 10);

COMMENT ON COLUMN public.secretaires.nombre_demi_journees_admin IS 
'Nombre de demi-journées administratives préférées (1-10), utilisé uniquement si prefered_admin est true';