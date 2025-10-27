-- Drop existing materialized view
DROP MATERIALIZED VIEW IF EXISTS public.besoins_non_satisfaits_summary;

-- Recreate the materialized view with corrected logic
CREATE MATERIALIZED VIEW public.besoins_non_satisfaits_summary AS
WITH bloc_site AS (
  SELECT id FROM public.sites WHERE nom = 'Clinique La Vallée - Bloc opératoire' LIMIT 1
),
admin_site AS (
  SELECT '00000000-0000-0000-0000-000000000001'::uuid AS id
),
-- SITES: Calculate needs based on doctors present, rounded up, excluding bloc site
besoins_sites AS (
  SELECT
    be.date,
    be.demi_journee::text AS periode,
    be.site_id,
    s.nom AS site_nom,
    CEIL(SUM(COALESCE(m.besoin_secretaires, 1)))::int AS nombre_besoins
  FROM public.besoin_effectif be
  JOIN public.medecins m ON m.id = be.medecin_id
  JOIN public.sites s ON s.id = be.site_id
  WHERE be.type = 'medecin'
    AND be.demi_journee IN ('matin', 'apres_midi')
    AND be.actif = true
    AND be.site_id != (SELECT id FROM bloc_site)
  GROUP BY be.date, be.demi_journee, be.site_id, s.nom
),
-- SITES: Count capacities assigned to sites (excluding administratif and bloc assignments)
capacites_sites AS (
  SELECT
    ce.date,
    ce.demi_journee::text AS periode,
    ce.site_id,
    COUNT(*)::int AS nombre_capacites
  FROM public.capacite_effective ce
  WHERE ce.actif = true
    AND ce.demi_journee IN ('matin', 'apres_midi')
    AND ce.planning_genere_bloc_operatoire_id IS NULL
    AND ce.site_id != (SELECT id FROM admin_site)
  GROUP BY ce.date, ce.demi_journee, ce.site_id
),
-- BLOC: One row per operational need
besoins_bloc AS (
  SELECT
    pgbo.date,
    pgbo.periode::text,
    pgbo.id AS planning_genere_bloc_operatoire_id,
    pgbo.type_intervention_id,
    ti.nom AS type_intervention_nom,
    pgbo.medecin_id,
    m.name AS medecin_nom,
    m.first_name AS medecin_prenom,
    tibp.besoin_operation_id,
    bo.nom AS besoin_operation_nom,
    tibp.nombre_requis AS nombre_besoins
  FROM public.planning_genere_bloc_operatoire pgbo
  JOIN public.types_intervention ti ON ti.id = pgbo.type_intervention_id
  LEFT JOIN public.medecins m ON m.id = pgbo.medecin_id
  JOIN public.types_intervention_besoins_personnel tibp ON tibp.type_intervention_id = pgbo.type_intervention_id
  JOIN public.besoins_operations bo ON bo.id = tibp.besoin_operation_id
  WHERE pgbo.statut != 'annule'
    AND tibp.actif = true
),
-- BLOC: Count capacities per operational need with 1R/2F/3F flags
capacites_bloc AS (
  SELECT
    ce.date,
    ce.demi_journee::text AS periode,
    ce.planning_genere_bloc_operatoire_id,
    ce.besoin_operation_id,
    COUNT(*)::int AS nombre_capacites,
    COUNT(*) FILTER (WHERE ce.is_1r = true)::int AS nombre_1r,
    COUNT(*) FILTER (WHERE ce.is_2f = true)::int AS nombre_2f,
    COUNT(*) FILTER (WHERE ce.is_3f = true)::int AS nombre_3f
  FROM public.capacite_effective ce
  WHERE ce.actif = true
    AND ce.demi_journee IN ('matin', 'apres_midi')
    AND ce.planning_genere_bloc_operatoire_id IS NOT NULL
    AND ce.besoin_operation_id IS NOT NULL
  GROUP BY ce.date, ce.demi_journee, ce.planning_genere_bloc_operatoire_id, ce.besoin_operation_id
),
-- FERMETURE: Sites needing closing personnel (both 1R and 2F/3F)
closing_needed AS (
  SELECT DISTINCT
    be.date,
    be.site_id,
    s.nom AS site_nom
  FROM public.besoin_effectif be
  JOIN public.sites s ON s.id = be.site_id
  WHERE be.type = 'medecin'
    AND be.actif = true
    AND s.fermeture = true
  GROUP BY be.date, be.site_id, s.nom
  HAVING COUNT(DISTINCT be.demi_journee) = 2  -- Both matin and apres_midi
),
closing_counts AS (
  SELECT
    cn.date,
    cn.site_id,
    cn.site_nom,
    COUNT(DISTINCT ce.secretaire_id) FILTER (WHERE ce.is_1r = true)::int AS count_1r,
    COUNT(DISTINCT ce.secretaire_id) FILTER (WHERE ce.is_2f = true OR ce.is_3f = true)::int AS count_2f3f
  FROM closing_needed cn
  LEFT JOIN public.capacite_effective ce ON ce.date = cn.date AND ce.site_id = cn.site_id AND ce.actif = true
  GROUP BY cn.date, cn.site_id, cn.site_nom
),
fermeture_1r AS (
  SELECT
    date,
    site_id,
    site_nom,
    1 AS nombre_besoins,
    count_1r AS nombre_capacites,
    GREATEST(0, 1 - count_1r) AS deficit,
    'fermeture_1r'::text AS type_besoin
  FROM closing_counts
  WHERE 1 - count_1r > 0
),
fermeture_2f3f AS (
  SELECT
    date,
    site_id,
    site_nom,
    1 AS nombre_besoins,
    count_2f3f AS nombre_capacites,
    GREATEST(0, 1 - count_2f3f) AS deficit,
    'fermeture_2f3f'::text AS type_besoin
  FROM closing_counts
  WHERE 1 - count_2f3f > 0
)
-- UNION ALL: Sites + Bloc + Fermeture
SELECT
  bs.date,
  bs.periode,
  bs.site_id,
  bs.site_nom,
  NULL::uuid AS planning_genere_bloc_operatoire_id,
  NULL::uuid AS type_intervention_id,
  NULL::text AS type_intervention_nom,
  NULL::uuid AS medecin_id,
  NULL::text AS medecin_nom,
  NULL::text AS medecin_prenom,
  NULL::uuid AS besoin_operation_id,
  NULL::text AS besoin_operation_nom,
  bs.nombre_besoins,
  COALESCE(cs.nombre_capacites, 0) AS nombre_capacites,
  0 AS nombre_1r,
  0 AS nombre_2f,
  0 AS nombre_3f,
  GREATEST(0, bs.nombre_besoins - COALESCE(cs.nombre_capacites, 0)) AS deficit,
  'site'::text AS type_besoin
FROM besoins_sites bs
LEFT JOIN capacites_sites cs ON cs.date = bs.date AND cs.periode = bs.periode AND cs.site_id = bs.site_id
WHERE bs.nombre_besoins - COALESCE(cs.nombre_capacites, 0) > 0

UNION ALL

SELECT
  bb.date,
  bb.periode,
  NULL::uuid AS site_id,
  NULL::text AS site_nom,
  bb.planning_genere_bloc_operatoire_id,
  bb.type_intervention_id,
  bb.type_intervention_nom,
  bb.medecin_id,
  bb.medecin_nom,
  bb.medecin_prenom,
  bb.besoin_operation_id,
  bb.besoin_operation_nom,
  bb.nombre_besoins,
  COALESCE(cb.nombre_capacites, 0) AS nombre_capacites,
  COALESCE(cb.nombre_1r, 0) AS nombre_1r,
  COALESCE(cb.nombre_2f, 0) AS nombre_2f,
  COALESCE(cb.nombre_3f, 0) AS nombre_3f,
  GREATEST(0, bb.nombre_besoins - COALESCE(cb.nombre_capacites, 0)) AS deficit,
  'bloc_operatoire'::text AS type_besoin
FROM besoins_bloc bb
LEFT JOIN capacites_bloc cb ON cb.date = bb.date 
  AND cb.periode = bb.periode 
  AND cb.planning_genere_bloc_operatoire_id = bb.planning_genere_bloc_operatoire_id
  AND cb.besoin_operation_id = bb.besoin_operation_id
WHERE bb.nombre_besoins - COALESCE(cb.nombre_capacites, 0) > 0

UNION ALL

SELECT
  date,
  'toute_journee'::text AS periode,
  site_id,
  site_nom,
  NULL::uuid AS planning_genere_bloc_operatoire_id,
  NULL::uuid AS type_intervention_id,
  NULL::text AS type_intervention_nom,
  NULL::uuid AS medecin_id,
  NULL::text AS medecin_nom,
  NULL::text AS medecin_prenom,
  NULL::uuid AS besoin_operation_id,
  NULL::text AS besoin_operation_nom,
  nombre_besoins,
  nombre_capacites,
  0 AS nombre_1r,
  0 AS nombre_2f,
  0 AS nombre_3f,
  deficit,
  type_besoin
FROM fermeture_1r

UNION ALL

SELECT
  date,
  'toute_journee'::text AS periode,
  site_id,
  site_nom,
  NULL::uuid AS planning_genere_bloc_operatoire_id,
  NULL::uuid AS type_intervention_id,
  NULL::text AS type_intervention_nom,
  NULL::uuid AS medecin_id,
  NULL::text AS medecin_nom,
  NULL::text AS medecin_prenom,
  NULL::uuid AS besoin_operation_id,
  NULL::text AS besoin_operation_nom,
  nombre_besoins,
  nombre_capacites,
  0 AS nombre_1r,
  0 AS nombre_2f,
  0 AS nombre_3f,
  deficit,
  type_besoin
FROM fermeture_2f3f;

-- Create unique index
CREATE UNIQUE INDEX idx_besoins_non_satisfaits_unique ON public.besoins_non_satisfaits_summary (
  date,
  periode,
  COALESCE(site_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(planning_genere_bloc_operatoire_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(besoin_operation_id, '00000000-0000-0000-0000-000000000000'::uuid),
  type_besoin
);

-- Set ownership and permissions
ALTER MATERIALIZED VIEW public.besoins_non_satisfaits_summary OWNER TO postgres;
GRANT SELECT ON public.besoins_non_satisfaits_summary TO authenticated;
GRANT SELECT ON public.besoins_non_satisfaits_summary TO service_role;