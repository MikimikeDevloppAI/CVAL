-- Remove old responsable columns
ALTER TABLE public.planning_genere_personnel
DROP COLUMN IF EXISTS responsable_1r_id,
DROP COLUMN IF EXISTS responsable_2f_id,
DROP COLUMN IF EXISTS responsable_3f_id;

-- Add new boolean columns for responsable roles
ALTER TABLE public.planning_genere_personnel
ADD COLUMN is_1r boolean DEFAULT false NOT NULL,
ADD COLUMN is_2f boolean DEFAULT false NOT NULL,
ADD COLUMN is_3f boolean DEFAULT false NOT NULL;

-- Add a constraint to ensure only one role can be true at a time
ALTER TABLE public.planning_genere_personnel
ADD CONSTRAINT check_single_responsable_role 
CHECK (
  (is_1r::int + is_2f::int + is_3f::int) <= 1
);

-- Create index for performance on responsable queries
CREATE INDEX idx_planning_genere_personnel_responsables 
ON public.planning_genere_personnel(date, site_id, periode) 
WHERE (is_1r = true OR is_2f = true OR is_3f = true);