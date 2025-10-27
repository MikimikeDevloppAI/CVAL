-- Drop existing view
DROP MATERIALIZED VIEW IF EXISTS besoins_fermeture_summary CASCADE;

-- Create new granular fermeture summary view
CREATE MATERIALIZED VIEW besoins_fermeture_summary AS
WITH fermeture_sites AS (
  -- Identifier les sites de fermeture qui ont des besoins matin ET après-midi
  SELECT DISTINCT
    be.date,
    be.site_id,
    s.nom as site_nom
  FROM besoin_effectif be
  JOIN sites s ON s.id = be.site_id
  WHERE be.actif = true
    AND be.type = 'medecin'
    AND s.fermeture = true
    AND be.date >= CURRENT_DATE
    AND be.date <= CURRENT_DATE + INTERVAL '6 weeks'
  GROUP BY be.date, be.site_id, s.nom
  HAVING COUNT(DISTINCT be.demi_journee) = 2  -- Matin ET après-midi
),
secretaires_toute_journee AS (
  -- Trouver les secrétaires présentes matin ET après-midi sur chaque site
  SELECT
    fs.date,
    fs.site_id,
    cem.secretaire_id,
    sec.first_name || ' ' || sec.name as nom_complet,
    COALESCE(cem.is_1r OR ceam.is_1r, false) as is_1r,
    COALESCE(cem.is_2f OR ceam.is_2f, false) as is_2f,
    COALESCE(cem.is_3f OR ceam.is_3f, false) as is_3f,
    cem.id as capacite_matin_id,
    ceam.id as capacite_apres_midi_id
  FROM fermeture_sites fs
  JOIN capacite_effective cem ON 
    cem.date = fs.date 
    AND cem.site_id = fs.site_id 
    AND cem.demi_journee = 'matin'
    AND cem.actif = true
  JOIN capacite_effective ceam ON 
    ceam.date = fs.date 
    AND ceam.site_id = fs.site_id 
    AND ceam.demi_journee = 'apres_midi'
    AND ceam.actif = true
    AND ceam.secretaire_id = cem.secretaire_id  -- Même secrétaire matin et après-midi
  LEFT JOIN secretaires sec ON sec.id = cem.secretaire_id
),
assignations AS (
  -- Agréger par date + site avec les listes de secrétaires
  SELECT
    date,
    site_id,
    jsonb_agg(
      jsonb_build_object(
        'secretaire_id', secretaire_id,
        'nom_complet', nom_complet,
        'is_1r', is_1r,
        'is_2f', is_2f,
        'is_3f', is_3f,
        'capacite_matin_id', capacite_matin_id,
        'capacite_apres_midi_id', capacite_apres_midi_id
      )
      ORDER BY nom_complet
    ) as secretaires_assignees,
    COUNT(*) FILTER (WHERE is_1r = true) as nombre_1r,
    COUNT(*) FILTER (WHERE is_2f = true OR is_3f = true) as nombre_2f3f
  FROM secretaires_toute_journee
  GROUP BY date, site_id
)
SELECT
  fs.date,
  fs.site_id,
  fs.site_nom,
  1 as nombre_requis_1r,
  COALESCE(a.nombre_1r, 0) as nombre_assigne_1r,
  GREATEST(0, 1 - COALESCE(a.nombre_1r, 0)) as deficit_1r,
  1 as nombre_requis_2f3f,
  COALESCE(a.nombre_2f3f, 0) as nombre_assigne_2f3f,
  GREATEST(0, 1 - COALESCE(a.nombre_2f3f, 0)) as deficit_2f3f,
  GREATEST(
    1 - COALESCE(a.nombre_1r, 0),
    1 - COALESCE(a.nombre_2f3f, 0)
  ) as deficit,
  COALESCE(a.secretaires_assignees, '[]'::jsonb) as secretaires_assignees
FROM fermeture_sites fs
LEFT JOIN assignations a ON 
  fs.date = a.date 
  AND fs.site_id = a.site_id
WHERE (1 - COALESCE(a.nombre_1r, 0)) > 0 
   OR (1 - COALESCE(a.nombre_2f3f, 0)) > 0;

-- Create indexes for performance
CREATE UNIQUE INDEX idx_besoins_fermeture_unique 
ON besoins_fermeture_summary(date, site_id);

CREATE INDEX idx_besoins_fermeture_date 
ON besoins_fermeture_summary(date);

CREATE INDEX idx_besoins_fermeture_deficit 
ON besoins_fermeture_summary(deficit) WHERE deficit > 0;

-- Refresh the view
REFRESH MATERIALIZED VIEW besoins_fermeture_summary;