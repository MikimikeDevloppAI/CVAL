-- Fix besoins_fermeture_summary: only include sites with doctors working BOTH morning AND afternoon
DROP MATERIALIZED VIEW IF EXISTS besoins_fermeture_summary CASCADE;

CREATE MATERIALIZED VIEW besoins_fermeture_summary AS
WITH fermeture_sites AS (
  SELECT id AS site_id, nom AS site_nom
  FROM sites
  WHERE actif = true AND fermeture = true
),
-- Identify dates where there are doctors working BOTH morning AND afternoon
sites_with_full_day_doctors AS (
  SELECT DISTINCT
    be_m.site_id,
    be_m.date
  FROM besoin_effectif be_m
  JOIN besoin_effectif be_a
    ON be_a.site_id = be_m.site_id
    AND be_a.date = be_m.date
    AND be_a.demi_journee = 'apres_midi'
    AND be_a.actif = true
    AND be_a.type = 'medecin'
  WHERE be_m.demi_journee = 'matin'
    AND be_m.actif = true
    AND be_m.type = 'medecin'
),
-- Filter to only fermeture sites with full-day doctor needs
valid_fermeture_dates AS (
  SELECT 
    fs.site_id,
    fs.site_nom,
    sfd.date
  FROM fermeture_sites fs
  JOIN sites_with_full_day_doctors sfd ON sfd.site_id = fs.site_id
),
secretaires_1r_toute_journee AS (
  -- Secretary marked is_1r both morning and afternoon
  SELECT DISTINCT ce_m.site_id, ce_m.date, ce_m.secretaire_id
  FROM capacite_effective ce_m
  JOIN capacite_effective ce_a
    ON ce_a.site_id = ce_m.site_id
    AND ce_a.date = ce_m.date
    AND ce_a.secretaire_id = ce_m.secretaire_id
    AND ce_a.demi_journee = 'apres_midi'
    AND ce_a.actif = true
    AND ce_a.is_1r = true
  WHERE ce_m.demi_journee = 'matin'
    AND ce_m.actif = true
    AND ce_m.is_1r = true
),
secretaires_2f3f_toute_journee AS (
  -- Secretary marked is_2f or is_3f both morning and afternoon
  SELECT DISTINCT ce_m.site_id, ce_m.date, ce_m.secretaire_id
  FROM capacite_effective ce_m
  JOIN capacite_effective ce_a
    ON ce_a.site_id = ce_m.site_id
    AND ce_a.date = ce_m.date
    AND ce_a.secretaire_id = ce_m.secretaire_id
    AND ce_a.demi_journee = 'apres_midi'
    AND ce_a.actif = true
    AND (ce_a.is_2f = true OR ce_a.is_3f = true)
  WHERE ce_m.demi_journee = 'matin'
    AND ce_m.actif = true
    AND (ce_m.is_2f = true OR ce_m.is_3f = true)
),
assignments_1r AS (
  SELECT site_id, date, COUNT(DISTINCT secretaire_id) AS nombre_assigne_1r
  FROM secretaires_1r_toute_journee
  GROUP BY site_id, date
),
assignments_2f3f AS (
  SELECT site_id, date, COUNT(DISTINCT secretaire_id) AS nombre_assigne_2f3f
  FROM secretaires_2f3f_toute_journee
  GROUP BY site_id, date
)
SELECT
  vfd.site_id,
  vfd.site_nom,
  vfd.date,
  1 AS nombre_requis_1r,
  1 AS nombre_requis_2f3f,
  COALESCE(a1r.nombre_assigne_1r, 0) AS nombre_assigne_1r,
  COALESCE(a23.nombre_assigne_2f3f, 0) AS nombre_assigne_2f3f,
  GREATEST(0, 1 - COALESCE(a1r.nombre_assigne_1r, 0)) AS deficit_1r,
  GREATEST(0, 1 - COALESCE(a23.nombre_assigne_2f3f, 0)) AS deficit_2f3f,
  GREATEST(
    GREATEST(0, 1 - COALESCE(a1r.nombre_assigne_1r, 0)),
    GREATEST(0, 1 - COALESCE(a23.nombre_assigne_2f3f, 0))
  ) AS deficit
FROM valid_fermeture_dates vfd
LEFT JOIN assignments_1r a1r
  ON a1r.site_id = vfd.site_id AND a1r.date = vfd.date
LEFT JOIN assignments_2f3f a23
  ON a23.site_id = vfd.site_id AND a23.date = vfd.date;

-- Indexes for performance
CREATE INDEX idx_bfs_date ON besoins_fermeture_summary(date);
CREATE INDEX idx_bfs_site ON besoins_fermeture_summary(site_id);
CREATE INDEX idx_bfs_deficit ON besoins_fermeture_summary(deficit);

-- Refresh the view immediately
REFRESH MATERIALIZED VIEW besoins_fermeture_summary;