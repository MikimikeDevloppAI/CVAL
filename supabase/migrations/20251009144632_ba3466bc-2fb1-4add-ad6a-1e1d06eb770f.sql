-- Add optional site assignment per day for secretaries
ALTER TABLE public.horaires_base_secretaires
ADD COLUMN IF NOT EXISTS site_id uuid NULL REFERENCES public.sites(id) ON DELETE SET NULL;

-- Index for better filtering/join performance on site_id
CREATE INDEX IF NOT EXISTS idx_horaires_base_secretaires_site_id
  ON public.horaires_base_secretaires(site_id);