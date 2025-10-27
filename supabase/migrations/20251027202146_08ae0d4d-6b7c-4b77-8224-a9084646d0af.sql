-- Drop existing materialized view
DROP MATERIALIZED VIEW IF EXISTS besoins_fermeture_summary CASCADE;

-- Recreate the materialized view with deficit column
CREATE MATERIALIZED VIEW besoins_fermeture_summary AS
WITH sites_fermes AS (
  SELECT DISTINCT
    s.id as site_id,
    s.nom as site_nom,
    be.date,
    be.demi_journee
  FROM besoin_effectif be
  JOIN sites s ON be.site_id = s.id
  WHERE s.fermeture = true
    AND be.actif = true
    AND s.actif = true
),
secretaires_toute_journee AS (
  SELECT DISTINCT
    sf.site_id,
    sf.date,
    ce_matin.secretaire_id
  FROM sites_fermes sf
  LEFT JOIN capacite_effective ce_matin 
    ON ce_matin.site_id = sf.site_id 
    AND ce_matin.date = sf.date 
    AND ce_matin.demi_journee = 'matin'
    AND ce_matin.actif = true
    AND (ce_matin.is_1r = true OR ce_matin.is_2f = true OR ce_matin.is_3f = true)
  LEFT JOIN capacite_effective ce_aprem 
    ON ce_aprem.site_id = sf.site_id 
    AND ce_aprem.date = sf.date 
    AND ce_aprem.demi_journee = 'apres_midi'
    AND ce_aprem.secretaire_id = ce_matin.secretaire_id
    AND ce_aprem.actif = true
    AND (ce_aprem.is_1r = true OR ce_aprem.is_2f = true OR ce_aprem.is_3f = true)
  WHERE ce_matin.secretaire_id IS NOT NULL
    AND ce_aprem.secretaire_id IS NOT NULL
),
assignments_1r AS (
  SELECT
    sf.site_id,
    sf.date,
    COUNT(DISTINCT stj.secretaire_id) as nombre_1r
  FROM sites_fermes sf
  LEFT JOIN secretaires_toute_journee stj 
    ON stj.site_id = sf.site_id 
    AND stj.date = sf.date
  GROUP BY sf.site_id, sf.date
),
assignments_2f3f AS (
  SELECT
    sf.site_id,
    sf.date,
    COUNT(DISTINCT ce.secretaire_id) FILTER (
      WHERE ce.demi_journee = 'matin' 
      AND (ce.is_2f = true OR ce.is_3f = true)
      AND NOT EXISTS (
        SELECT 1 FROM secretaires_toute_journee stj2
        WHERE stj2.site_id = ce.site_id
          AND stj2.date = ce.date
          AND stj2.secretaire_id = ce.secretaire_id
      )
    ) as nombre_2f3f_matin,
    COUNT(DISTINCT ce.secretaire_id) FILTER (
      WHERE ce.demi_journee = 'apres_midi' 
      AND (ce.is_2f = true OR ce.is_3f = true)
      AND NOT EXISTS (
        SELECT 1 FROM secretaires_toute_journee stj2
        WHERE stj2.site_id = ce.site_id
          AND stj2.date = ce.date
          AND stj2.secretaire_id = ce.secretaire_id
      )
    ) as nombre_2f3f_aprem
  FROM sites_fermes sf
  LEFT JOIN capacite_effective ce 
    ON ce.site_id = sf.site_id 
    AND ce.date = sf.date
    AND ce.actif = true
  GROUP BY sf.site_id, sf.date
)
SELECT
  sf.site_id,
  sf.site_nom,
  sf.date,
  1 as nombre_requis_1r,
  1 as nombre_requis_2f3f,
  COALESCE(a1r.nombre_1r, 0) as nombre_assigne_1r,
  COALESCE(GREATEST(a2f3f.nombre_2f3f_matin, a2f3f.nombre_2f3f_aprem), 0) as nombre_assigne_2f3f,
  GREATEST(0, 1 - COALESCE(a1r.nombre_1r, 0)) as deficit_1r,
  GREATEST(0, 1 - COALESCE(GREATEST(a2f3f.nombre_2f3f_matin, a2f3f.nombre_2f3f_aprem), 0)) as deficit_2f3f,
  GREATEST(
    GREATEST(0, 1 - COALESCE(a1r.nombre_1r, 0)),
    GREATEST(0, 1 - COALESCE(GREATEST(a2f3f.nombre_2f3f_matin, a2f3f.nombre_2f3f_aprem), 0))
  ) as deficit
FROM sites_fermes sf
LEFT JOIN assignments_1r a1r 
  ON a1r.site_id = sf.site_id 
  AND a1r.date = sf.date
LEFT JOIN assignments_2f3f a2f3f 
  ON a2f3f.site_id = sf.site_id 
  AND a2f3f.date = sf.date;

-- Create indexes for performance
CREATE INDEX idx_besoins_fermeture_summary_date 
  ON besoins_fermeture_summary(date);
CREATE INDEX idx_besoins_fermeture_summary_site 
  ON besoins_fermeture_summary(site_id);
CREATE INDEX idx_besoins_fermeture_summary_deficit 
  ON besoins_fermeture_summary(deficit);

-- Refresh the view
REFRESH MATERIALIZED VIEW besoins_fermeture_summary;