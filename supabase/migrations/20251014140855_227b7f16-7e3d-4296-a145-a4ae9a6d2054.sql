-- Add site_id column to planning_genere_personnel
ALTER TABLE public.planning_genere_personnel 
  ADD COLUMN site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL;

-- Populate site_id from existing besoin_effectif data
UPDATE public.planning_genere_personnel p
SET site_id = be.site_id
FROM public.besoin_effectif be
WHERE p.besoin_effectif_id = be.id
  AND p.type_assignation = 'site';

-- Drop the old constraint
ALTER TABLE public.planning_genere_personnel
  DROP CONSTRAINT IF EXISTS valid_site_assignment;

-- Drop besoin_effectif_id column
ALTER TABLE public.planning_genere_personnel
  DROP COLUMN besoin_effectif_id;

-- Add new constraint
ALTER TABLE public.planning_genere_personnel
  ADD CONSTRAINT valid_assignment CHECK (
    (type_assignation = 'site' AND site_id IS NOT NULL) OR
    (type_assignation = 'administratif') OR
    (type_assignation = 'bloc' AND planning_genere_bloc_operatoire_id IS NOT NULL)
  );

-- Add index for performance
CREATE INDEX idx_planning_personnel_site ON public.planning_genere_personnel(site_id);