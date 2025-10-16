-- Désactiver le rôle Accueil général (puisque Accueil Ophtalmologie existe déjà)
UPDATE public.besoins_operations 
SET actif = false
WHERE code = 'accueil';

-- Renommer "Cataracte Instrumentiste" en "Instrumentiste Cataracte"
UPDATE public.besoins_operations 
SET nom = 'Instrumentiste Cataracte'
WHERE code = 'instrumentiste_cataracte';