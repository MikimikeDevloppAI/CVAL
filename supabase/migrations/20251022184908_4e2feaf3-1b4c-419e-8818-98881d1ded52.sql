-- Corriger le type de la colonne demi_journee
ALTER TABLE public.absences 
DROP COLUMN demi_journee;

-- Ajouter avec le bon type enum
ALTER TABLE public.absences 
ADD COLUMN demi_journee demi_journee;