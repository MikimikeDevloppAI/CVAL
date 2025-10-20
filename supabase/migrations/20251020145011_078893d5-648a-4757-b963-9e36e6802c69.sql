-- =============================================
-- Migration : Suppression de planning_genere_personnel
-- =============================================

-- 1. Supprimer la colonne de référence dans capacite_effective
ALTER TABLE public.capacite_effective 
DROP COLUMN IF EXISTS planning_genere_personnel_id CASCADE;

-- 2. Supprimer les fonctions RPC qui utilisent cette table
DROP FUNCTION IF EXISTS public.swap_secretaries_personnel(uuid, uuid) CASCADE;

-- 3. Supprimer la table planning_genere_personnel
DROP TABLE IF EXISTS public.planning_genere_personnel CASCADE;