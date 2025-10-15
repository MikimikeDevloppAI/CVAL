-- Create secretaires_medecins table with priorities
CREATE TABLE public.secretaires_medecins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  secretaire_id UUID NOT NULL REFERENCES public.secretaires(id) ON DELETE CASCADE,
  medecin_id UUID NOT NULL REFERENCES public.medecins(id) ON DELETE CASCADE,
  priorite priorite_site NOT NULL DEFAULT '1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(secretaire_id, medecin_id)
);

CREATE INDEX idx_secretaires_medecins_secretaire ON public.secretaires_medecins(secretaire_id);
CREATE INDEX idx_secretaires_medecins_medecin ON public.secretaires_medecins(medecin_id);
CREATE INDEX idx_secretaires_medecins_priorite ON public.secretaires_medecins(priorite);

ALTER TABLE public.secretaires_medecins ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users with planning access can manage secretaires_medecins"
ON public.secretaires_medecins FOR ALL
USING (has_planning_access())
WITH CHECK (has_planning_access());

CREATE POLICY "Users with planning or admin can view secretaires_medecins"
ON public.secretaires_medecins FOR SELECT
USING (has_planning_or_admin_access());

-- Migrate existing data
INSERT INTO public.secretaires_medecins (secretaire_id, medecin_id, priorite)
SELECT 
  id as secretaire_id,
  medecin_assigne_id as medecin_id,
  '1'::priorite_site as priorite
FROM public.secretaires
WHERE medecin_assigne_id IS NOT NULL
ON CONFLICT (secretaire_id, medecin_id) DO NOTHING;

-- Mark old column as deprecated
COMMENT ON COLUMN public.secretaires.medecin_assigne_id IS 'DEPRECATED - Use secretaires_medecins table instead';