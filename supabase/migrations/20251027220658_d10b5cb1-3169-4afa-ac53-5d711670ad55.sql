-- Drop existing view
DROP MATERIALIZED VIEW IF EXISTS besoins_sites_summary CASCADE;

-- Recreate the view with correct structure and filter
CREATE MATERIALIZED VIEW besoins_sites_summary AS
WITH site_needs AS (
  -- Calculate needs per site/date/period
  SELECT
    be.date,
    be.demi_journee,
    be.site_id,
    s.nom as site_nom,
    COUNT(DISTINCT be.medecin_id) as nombre_medecins,
    -- Special rule for Saturday: 1 secretary per doctor
    -- Otherwise: CEIL(SUM(besoin_secretaires))
    CASE 
      WHEN EXTRACT(ISODOW FROM be.date) = 6 THEN 
        COUNT(DISTINCT be.medecin_id)
      ELSE 
        CEIL(COALESCE(SUM(m.besoin_secretaires), 0))
    END as nombre_requis
  FROM besoin_effectif be
  JOIN sites s ON s.id = be.site_id
  LEFT JOIN medecins m ON m.id = be.medecin_id
  WHERE be.actif = true
    AND be.type = 'medecin'
    AND be.date >= CURRENT_DATE
    AND be.date <= CURRENT_DATE + INTERVAL '6 weeks'
    AND s.nom != 'Bloc opératoire'  -- Exclude operating room
  GROUP BY be.date, be.demi_journee, be.site_id, s.nom
),
site_assignments AS (
  -- Count assigned secretaries per site/date/period
  SELECT
    ce.date,
    ce.demi_journee,
    ce.site_id,
    COUNT(DISTINCT ce.secretaire_id) as nombre_assigne
  FROM capacite_effective ce
  JOIN sites s ON s.id = ce.site_id
  WHERE ce.actif = true
    AND ce.site_id != '00000000-0000-0000-0000-000000000001'  -- Exclude administrative
    AND s.nom != 'Bloc opératoire'  -- Exclude operating room
  GROUP BY ce.date, ce.demi_journee, ce.site_id
)
SELECT
  sn.date,
  sn.demi_journee,
  sn.site_id,
  sn.site_nom,
  sn.nombre_medecins,
  sn.nombre_requis,
  COALESCE(sa.nombre_assigne, 0) as nombre_assigne,
  GREATEST(0, sn.nombre_requis - COALESCE(sa.nombre_assigne, 0)) as deficit
FROM site_needs sn
LEFT JOIN site_assignments sa ON 
  sn.date = sa.date 
  AND sn.demi_journee = sa.demi_journee 
  AND sn.site_id = sa.site_id
WHERE (sn.nombre_requis - COALESCE(sa.nombre_assigne, 0)) > 0;  -- Only deficits

-- Create indexes for performance
CREATE UNIQUE INDEX idx_besoins_sites_unique 
ON besoins_sites_summary(date, demi_journee, site_id);

CREATE INDEX idx_besoins_sites_date 
ON besoins_sites_summary(date);

CREATE INDEX idx_besoins_sites_deficit 
ON besoins_sites_summary(deficit) WHERE deficit > 0;

-- Refresh the view
REFRESH MATERIALIZED VIEW besoins_sites_summary;