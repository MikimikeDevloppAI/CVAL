-- Étape 1: Ajouter simplement la colonne demi_journee
ALTER TABLE public.absences 
ADD COLUMN demi_journee TEXT;