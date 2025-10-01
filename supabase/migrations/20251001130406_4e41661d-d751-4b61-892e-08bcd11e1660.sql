-- Create index on planning_genere for efficient weekly deletion
-- This ensures complete removal of all entries for a given week
CREATE INDEX IF NOT EXISTS idx_planning_genere_date_type 
ON planning_genere (date, type_assignation);