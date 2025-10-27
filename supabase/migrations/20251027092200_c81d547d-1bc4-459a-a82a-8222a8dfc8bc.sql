-- Fix besoins calculation to include 1.2 coefficient for secretary needs per doctor
-- This ensures consistency between SQL view and React frontend calculations

DROP MATERIALIZED VIEW IF EXISTS public.besoins_non_satisfaits_summary;

CREATE MATERIALIZED VIEW public.besoins_non_satisfaits_summary AS
WITH besoins_sites AS (
  SELECT
    be.date,
    be.demi_journee AS periode,
    be.site_id,
    s.nom AS site_nom,
    NULL::uuid AS besoin_operation_id,
    NULL::uuid AS planning_genere_bloc_operatoire_id,
    'site' AS type_besoin,
    COUNT(DISTINCT be.medecin_id) * 1.2 AS nombre_besoins
  FROM public.besoin_effectif be
  JOIN public.sites s ON s.id = be.site_id
  WHERE be.type = 'medecin'
    AND be.actif = true
    AND be.demi_journee IN ('matin', 'apres_midi')
    AND s.nom NOT IN ('Clinique La Vallée - Bloc opératoire', 'Bloc opératoire')
  GROUP BY be.date, be.demi_journee, be.site_id, s.nom
),
besoins_bloc AS (
  SELECT
    pgbo.date,
    pgbo.periode AS periode,
    NULL::uuid AS site_id,
    'Bloc opératoire' AS site_nom,
    NULL::uuid AS besoin_operation_id,
    pgbo.id AS planning_genere_bloc_operatoire_id,
    'bloc_operatoire' AS type_besoin,
    SUM(tibp.nombre_requis) AS nombre_besoins
  FROM public.planning_genere_bloc_operatoire pgbo
  JOIN public.types_intervention_besoins_personnel tibp 
    ON tibp.type_intervention_id = pgbo.type_intervention_id
    AND tibp.actif = true
  WHERE pgbo.statut != 'annule'
  GROUP BY pgbo.date, pgbo.periode, pgbo.id
),
capacites_sites AS (
  SELECT
    ce.date,
    ce.demi_journee AS periode,
    ce.site_id,
    COUNT(*) AS nombre_capacites
  FROM public.capacite_effective ce
  WHERE ce.actif = true
    AND ce.demi_journee IN ('matin', 'apres_midi')
    AND ce.planning_genere_bloc_operatoire_id IS NULL
  GROUP BY ce.date, ce.demi_journee, ce.site_id
),
capacites_bloc AS (
  SELECT
    ce.date,
    ce.demi_journee AS periode,
    ce.planning_genere_bloc_operatoire_id,
    ce.besoin_operation_id,
    COUNT(*) AS nombre_capacites
  FROM public.capacite_effective ce
  WHERE ce.actif = true
    AND ce.demi_journee IN ('matin', 'apres_midi')
    AND ce.planning_genere_bloc_operatoire_id IS NOT NULL
  GROUP BY ce.date, ce.demi_journee, ce.planning_genere_bloc_operatoire_id, ce.besoin_operation_id
),
all_besoins AS (
  SELECT * FROM besoins_sites
  UNION ALL
  SELECT * FROM besoins_bloc
),
all_capacites AS (
  SELECT 
    date,
    periode,
    site_id,
    NULL::uuid AS besoin_operation_id,
    NULL::uuid AS planning_genere_bloc_operatoire_id,
    nombre_capacites
  FROM capacites_sites
  UNION ALL
  SELECT
    date,
    periode,
    NULL::uuid AS site_id,
    besoin_operation_id,
    planning_genere_bloc_operatoire_id,
    nombre_capacites
  FROM capacites_bloc
)
SELECT
  b.date,
  b.periode,
  b.site_id,
  b.site_nom,
  b.besoin_operation_id,
  b.planning_genere_bloc_operatoire_id,
  b.type_besoin,
  b.nombre_besoins,
  COALESCE(c.nombre_capacites, 0) AS nombre_capacites,
  GREATEST(0, b.nombre_besoins - COALESCE(c.nombre_capacites, 0)) AS deficit
FROM all_besoins b
LEFT JOIN all_capacites c ON 
  b.date = c.date 
  AND b.periode = c.periode
  AND (
    (b.site_id IS NOT NULL AND b.site_id = c.site_id) OR
    (b.planning_genere_bloc_operatoire_id IS NOT NULL AND b.planning_genere_bloc_operatoire_id = c.planning_genere_bloc_operatoire_id AND b.besoin_operation_id = c.besoin_operation_id)
  )
WHERE GREATEST(0, b.nombre_besoins - COALESCE(c.nombre_capacites, 0)) > 0;

CREATE UNIQUE INDEX idx_besoins_non_satisfaits_unique ON public.besoins_non_satisfaits_summary (
  date, 
  periode, 
  COALESCE(site_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(planning_genere_bloc_operatoire_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(besoin_operation_id, '00000000-0000-0000-0000-000000000000'::uuid),
  type_besoin
);

REFRESH MATERIALIZED VIEW public.besoins_non_satisfaits_summary;