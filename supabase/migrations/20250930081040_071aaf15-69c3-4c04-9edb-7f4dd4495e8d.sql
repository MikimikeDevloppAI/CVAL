-- Add specialite_id column to sites table
ALTER TABLE public.sites 
ADD COLUMN specialite_id UUID REFERENCES public.specialites(id) ON DELETE SET NULL;

-- Create index for performance
CREATE INDEX idx_sites_specialite ON public.sites(specialite_id);