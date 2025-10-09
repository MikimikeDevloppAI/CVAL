-- Modifier la table secretaires pour remplacer specialites par sites_assignes
ALTER TABLE public.secretaires 
DROP COLUMN specialites;

ALTER TABLE public.secretaires 
ADD COLUMN sites_assignes uuid[] NOT NULL DEFAULT '{}';

-- Mettre à jour les secrétaires existantes pour avoir au moins leur site préférentiel si défini
UPDATE public.secretaires
SET sites_assignes = ARRAY[site_preferentiel_id]
WHERE site_preferentiel_id IS NOT NULL;

-- Commentaire pour clarification
COMMENT ON COLUMN public.secretaires.sites_assignes IS 'Liste des sites où la secrétaire peut travailler';
COMMENT ON COLUMN public.secretaires.site_preferentiel_id IS 'Site préférentiel parmi les sites assignés';