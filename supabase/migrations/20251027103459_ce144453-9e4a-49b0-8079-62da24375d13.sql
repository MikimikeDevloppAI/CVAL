-- Drop old materialized view and function
DROP MATERIALIZED VIEW IF EXISTS besoins_non_satisfaits_summary CASCADE;
DROP FUNCTION IF EXISTS refresh_besoins_non_satisfaits() CASCADE;

-- Create new materialized views

-- 1. Vue pour les besoins SITES (exclut le bloc opératoire)
CREATE MATERIALIZED VIEW besoins_sites_summary AS
WITH site_needs AS (
  SELECT
    be.date,
    be.demi_journee,
    be.site_id,
    s.nom as site_nom,
    COUNT(DISTINCT be.id) as nombre_requis
  FROM besoin_effectif be
  JOIN sites s ON s.id = be.site_id
  WHERE be.actif = true
    AND be.type = 'medecin'
    AND s.nom != 'Clinique La Vallée - Bloc opératoire'
  GROUP BY be.date, be.demi_journee, be.site_id, s.nom
),
site_assignments AS (
  SELECT
    ce.date,
    ce.demi_journee,
    ce.site_id,
    COUNT(DISTINCT ce.id) as nombre_assigne
  FROM capacite_effective ce
  WHERE ce.actif = true
    AND ce.site_id != '00000000-0000-0000-0000-000000000001'
  GROUP BY ce.date, ce.demi_journee, ce.site_id
)
SELECT
  sn.date,
  sn.demi_journee,
  sn.site_id,
  sn.site_nom,
  sn.nombre_requis,
  COALESCE(sa.nombre_assigne, 0) as nombre_assigne,
  GREATEST(0, sn.nombre_requis - COALESCE(sa.nombre_assigne, 0)) as deficit
FROM site_needs sn
LEFT JOIN site_assignments sa ON 
  sn.date = sa.date 
  AND sn.demi_journee = sa.demi_journee 
  AND sn.site_id = sa.site_id;

CREATE UNIQUE INDEX idx_besoins_sites_unique ON besoins_sites_summary(date, demi_journee, site_id);
CREATE INDEX idx_besoins_sites_date ON besoins_sites_summary(date);
CREATE INDEX idx_besoins_sites_deficit ON besoins_sites_summary(deficit) WHERE deficit > 0;

-- 2. Vue pour les besoins BLOC OPÉRATOIRE
CREATE MATERIALIZED VIEW besoins_bloc_operatoire_summary AS
WITH bloc_needs AS (
  SELECT
    pgbo.date,
    pgbo.periode as demi_journee,
    pgbo.id as planning_genere_bloc_id,
    pgbo.medecin_id,
    m.first_name || ' ' || m.name as medecin_nom,
    pgbo.type_intervention_id,
    tibp.besoin_operation_id,
    bo.nom as besoin_operation_nom,
    tibp.nombre_requis
  FROM planning_genere_bloc_operatoire pgbo
  JOIN types_intervention_besoins_personnel tibp ON tibp.type_intervention_id = pgbo.type_intervention_id
  JOIN besoins_operations bo ON bo.id = tibp.besoin_operation_id
  JOIN medecins m ON m.id = pgbo.medecin_id
  WHERE pgbo.statut != 'annule'
    AND tibp.actif = true
    AND bo.actif = true
),
bloc_assignments AS (
  SELECT
    ce.planning_genere_bloc_operatoire_id,
    ce.besoin_operation_id,
    COUNT(DISTINCT ce.id) as nombre_assigne
  FROM capacite_effective ce
  WHERE ce.actif = true
    AND ce.planning_genere_bloc_operatoire_id IS NOT NULL
    AND ce.besoin_operation_id IS NOT NULL
  GROUP BY ce.planning_genere_bloc_operatoire_id, ce.besoin_operation_id
)
SELECT
  bn.date,
  bn.demi_journee,
  bn.planning_genere_bloc_id,
  bn.medecin_id,
  bn.medecin_nom,
  bn.besoin_operation_id,
  bn.besoin_operation_nom,
  bn.nombre_requis,
  COALESCE(ba.nombre_assigne, 0) as nombre_assigne,
  GREATEST(0, bn.nombre_requis - COALESCE(ba.nombre_assigne, 0)) as deficit
FROM bloc_needs bn
LEFT JOIN bloc_assignments ba ON 
  bn.planning_genere_bloc_id = ba.planning_genere_bloc_operatoire_id
  AND bn.besoin_operation_id = ba.besoin_operation_id;

CREATE UNIQUE INDEX idx_besoins_bloc_unique ON besoins_bloc_operatoire_summary(planning_genere_bloc_id, besoin_operation_id);
CREATE INDEX idx_besoins_bloc_date ON besoins_bloc_operatoire_summary(date);
CREATE INDEX idx_besoins_bloc_deficit ON besoins_bloc_operatoire_summary(deficit) WHERE deficit > 0;

-- 3. Vue pour les besoins FERMETURE
CREATE MATERIALIZED VIEW besoins_fermeture_summary AS
WITH fermeture_sites AS (
  SELECT DISTINCT
    be.date,
    be.site_id,
    s.nom as site_nom
  FROM besoin_effectif be
  JOIN sites s ON s.id = be.site_id
  WHERE be.actif = true
    AND be.type = 'medecin'
    AND s.fermeture = true
  GROUP BY be.date, be.site_id, s.nom
  HAVING COUNT(DISTINCT be.demi_journee) = 2
),
capacites_fermeture_1r AS (
  SELECT
    ce.date,
    ce.site_id,
    COUNT(DISTINCT ce.id) as count_1r
  FROM capacite_effective ce
  WHERE ce.actif = true
    AND ce.is_1r = true
  GROUP BY ce.date, ce.site_id
),
capacites_fermeture_2f3f AS (
  SELECT
    ce.date,
    ce.site_id,
    COUNT(DISTINCT ce.id) as count_2f3f
  FROM capacite_effective ce
  WHERE ce.actif = true
    AND (ce.is_2f = true OR ce.is_3f = true)
  GROUP BY ce.date, ce.site_id
),
deficits_fermeture AS (
  SELECT
    fs.date,
    fs.site_id,
    fs.site_nom,
    2 as nombre_requis_1r,
    COALESCE(cf1r.count_1r, 0) as nombre_assigne_1r,
    GREATEST(0, 2 - COALESCE(cf1r.count_1r, 0)) as deficit_1r,
    2 as nombre_requis_2f3f,
    COALESCE(cf2f3f.count_2f3f, 0) as nombre_assigne_2f3f,
    GREATEST(0, 2 - COALESCE(cf2f3f.count_2f3f, 0)) as deficit_2f3f
  FROM fermeture_sites fs
  LEFT JOIN capacites_fermeture_1r cf1r ON 
    fs.date = cf1r.date 
    AND fs.site_id = cf1r.site_id
  LEFT JOIN capacites_fermeture_2f3f cf2f3f ON 
    fs.date = cf2f3f.date 
    AND fs.site_id = cf2f3f.site_id
)
SELECT
  date,
  site_id,
  site_nom,
  nombre_requis_1r,
  nombre_assigne_1r,
  deficit_1r,
  nombre_requis_2f3f,
  nombre_assigne_2f3f,
  deficit_2f3f,
  GREATEST(deficit_1r, deficit_2f3f) as deficit
FROM deficits_fermeture
WHERE deficit_1r > 0 OR deficit_2f3f > 0;

CREATE UNIQUE INDEX idx_besoins_fermeture_unique ON besoins_fermeture_summary(date, site_id);
CREATE INDEX idx_besoins_fermeture_date ON besoins_fermeture_summary(date);
CREATE INDEX idx_besoins_fermeture_deficit ON besoins_fermeture_summary(deficit) WHERE deficit > 0;

-- Create unified refresh function
CREATE OR REPLACE FUNCTION refresh_all_besoins_summaries()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY besoins_sites_summary;
  REFRESH MATERIALIZED VIEW CONCURRENTLY besoins_bloc_operatoire_summary;
  REFRESH MATERIALIZED VIEW CONCURRENTLY besoins_fermeture_summary;
END;
$$;

-- Update trigger function to call new refresh
CREATE OR REPLACE FUNCTION public.trigger_refresh_besoins()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM refresh_all_besoins_summaries();
  RETURN COALESCE(NEW, OLD);
END;
$$;