-- Add salle_id to besoins_unified_summary MATERIALIZED view for bloc operations
-- This enables correct status mapping for virtual salle sites in DashboardPage

DROP MATERIALIZED VIEW IF EXISTS public.besoins_unified_summary;

CREATE MATERIALIZED VIEW public.besoins_unified_summary AS 
WITH site_result AS (
  SELECT 
    be.site_id,
    s.nom AS site_nom,
    be.date,
    be.demi_journee,
    COUNT(DISTINCT be.medecin_id) AS nombre_medecins,
    COALESCE(SUM(m.besoin_secretaires), 0) AS nombre_requis,
    COALESCE(
      (SELECT COUNT(*) 
       FROM capacite_effective ce 
       WHERE ce.site_id = be.site_id 
         AND ce.date = be.date 
         AND ce.demi_journee = be.demi_journee 
         AND ce.actif = true
         AND ce.planning_genere_bloc_operatoire_id IS NULL),
      0
    ) AS nombre_assigne,
    s.fermeture AS is_fermeture_site,
    'site'::text AS type_besoin,
    NULL::uuid AS planning_bloc_id,
    NULL::uuid AS salle_id,
    NULL::uuid AS besoin_operation_id,
    NULL::text AS besoin_operation_nom,
    NULL::text AS type_intervention_nom,
    NULL::text AS medecin_nom
  FROM besoin_effectif be
  JOIN sites s ON s.id = be.site_id
  LEFT JOIN medecins m ON m.id = be.medecin_id
  WHERE be.actif = true
    AND be.type = 'medecin'
    AND be.date >= CURRENT_DATE
    AND be.date <= CURRENT_DATE + INTERVAL '52 weeks'
    AND s.actif = true
    AND NOT s.nom ILIKE '%administratif%'
    AND NOT s.nom ILIKE '%bloc%'
  GROUP BY be.site_id, s.nom, be.date, be.demi_journee, s.fermeture
),
bloc_result AS (
  SELECT 
    pgbo.id AS planning_bloc_id,
    pgbo.salle_assignee AS salle_id,
    pgbo.date,
    pgbo.periode AS demi_journee,
    ti.nom AS type_intervention_nom,
    m.name AS medecin_nom,
    tibp.besoin_operation_id,
    bo.nom AS besoin_operation_nom,
    tibp.nombre_requis,
    COALESCE(
      (SELECT COUNT(*) 
       FROM capacite_effective ce 
       WHERE ce.planning_genere_bloc_operatoire_id = pgbo.id 
         AND ce.besoin_operation_id = tibp.besoin_operation_id
         AND ce.actif = true),
      0
    ) AS nombre_assigne
  FROM planning_genere_bloc_operatoire pgbo
  JOIN types_intervention ti ON ti.id = pgbo.type_intervention_id
  LEFT JOIN medecins m ON m.id = pgbo.medecin_id
  JOIN types_intervention_besoins_personnel tibp ON tibp.type_intervention_id = pgbo.type_intervention_id AND tibp.actif = true
  JOIN besoins_operations bo ON bo.id = tibp.besoin_operation_id
  WHERE pgbo.statut != 'annule'
    AND pgbo.date >= CURRENT_DATE
    AND pgbo.date <= CURRENT_DATE + INTERVAL '52 weeks'
),
fermeture_result AS (
  SELECT
    ce.site_id,
    s.nom AS site_nom,
    ce.date,
    be.demi_journee,
    COUNT(DISTINCT be.medecin_id) AS nombre_medecins,
    COALESCE(SUM(m.besoin_secretaires), 0) AS nombre_requis,
    COUNT(DISTINCT ce.secretaire_id) AS nombre_assigne,
    '1R' AS type_responsabilite,
    ce.is_1r,
    ce.is_2f,
    ce.is_3f
  FROM capacite_effective ce
  JOIN sites s ON s.id = ce.site_id AND s.fermeture = true
  LEFT JOIN besoin_effectif be ON be.site_id = ce.site_id 
    AND be.date = ce.date 
    AND be.demi_journee = ce.demi_journee
    AND be.type = 'medecin'
    AND be.actif = true
  LEFT JOIN medecins m ON m.id = be.medecin_id
  WHERE ce.actif = true
    AND ce.date >= CURRENT_DATE
    AND ce.date <= CURRENT_DATE + INTERVAL '52 weeks'
    AND ce.planning_genere_bloc_operatoire_id IS NULL
  GROUP BY ce.site_id, s.nom, ce.date, be.demi_journee, ce.is_1r, ce.is_2f, ce.is_3f
)
SELECT 
  site_id,
  site_nom,
  date,
  demi_journee,
  nombre_medecins,
  nombre_requis,
  nombre_assigne,
  GREATEST(0, CEIL(nombre_requis) - nombre_assigne) AS balance,
  CASE WHEN nombre_assigne >= CEIL(nombre_requis) THEN 'OK' ELSE 'DEFICIT' END AS statut,
  is_fermeture_site,
  type_besoin,
  planning_bloc_id,
  salle_id,
  besoin_operation_id,
  besoin_operation_nom,
  type_intervention_nom,
  medecin_nom
FROM site_result

UNION ALL

SELECT 
  '86f1047f-c4ff-441f-a064-42ee2f8ef37a'::uuid AS site_id,
  type_intervention_nom || ' - ' || besoin_operation_nom AS site_nom,
  date,
  demi_journee,
  1 AS nombre_medecins,
  nombre_requis,
  nombre_assigne,
  GREATEST(0, nombre_requis - nombre_assigne) AS balance,
  CASE WHEN nombre_assigne >= nombre_requis THEN 'OK' ELSE 'DEFICIT' END AS statut,
  false AS is_fermeture_site,
  'bloc'::text AS type_besoin,
  planning_bloc_id,
  salle_id,
  besoin_operation_id,
  besoin_operation_nom,
  type_intervention_nom,
  medecin_nom
FROM bloc_result

UNION ALL

SELECT 
  site_id,
  site_nom,
  date,
  demi_journee,
  nombre_medecins,
  nombre_requis,
  nombre_assigne,
  GREATEST(0, CEIL(nombre_requis) - nombre_assigne) AS balance,
  CASE WHEN nombre_assigne >= CEIL(nombre_requis) THEN 'OK' ELSE 'DEFICIT' END AS statut,
  true AS is_fermeture_site,
  'fermeture'::text AS type_besoin,
  NULL::uuid AS planning_bloc_id,
  NULL::uuid AS salle_id,
  NULL::uuid AS besoin_operation_id,
  NULL::text AS besoin_operation_nom,
  NULL::text AS type_intervention_nom,
  NULL::text AS medecin_nom
FROM fermeture_result
WHERE demi_journee IS NOT NULL;

-- Recreate the index for performance
CREATE INDEX IF NOT EXISTS idx_besoins_unified_summary_date ON besoins_unified_summary(date);
CREATE INDEX IF NOT EXISTS idx_besoins_unified_summary_site_date ON besoins_unified_summary(site_id, date);
CREATE INDEX IF NOT EXISTS idx_besoins_unified_summary_salle ON besoins_unified_summary(salle_id) WHERE salle_id IS NOT NULL;