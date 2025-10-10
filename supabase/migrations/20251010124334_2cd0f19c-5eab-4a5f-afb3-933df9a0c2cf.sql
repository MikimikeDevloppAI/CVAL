-- Remove bloc_operatoire_besoin_id column from besoin_effectif table
ALTER TABLE public.besoin_effectif 
DROP COLUMN IF EXISTS bloc_operatoire_besoin_id;