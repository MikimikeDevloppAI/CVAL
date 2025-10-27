-- Drop existing materialized view
DROP MATERIALIZED VIEW IF EXISTS public.besoins_non_satisfaits_summary CASCADE;

-- Recreate the materialized view with correct logic
CREATE MATERIALIZED VIEW public.besoins_non_satisfaits_summary AS
WITH 
-- 1. Sites normaux (hors bloc opératoire)
besoins_sites AS (
  SELECT 
    be.date,
    be.demi_journee,
    be.site_id,
    s.nom as site_nom,
    s.fermeture as site_fermeture,
    COUNT(DISTINCT be.medecin_id) as nombre_medecins,
    CEIL(SUM(COALESCE(m.besoin_secretaires, 1.2))) as nombre_requis
  FROM public.besoin_effectif be
  JOIN public.sites s ON s.id = be.site_id
  LEFT JOIN public.medecins m ON m.id = be.medecin_id
  WHERE be.actif = true 
    AND be.type = 'medecin'
    AND s.nom != 'Bloc opératoire'
  GROUP BY be.date, be.demi_journee, be.site_id, s.nom, s.fermeture
),
capacites_sites AS (
  SELECT 
    ce.date,
    ce.demi_journee,
    ce.site_id,
    COUNT(*) as nombre_assigne
  FROM public.capacite_effective ce
  WHERE ce.actif = true
    AND ce.secretaire_id IS NOT NULL
  GROUP BY ce.date, ce.demi_journee, ce.site_id
),
deficits_sites AS (
  SELECT 
    bs.date,
    bs.demi_journee,
    bs.site_id,
    bs.site_nom,
    bs.site_fermeture,
    bs.nombre_medecins,
    'site'::text as type_besoin,
    NULL::uuid as besoin_operation_id,
    NULL::uuid as planning_bloc_id,
    bs.nombre_requis,
    COALESCE(cs.nombre_assigne, 0) as nombre_assigne,
    bs.nombre_requis - COALESCE(cs.nombre_assigne, 0) as deficit,
    0 as deficit_1r,
    0 as deficit_2f
  FROM besoins_sites bs
  LEFT JOIN capacites_sites cs ON cs.date = bs.date 
    AND cs.demi_journee = bs.demi_journee 
    AND cs.site_id = bs.site_id
  WHERE bs.nombre_requis > COALESCE(cs.nombre_assigne, 0)
),

-- 2. Bloc opératoire
besoins_bloc_detaille AS (
  SELECT 
    pgbo.id as planning_id,
    pgbo.date,
    pgbo.periode as demi_journee,
    pgbo.type_intervention_id,
    tib.besoin_operation_id,
    tib.nombre_requis,
    bo.nom as besoin_operation_nom
  FROM public.planning_genere_bloc_operatoire pgbo
  JOIN public.types_intervention_besoins_personnel tib 
    ON tib.type_intervention_id = pgbo.type_intervention_id
  JOIN public.besoins_operations bo ON bo.id = tib.besoin_operation_id
  WHERE pgbo.statut != 'annule'::statut_planning
    AND tib.actif = true
),
capacites_bloc AS (
  SELECT 
    ce.date,
    ce.demi_journee,
    ce.planning_genere_bloc_operatoire_id,
    ce.besoin_operation_id,
    COUNT(*) as nombre_assigne
  FROM public.capacite_effective ce
  WHERE ce.actif = true
    AND ce.planning_genere_bloc_operatoire_id IS NOT NULL
    AND ce.besoin_operation_id IS NOT NULL
  GROUP BY ce.date, ce.demi_journee, 
    ce.planning_genere_bloc_operatoire_id, 
    ce.besoin_operation_id
),
deficits_bloc AS (
  SELECT 
    bbd.date,
    bbd.demi_journee,
    (SELECT id FROM public.sites WHERE nom = 'Bloc opératoire' LIMIT 1) as site_id,
    'Bloc opératoire' as site_nom,
    false as site_fermeture,
    0 as nombre_medecins,
    'bloc'::text as type_besoin,
    bbd.besoin_operation_id,
    bbd.planning_id as planning_bloc_id,
    bbd.nombre_requis,
    COALESCE(cb.nombre_assigne, 0) as nombre_assigne,
    bbd.nombre_requis - COALESCE(cb.nombre_assigne, 0) as deficit,
    0 as deficit_1r,
    0 as deficit_2f
  FROM besoins_bloc_detaille bbd
  LEFT JOIN capacites_bloc cb 
    ON cb.date = bbd.date 
    AND cb.demi_journee = bbd.demi_journee
    AND cb.planning_genere_bloc_operatoire_id = bbd.planning_id
    AND cb.besoin_operation_id = bbd.besoin_operation_id
  WHERE bbd.nombre_requis > COALESCE(cb.nombre_assigne, 0)
),

-- 3. Fermetures (1R/2F/3F)
sites_fermeture_besoins AS (
  SELECT DISTINCT
    be.date,
    be.demi_journee,
    be.site_id,
    s.nom as site_nom
  FROM public.besoin_effectif be
  JOIN public.sites s ON s.id = be.site_id
  WHERE s.fermeture = true
    AND be.actif = true
),
capacites_fermeture AS (
  SELECT 
    ce.date,
    ce.demi_journee,
    ce.site_id,
    COUNT(*) FILTER (WHERE ce.is_1r = true) as nb_1r,
    COUNT(*) FILTER (WHERE ce.is_2f = true) as nb_2f
  FROM public.capacite_effective ce
  WHERE ce.actif = true
  GROUP BY ce.date, ce.demi_journee, ce.site_id
),
deficits_fermeture AS (
  SELECT 
    sfb.date,
    sfb.demi_journee,
    sfb.site_id,
    sfb.site_nom,
    true as site_fermeture,
    0 as nombre_medecins,
    'fermeture'::text as type_besoin,
    NULL::uuid as besoin_operation_id,
    NULL::uuid as planning_bloc_id,
    3 as nombre_requis,
    COALESCE(cf.nb_1r, 0) + COALESCE(cf.nb_2f, 0) as nombre_assigne,
    GREATEST(0, 1 - COALESCE(cf.nb_1r, 0)) + GREATEST(0, 2 - COALESCE(cf.nb_2f, 0)) as deficit,
    GREATEST(0, 1 - COALESCE(cf.nb_1r, 0)) as deficit_1r,
    GREATEST(0, 2 - COALESCE(cf.nb_2f, 0)) as deficit_2f
  FROM sites_fermeture_besoins sfb
  LEFT JOIN capacites_fermeture cf 
    ON cf.date = sfb.date 
    AND cf.demi_journee = sfb.demi_journee 
    AND cf.site_id = sfb.site_id
  WHERE (1 > COALESCE(cf.nb_1r, 0)) OR (2 > COALESCE(cf.nb_2f, 0))
)

-- Union finale des 3 types de déficits
SELECT 
  date,
  demi_journee,
  site_id,
  site_nom,
  site_fermeture,
  nombre_medecins,
  type_besoin,
  besoin_operation_id,
  planning_bloc_id,
  nombre_requis,
  nombre_assigne,
  deficit,
  deficit_1r,
  deficit_2f
FROM deficits_sites

UNION ALL

SELECT 
  date,
  demi_journee,
  site_id,
  site_nom,
  site_fermeture,
  nombre_medecins,
  type_besoin,
  besoin_operation_id,
  planning_bloc_id,
  nombre_requis,
  nombre_assigne,
  deficit,
  deficit_1r,
  deficit_2f
FROM deficits_bloc

UNION ALL

SELECT 
  date,
  demi_journee,
  site_id,
  site_nom,
  site_fermeture,
  nombre_medecins,
  type_besoin,
  besoin_operation_id,
  planning_bloc_id,
  nombre_requis,
  nombre_assigne,
  deficit,
  deficit_1r,
  deficit_2f
FROM deficits_fermeture

ORDER BY date, demi_journee, site_nom;

-- Create unique index
CREATE UNIQUE INDEX idx_besoins_non_satisfaits_summary_unique 
ON public.besoins_non_satisfaits_summary (date, demi_journee, site_id, type_besoin, COALESCE(besoin_operation_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(planning_bloc_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Grant permissions
GRANT SELECT ON public.besoins_non_satisfaits_summary TO authenticated;
GRANT SELECT ON public.besoins_non_satisfaits_summary TO service_role;

-- Refresh the view
REFRESH MATERIALIZED VIEW public.besoins_non_satisfaits_summary;