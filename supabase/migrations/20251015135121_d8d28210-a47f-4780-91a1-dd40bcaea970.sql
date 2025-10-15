-- Créer l'enum pour les priorités de sites
CREATE TYPE priorite_site AS ENUM ('1', '2');

-- Créer la table secretaires_sites
CREATE TABLE public.secretaires_sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  secretaire_id UUID NOT NULL REFERENCES public.secretaires(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  priorite priorite_site NOT NULL DEFAULT '1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(secretaire_id, site_id)
);

-- Créer les index pour performance
CREATE INDEX idx_secretaires_sites_secretaire ON public.secretaires_sites(secretaire_id);
CREATE INDEX idx_secretaires_sites_site ON public.secretaires_sites(site_id);
CREATE INDEX idx_secretaires_sites_priorite ON public.secretaires_sites(priorite);

-- Activer RLS
ALTER TABLE public.secretaires_sites ENABLE ROW LEVEL SECURITY;

-- Créer les policies RLS
CREATE POLICY "Users with planning access can manage secretaires_sites"
ON public.secretaires_sites FOR ALL
USING (has_planning_access())
WITH CHECK (has_planning_access());

CREATE POLICY "Users with planning or admin can view secretaires_sites"
ON public.secretaires_sites FOR SELECT
USING (has_planning_or_admin_access());

-- Migrer les données existantes depuis secretaires.sites_assignes
-- Toutes les assignations sont créées avec priorité '1' par défaut
INSERT INTO public.secretaires_sites (secretaire_id, site_id, priorite)
SELECT 
  s.id as secretaire_id,
  unnest(s.sites_assignes) as site_id,
  '1'::priorite_site as priorite
FROM public.secretaires s
WHERE s.sites_assignes IS NOT NULL 
  AND array_length(s.sites_assignes, 1) > 0
ON CONFLICT (secretaire_id, site_id) DO NOTHING;

-- Marquer l'ancienne colonne comme deprecated (commentaire)
COMMENT ON COLUMN public.secretaires.sites_assignes IS 'DEPRECATED - Use secretaires_sites table instead. Will be removed in future version.';