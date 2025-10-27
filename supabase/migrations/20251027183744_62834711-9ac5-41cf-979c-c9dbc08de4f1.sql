-- Recreate materialized views to only contain data for next 6 weeks

-- Drop existing materialized views
DROP MATERIALIZED VIEW IF EXISTS besoins_sites_summary;
DROP MATERIALIZED VIEW IF EXISTS besoins_bloc_operatoire_summary;
DROP MATERIALIZED VIEW IF EXISTS besoins_fermeture_summary;

-- Recreate besoins_sites_summary with 6-week filter
CREATE MATERIALIZED VIEW besoins_sites_summary AS
SELECT 
  be.date,
  be.demi_journee,
  be.site_id,
  s.nom as site_nom,
  COUNT(DISTINCT be.medecin_id) as nombre_medecins,
  COALESCE(SUM(m.besoin_secretaires), 0) as nombre_secretaires_requis
FROM besoin_effectif be
LEFT JOIN sites s ON s.id = be.site_id
LEFT JOIN medecins m ON m.id = be.medecin_id
WHERE be.actif = true
  AND be.type = 'medecin'
  AND be.date >= CURRENT_DATE
  AND be.date <= CURRENT_DATE + INTERVAL '6 weeks'
GROUP BY be.date, be.demi_journee, be.site_id, s.nom;

-- Create unique index for concurrent refresh
CREATE UNIQUE INDEX besoins_sites_summary_unique_idx 
ON besoins_sites_summary (date, demi_journee, site_id);

-- Recreate besoins_bloc_operatoire_summary with 6-week filter
CREATE MATERIALIZED VIEW besoins_bloc_operatoire_summary AS
SELECT 
  pgbo.date,
  pgbo.periode as demi_journee,
  COUNT(DISTINCT pgbo.id) as nombre_operations,
  COALESCE(SUM(
    (SELECT COUNT(*) 
     FROM types_intervention_besoins_personnel tibp
     WHERE tibp.type_intervention_id = pgbo.type_intervention_id
       AND tibp.actif = true)
  ), 0) as nombre_secretaires_requis
FROM planning_genere_bloc_operatoire pgbo
WHERE pgbo.statut != 'annule'
  AND pgbo.date >= CURRENT_DATE
  AND pgbo.date <= CURRENT_DATE + INTERVAL '6 weeks'
GROUP BY pgbo.date, pgbo.periode;

-- Create unique index for concurrent refresh
CREATE UNIQUE INDEX besoins_bloc_operatoire_summary_unique_idx 
ON besoins_bloc_operatoire_summary (date, demi_journee);

-- Recreate besoins_fermeture_summary with 6-week filter
CREATE MATERIALIZED VIEW besoins_fermeture_summary AS
SELECT 
  be.date,
  be.demi_journee,
  COUNT(DISTINCT be.site_id) as nombre_sites_fermeture,
  SUM(
    CASE 
      WHEN s.fermeture = true THEN 1
      ELSE 0
    END
  ) as nombre_secretaires_requis
FROM besoin_effectif be
LEFT JOIN sites s ON s.id = be.site_id
WHERE be.actif = true
  AND s.fermeture = true
  AND be.date >= CURRENT_DATE
  AND be.date <= CURRENT_DATE + INTERVAL '6 weeks'
GROUP BY be.date, be.demi_journee;

-- Create unique index for concurrent refresh
CREATE UNIQUE INDEX besoins_fermeture_summary_unique_idx 
ON besoins_fermeture_summary (date, demi_journee);