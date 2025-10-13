-- Remove bloc_operatoire_besoin_id from planning_genere_bloc_operatoire
-- medecin_id remains NOT NULL and should be retrieved from besoin_effectif

ALTER TABLE public.planning_genere_bloc_operatoire
DROP COLUMN IF EXISTS bloc_operatoire_besoin_id;