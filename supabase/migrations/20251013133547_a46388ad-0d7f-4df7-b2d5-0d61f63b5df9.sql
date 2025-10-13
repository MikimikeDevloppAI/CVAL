-- Supprimer la colonne medecin_id de planning_genere_site_personnel
ALTER TABLE public.planning_genere_site_personnel 
DROP COLUMN IF EXISTS medecin_id;

-- Supprimer les colonnes responsable et horaires de planning_genere_site_besoin
ALTER TABLE public.planning_genere_site_besoin 
DROP COLUMN IF EXISTS responsable_1r_id,
DROP COLUMN IF EXISTS responsable_2f_id,
DROP COLUMN IF EXISTS responsable_3f_id,
DROP COLUMN IF EXISTS heure_debut,
DROP COLUMN IF EXISTS heure_fin;