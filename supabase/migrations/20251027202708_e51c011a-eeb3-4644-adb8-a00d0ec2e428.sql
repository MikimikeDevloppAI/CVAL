-- Recreate besoins_fermeture_summary to correctly count is_1r and is_2f/3f
DROP MATERIALIZED VIEW IF EXISTS besoins_fermeture_summary CASCADE;

CREATE MATERIALIZED VIEW besoins_fermeture_summary AS
WITH fermeture_sites AS (
  SELECT id AS site_id, nom AS site_nom
  FROM sites
  WHERE actif = true AND fermeture = true
),
all_dates AS (
  -- Get all dates where either besoin_effectif or capacite_effective exists for fermeture sites
  SELECT be.site_id, be.date
  FROM besoin_effectif be
  JOIN fermeture_sites fs ON fs.site_id = be.site_id
  WHERE be.actif = true
  UNION
  SELECT ce.site_id, ce.date
  FROM capacite_effective ce
  JOIN fermeture_sites fs ON fs.site_id = ce.site_id
  WHERE ce.actif = true
),
dates_sites AS (
  SELECT fs.site_id, fs.site_nom, ad.date
  FROM fermeture_sites fs
  JOIN all_dates ad ON ad.site_id = fs.site_id
  GROUP BY fs.site_id, fs.site_nom, ad.date
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
  ds.site_id,
  ds.site_nom,
  ds.date,
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
FROM dates_sites ds
LEFT JOIN assignments_1r a1r
  ON a1r.site_id = ds.site_id AND a1r.date = ds.date
LEFT JOIN assignments_2f3f a23
  ON a23.site_id = ds.site_id AND a23.date = ds.date;

-- Indexes for performance
CREATE INDEX idx_bfs_date ON besoins_fermeture_summary(date);
CREATE INDEX idx_bfs_site ON besoins_fermeture_summary(site_id);
CREATE INDEX idx_bfs_deficit ON besoins_fermeture_summary(deficit);

REFRESH MATERIALIZED VIEW besoins_fermeture_summary;