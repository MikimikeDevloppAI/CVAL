-- Add closing responsible columns to planning_genere_personnel
ALTER TABLE public.planning_genere_personnel
ADD COLUMN IF NOT EXISTS responsable_1r_id UUID REFERENCES public.secretaires(id),
ADD COLUMN IF NOT EXISTS responsable_2f_id UUID REFERENCES public.secretaires(id),
ADD COLUMN IF NOT EXISTS responsable_3f_id UUID REFERENCES public.secretaires(id);

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_planning_genere_personnel_responsables 
ON public.planning_genere_personnel(responsable_1r_id, responsable_2f_id, responsable_3f_id);