-- Add capacite_effective_id to capacite_effective_dry_run table
ALTER TABLE capacite_effective_dry_run 
ADD COLUMN capacite_effective_id uuid REFERENCES capacite_effective(id);