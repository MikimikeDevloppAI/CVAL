-- Étape 1: Ajouter le champ type_assignation à planning_genere_site_personnel
ALTER TABLE planning_genere_site_personnel 
ADD COLUMN type_assignation text NOT NULL DEFAULT 'site'
CHECK (type_assignation IN ('site', 'administratif', 'bloc'));

-- Créer un index pour les requêtes
CREATE INDEX idx_planning_site_personnel_type 
ON planning_genere_site_personnel(type_assignation);

-- Étape 2: Migrer les données existantes de planning_genere vers planning_genere_site_personnel
-- Pour chaque assignation admin dans planning_genere
INSERT INTO planning_genere_site_personnel (
  planning_genere_site_besoin_id,
  secretaire_id,
  ordre,
  type_assignation
)
SELECT 
  pgsb.id,
  pg.secretaire_id,
  (SELECT COALESCE(MAX(ordre), 0) + 1 
   FROM planning_genere_site_personnel 
   WHERE planning_genere_site_personnel.planning_genere_site_besoin_id = pgsb.id) as ordre,
  'administratif'
FROM planning_genere pg
JOIN planning_genere_site_besoin pgsb 
  ON pgsb.date = pg.date 
  AND pgsb.periode = pg.periode
  AND pgsb.planning_id = pg.planning_id
WHERE pg.type = 'administratif'
  AND pg.secretaire_id IS NOT NULL;

-- Étape 3: Supprimer la table planning_genere (CASCADE pour supprimer les contraintes)
DROP TABLE IF EXISTS planning_genere CASCADE;