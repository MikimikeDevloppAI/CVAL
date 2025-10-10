
-- Add medecin_assigne_id column to secretaires table
ALTER TABLE public.secretaires
ADD COLUMN medecin_assigne_id UUID REFERENCES public.medecins(id) ON DELETE SET NULL;

-- Add index for better query performance
CREATE INDEX idx_secretaires_medecin_assigne ON public.secretaires(medecin_assigne_id);

-- Add comment to describe the column
COMMENT ON COLUMN public.secretaires.medecin_assigne_id IS 'ID du médecin assigné à cette secrétaire';
