-- Fix besoins_fermeture_summary: correctly handle NULL values in is_1r, is_2f, is_3f flags
DROP MATERIALIZED VIEW IF EXISTS besoins_fermeture_summary CASCADE;

CREATE MATERIALIZED VIEW besoins_fermeture_summary AS
WITH sites_fermes AS (
  SELECT 
    s.id as site_id,
    s.nom as site_nom,
    d.date,
    CASE 
      WHEN d.hour_slot = 'morning' THEN 'matin'::demi_journee
      ELSE 'apres_midi'::demi_journee
    END as demi_journee
  FROM sites s
  CROSS JOIN (
    SELECT 
      generate_series(
        CURRENT_DATE,
        CURRENT_DATE + INTERVAL '6 weeks',
        INTERVAL '1 day'
      )::date as date,
      unnest(ARRAY['morning', 'afternoon']) as hour_slot
  ) d
  WHERE s.fermeture = true AND s.actif = true
),
secretaires_toute_journee AS (
  SELECT
    cem.secretaire_id,
    cem.site_id,
    cem.date,
    COALESCE(cem.is_1r, false) OR COALESCE(ceam.is_1r, false) as is_1r,
    COALESCE(cem.is_2f, false) OR COALESCE(ceam.is_2f, false) as is_2f,
    COALESCE(cem.is_3f, false) OR COALESCE(ceam.is_3f, false) as is_3f
  FROM capacite_effective cem
  LEFT JOIN capacite_effective ceam ON 
    ceam.secretaire_id = cem.secretaire_id 
    AND ceam.date = cem.date
    AND ceam.site_id = cem.site_id
    AND ceam.demi_journee = 'apres_midi'
    AND ceam.actif = true
  WHERE cem.demi_journee = 'matin'
    AND cem.actif = true
    AND cem.date >= CURRENT_DATE
    AND cem.date <= CURRENT_DATE + INTERVAL '6 weeks'
),
assignments_1r AS (
  SELECT 
    sf.site_id,
    sf.date,
    COUNT(DISTINCT stj.secretaire_id) as nombre_assigne
  FROM sites_fermes sf
  LEFT JOIN secretaires_toute_journee stj ON 
    stj.site_id = sf.site_id 
    AND stj.date = sf.date
    AND stj.is_1r = true
  GROUP BY sf.site_id, sf.date
),
assignments_2f3f AS (
  SELECT 
    sf.site_id,
    sf.date,
    COUNT(DISTINCT stj.secretaire_id) as nombre_assigne
  FROM sites_fermes sf
  LEFT JOIN secretaires_toute_journee stj ON 
    stj.site_id = sf.site_id 
    AND stj.date = sf.date
    AND (stj.is_2f = true OR stj.is_3f = true)
  GROUP BY sf.site_id, sf.date
)
SELECT 
  sf.site_id,
  sf.site_nom,
  sf.date,
  sf.demi_journee,
  'fermeture' as besoin_type,
  1 as nombre_requis_1r,
  COALESCE(a1r.nombre_assigne, 0) as nombre_assigne_1r,
  GREATEST(0, 1 - COALESCE(a1r.nombre_assigne, 0)) as deficit_1r,
  1 as nombre_requis_2f3f,
  COALESCE(a2f3f.nombre_assigne, 0) as nombre_assigne_2f3f,
  GREATEST(0, 1 - COALESCE(a2f3f.nombre_assigne, 0)) as deficit_2f3f,
  (sf.site_nom || ' • Fermeture') as nom_complet
FROM sites_fermes sf
LEFT JOIN assignments_1r a1r ON 
  a1r.site_id = sf.site_id 
  AND a1r.date = sf.date
LEFT JOIN assignments_2f3f a2f3f ON 
  a2f3f.site_id = sf.site_id 
  AND a2f3f.date = sf.date
WHERE GREATEST(0, 1 - COALESCE(a1r.nombre_assigne, 0)) > 0 
   OR GREATEST(0, 1 - COALESCE(a2f3f.nombre_assigne, 0)) > 0;

-- Create indexes
CREATE UNIQUE INDEX idx_besoins_fermeture_unique 
ON besoins_fermeture_summary(site_id, date, demi_journee);

CREATE INDEX idx_besoins_fermeture_date 
ON besoins_fermeture_summary(date);

CREATE INDEX idx_besoins_fermeture_deficits 
ON besoins_fermeture_summary(deficit_1r, deficit_2f3f) 
WHERE deficit_1r > 0 OR deficit_2f3f > 0;

-- Refresh the view
REFRESH MATERIALIZED VIEW besoins_fermeture_summary;