-- Test simple: juste définir la valeur par défaut
ALTER TABLE public.absences 
ALTER COLUMN demi_journee SET DEFAULT 'toute_journee'::demi_journee;