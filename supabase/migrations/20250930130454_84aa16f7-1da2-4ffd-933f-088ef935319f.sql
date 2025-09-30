-- Rendre site_id nullable et ajouter une colonne pour les assignations administratives
ALTER TABLE public.planning_genere 
ALTER COLUMN site_id DROP NOT NULL;

ALTER TABLE public.planning_genere 
ADD COLUMN IF NOT EXISTS type_assignation text DEFAULT 'site';

COMMENT ON COLUMN public.planning_genere.type_assignation IS 'Type d''assignation: site (affecté à un site) ou administratif (non assigné, tâches administratives)';