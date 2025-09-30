-- Add backup_id column to planning_genere
ALTER TABLE public.planning_genere 
ADD COLUMN backup_id uuid NULL;

-- Add foreign key constraint to backup table
ALTER TABLE public.planning_genere 
ADD CONSTRAINT planning_genere_backup_id_fkey 
FOREIGN KEY (backup_id) REFERENCES public.backup(id) ON DELETE CASCADE;

-- Add check constraint: either secretaire_id or backup_id must be set (not both, not neither)
ALTER TABLE public.planning_genere 
ADD CONSTRAINT planning_genere_person_check 
CHECK (
  (secretaire_id IS NOT NULL AND backup_id IS NULL) OR
  (secretaire_id IS NULL AND backup_id IS NOT NULL)
);