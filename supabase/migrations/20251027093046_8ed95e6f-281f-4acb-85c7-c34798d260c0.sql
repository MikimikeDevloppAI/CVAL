-- Drop existing materialized view and index
DROP MATERIALIZED VIEW IF EXISTS public.besoins_non_satisfaits_summary CASCADE;

-- Recreate the materialized view with detailed operational needs
CREATE MATERIALIZED VIEW public.besoins_non_satisfaits_summary AS
WITH besoins_sites AS (
  SELECT
    be.date,
    be.demi_journee AS periode,
    be.site_id,
    s.nom AS site_nom,
    COUNT(DISTINCT be.medecin_id) AS nombre_besoins
  FROM public.besoin_effectif be
  JOIN public.sites s ON s.id = be.site_id
  WHERE be.actif = true
    AND be.type = 'medecin'
    AND be.demi_journee IN ('matin', 'apres_midi')
    AND s.fermeture = false
  GROUP BY be.date, be.demi_journee, be.site_id, s.nom
),
besoins_bloc AS (
  -- Une ligne par besoin opérationnel pour chaque operation
  SELECT
    pgbo.date,
    pgbo.periode AS periode,
    pgbo.id AS planning_genere_bloc_operatoire_id,
    pgbo.medecin_id,
    m.name AS medecin_nom,
    m.first_name AS medecin_prenom,
    pgbo.type_intervention_id,
    ti.nom AS type_intervention_nom,
    tibp.besoin_operation_id,
    bo.nom AS besoin_operation_nom,
    tibp.nombre_requis AS nombre_besoins,
    'bloc_operatoire' AS type_besoin
  FROM public.planning_genere_bloc_operatoire pgbo
  JOIN public.types_intervention_besoins_personnel tibp 
    ON tibp.type_intervention_id = pgbo.type_intervention_id
    AND tibp.actif = true
  JOIN public.besoins_operations bo ON bo.id = tibp.besoin_operation_id
  JOIN public.types_intervention ti ON ti.id = pgbo.type_intervention_id
  LEFT JOIN public.medecins m ON m.id = pgbo.medecin_id
  WHERE pgbo.statut != 'annule'
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
    COUNT(*) AS nombre_capacites,
    COUNT(*) FILTER (WHERE ce.is_1r = true) AS nombre_1r,
    COUNT(*) FILTER (WHERE ce.is_2f = true) AS nombre_2f,
    COUNT(*) FILTER (WHERE ce.is_3f = true) AS nombre_3f
  FROM public.capacite_effective ce
  WHERE ce.actif = true
    AND ce.demi_journee IN ('matin', 'apres_midi')
    AND ce.planning_genere_bloc_operatoire_id IS NOT NULL
    AND ce.besoin_operation_id IS NOT NULL
  GROUP BY ce.date, ce.demi_journee, ce.planning_genere_bloc_operatoire_id, ce.besoin_operation_id
)
SELECT
  b.date,
  b.periode,
  b.site_id,
  b.site_nom,
  NULL::uuid AS besoin_operation_id,
  NULL::text AS besoin_operation_nom,
  NULL::uuid AS planning_genere_bloc_operatoire_id,
  NULL::uuid AS type_intervention_id,
  NULL::text AS type_intervention_nom,
  NULL::uuid AS medecin_id,
  NULL::text AS medecin_nom,
  NULL::text AS medecin_prenom,
  'site' AS type_besoin,
  b.nombre_besoins,
  COALESCE(c.nombre_capacites, 0) AS nombre_capacites,
  0 AS nombre_1r,
  0 AS nombre_2f,
  0 AS nombre_3f,
  GREATEST(0, b.nombre_besoins - COALESCE(c.nombre_capacites, 0)) AS deficit
FROM besoins_sites b
LEFT JOIN capacites_sites c ON 
  b.date = c.date 
  AND b.periode = c.periode 
  AND b.site_id = c.site_id
WHERE GREATEST(0, b.nombre_besoins - COALESCE(c.nombre_capacites, 0)) > 0

UNION ALL

SELECT
  bb.date,
  bb.periode,
  NULL::uuid AS site_id,
  'Bloc opératoire' AS site_nom,
  bb.besoin_operation_id,
  bb.besoin_operation_nom,
  bb.planning_genere_bloc_operatoire_id,
  bb.type_intervention_id,
  bb.type_intervention_nom,
  bb.medecin_id,
  bb.medecin_nom,
  bb.medecin_prenom,
  'bloc_operatoire' AS type_besoin,
  bb.nombre_besoins,
  COALESCE(cb.nombre_capacites, 0) AS nombre_capacites,
  COALESCE(cb.nombre_1r, 0) AS nombre_1r,
  COALESCE(cb.nombre_2f, 0) AS nombre_2f,
  COALESCE(cb.nombre_3f, 0) AS nombre_3f,
  GREATEST(0, bb.nombre_besoins - COALESCE(cb.nombre_capacites, 0)) AS deficit
FROM besoins_bloc bb
LEFT JOIN capacites_bloc cb ON 
  bb.date = cb.date 
  AND bb.periode = cb.periode
  AND bb.planning_genere_bloc_operatoire_id = cb.planning_genere_bloc_operatoire_id
  AND bb.besoin_operation_id = cb.besoin_operation_id
WHERE GREATEST(0, bb.nombre_besoins - COALESCE(cb.nombre_capacites, 0)) > 0;

-- Create unique index
CREATE UNIQUE INDEX idx_besoins_non_satisfaits_unique ON public.besoins_non_satisfaits_summary (
  date, 
  periode, 
  COALESCE(site_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(planning_genere_bloc_operatoire_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(besoin_operation_id, '00000000-0000-0000-0000-000000000000'::uuid),
  type_besoin
);

-- Grant permissions
ALTER MATERIALIZED VIEW public.besoins_non_satisfaits_summary OWNER TO postgres;
GRANT ALL ON public.besoins_non_satisfaits_summary TO authenticated;
GRANT ALL ON public.besoins_non_satisfaits_summary TO service_role;