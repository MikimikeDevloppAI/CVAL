-- Drop existing materialized view and its indexes
DROP MATERIALIZED VIEW IF EXISTS public.besoins_non_satisfaits_summary CASCADE;

-- Recreate the materialized view with dynamic operating room site selection
CREATE MATERIALIZED VIEW public.besoins_non_satisfaits_summary AS
WITH site_bloc AS (
  -- Dynamically select the correct operating room site
  SELECT id, nom
  FROM public.sites
  WHERE nom IN ('Bloc opératoire', 'Clinique La Vallée - Bloc opératoire')
  ORDER BY (nom = 'Bloc opératoire') DESC
  LIMIT 1
),
besoins_sites AS (
  SELECT
    be.date,
    CASE 
      WHEN be.demi_journee = 'matin' THEN 'matin'
      WHEN be.demi_journee = 'apres_midi' THEN 'apres_midi'
    END AS periode,
    be.site_id,
    s.nom AS site_nom,
    NULL::uuid AS besoin_operation_id,
    NULL::uuid AS planning_genere_bloc_operatoire_id,
    'site' AS type_besoin,
    -- Conditional logic: Saturday vs other days
    CASE 
      -- Saturday (DOW = 6): 1 secretary per doctor
      WHEN EXTRACT(DOW FROM be.date) = 6 THEN
        COUNT(DISTINCT be.medecin_id)
      -- Other days: sum of coefficients rounded up
      ELSE
        CEILING(SUM(m.besoin_secretaires))
    END AS nombre_besoins
  FROM public.besoin_effectif be
  JOIN public.sites s ON s.id = be.site_id
  JOIN public.medecins m ON m.id = be.medecin_id
  WHERE be.type = 'medecin'
    AND be.actif = true
    AND be.demi_journee IN ('matin', 'apres_midi')
    AND s.nom NOT IN ('Clinique La Vallée - Bloc opératoire', 'Bloc opératoire')
  GROUP BY be.date, be.demi_journee, be.site_id, s.nom
),
besoins_bloc AS (
  SELECT
    pgbo.date,
    CASE 
      WHEN pgbo.periode = 'matin' THEN 'matin'
      WHEN pgbo.periode = 'apres_midi' THEN 'apres_midi'
    END AS periode,
    sb.id AS site_id,
    sb.nom AS site_nom,
    tibp.besoin_operation_id,
    pgbo.id AS planning_genere_bloc_operatoire_id,
    'bloc_operatoire' AS type_besoin,
    tibp.nombre_requis AS nombre_besoins
  FROM public.planning_genere_bloc_operatoire pgbo
  JOIN public.types_intervention_besoins_personnel tibp 
    ON tibp.type_intervention_id = pgbo.type_intervention_id
    AND tibp.actif = true
  CROSS JOIN site_bloc sb
  WHERE pgbo.statut != 'annule'
),
tous_besoins AS (
  SELECT * FROM besoins_sites
  UNION ALL
  SELECT * FROM besoins_bloc
),
capacites AS (
  SELECT
    date,
    CASE 
      WHEN demi_journee = 'matin' THEN 'matin'
      WHEN demi_journee = 'apres_midi' THEN 'apres_midi'
    END AS periode,
    site_id,
    besoin_operation_id,
    planning_genere_bloc_operatoire_id,
    COUNT(*) AS nombre_assignes
  FROM public.capacite_effective
  WHERE actif = true
    AND demi_journee IN ('matin', 'apres_midi')
  GROUP BY date, demi_journee, site_id, besoin_operation_id, planning_genere_bloc_operatoire_id
)
SELECT
  tb.date,
  tb.periode,
  tb.site_id,
  tb.site_nom,
  tb.besoin_operation_id,
  tb.planning_genere_bloc_operatoire_id,
  tb.type_besoin,
  tb.nombre_besoins,
  COALESCE(c.nombre_assignes, 0) AS nombre_assignes,
  GREATEST(tb.nombre_besoins - COALESCE(c.nombre_assignes, 0), 0) AS nombre_manquant
FROM tous_besoins tb
LEFT JOIN capacites c 
  ON tb.date = c.date 
  AND tb.periode = c.periode 
  AND tb.site_id = c.site_id
  AND COALESCE(tb.besoin_operation_id::text, '') = COALESCE(c.besoin_operation_id::text, '')
  AND COALESCE(tb.planning_genere_bloc_operatoire_id::text, '') = COALESCE(c.planning_genere_bloc_operatoire_id::text, '')
WHERE GREATEST(tb.nombre_besoins - COALESCE(c.nombre_assignes, 0), 0) > 0
ORDER BY tb.date, tb.periode, tb.site_nom;

-- Create unique index to support concurrent refresh
CREATE UNIQUE INDEX besoins_non_satisfaits_summary_unique_idx 
ON public.besoins_non_satisfaits_summary (
  date, 
  periode, 
  site_id, 
  COALESCE(besoin_operation_id::text, ''), 
  COALESCE(planning_genere_bloc_operatoire_id::text, '')
);

-- Refresh the materialized view
REFRESH MATERIALIZED VIEW public.besoins_non_satisfaits_summary;

-- Grant appropriate permissions
GRANT SELECT ON public.besoins_non_satisfaits_summary TO authenticated;
GRANT SELECT ON public.besoins_non_satisfaits_summary TO service_role;