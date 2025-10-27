-- Drop existing materialized view
DROP MATERIALIZED VIEW IF EXISTS besoins_sites_summary;

-- Recreate the view with correct filter
CREATE MATERIALIZED VIEW besoins_sites_summary AS
WITH site_needs AS (
  SELECT 
    be.date,
    be.demi_journee,
    be.site_id,
    s.nom as site_nom,
    COUNT(DISTINCT be.id) as total_besoins,
    sp.nom as specialite_nom,
    sp.id as specialite_id
  FROM besoin_effectif be
  JOIN sites s ON s.id = be.site_id
  LEFT JOIN medecins m ON m.id = be.medecin_id
  LEFT JOIN specialites sp ON sp.id = m.specialite_id
  WHERE be.actif = true
    AND be.type = 'medecin'  -- Sites needs are medecin type
    AND be.site_id != '00000000-0000-0000-0000-000000000001'  -- Exclude administrative
    AND s.nom != 'Bloc opératoire'  -- Exclude operating room
  GROUP BY be.date, be.demi_journee, be.site_id, s.nom, sp.nom, sp.id
),
site_assignments AS (
  SELECT 
    ce.date,
    ce.demi_journee,
    ce.site_id,
    s.nom as site_nom,
    COUNT(DISTINCT ce.secretaire_id) as secretaires_assignees,
    sp.nom as specialite_nom,
    sp.id as specialite_id
  FROM capacite_effective ce
  JOIN sites s ON s.id = ce.site_id
  LEFT JOIN secretaires sec ON sec.id = ce.secretaire_id
  LEFT JOIN secretaires_medecins sm ON sm.secretaire_id = sec.id
  LEFT JOIN medecins m ON m.id = sm.medecin_id
  LEFT JOIN specialites sp ON sp.id = m.specialite_id
  WHERE ce.actif = true
    AND ce.site_id != '00000000-0000-0000-0000-000000000001'  -- Exclude administrative
    AND s.nom != 'Bloc opératoire'  -- Exclude operating room
  GROUP BY ce.date, ce.demi_journee, ce.site_id, s.nom, sp.nom, sp.id
)
SELECT 
  COALESCE(sn.date, sa.date) as date,
  COALESCE(sn.demi_journee, sa.demi_journee) as demi_journee,
  COALESCE(sn.site_id, sa.site_id) as site_id,
  COALESCE(sn.site_nom, sa.site_nom) as site_nom,
  COALESCE(sn.specialite_id, sa.specialite_id) as specialite_id,
  COALESCE(sn.specialite_nom, sa.specialite_nom) as specialite_nom,
  COALESCE(sn.total_besoins, 0) as total_besoins,
  COALESCE(sa.secretaires_assignees, 0) as secretaires_assignees,
  GREATEST(COALESCE(sn.total_besoins, 0) - COALESCE(sa.secretaires_assignees, 0), 0) as besoins_non_couverts
FROM site_needs sn
FULL OUTER JOIN site_assignments sa 
  ON sn.date = sa.date 
  AND sn.demi_journee = sa.demi_journee 
  AND sn.site_id = sa.site_id
  AND COALESCE(sn.specialite_id::text, 'null') = COALESCE(sa.specialite_id::text, 'null')
WHERE COALESCE(sn.total_besoins, 0) > 0 
   OR COALESCE(sa.secretaires_assignees, 0) > 0;

-- Recreate indexes
CREATE INDEX idx_besoins_sites_summary_date ON besoins_sites_summary(date);
CREATE INDEX idx_besoins_sites_summary_site ON besoins_sites_summary(site_id);
CREATE INDEX idx_besoins_sites_summary_unfilled ON besoins_sites_summary(besoins_non_couverts) WHERE besoins_non_couverts > 0;

-- Refresh the view
REFRESH MATERIALIZED VIEW besoins_sites_summary;