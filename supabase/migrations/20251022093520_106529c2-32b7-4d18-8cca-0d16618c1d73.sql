-- Drop existing materialized view and indexes
DROP MATERIALIZED VIEW IF EXISTS public.besoins_non_satisfaits_summary CASCADE;

-- Recreate the materialized view with corrected logic for operating room needs
CREATE MATERIALIZED VIEW public.besoins_non_satisfaits_summary AS
WITH besoins_sites AS (
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
    COUNT(DISTINCT be.medecin_id) AS nombre_besoins
  FROM public.besoin_effectif be
  JOIN public.sites s ON s.id = be.site_id
  WHERE be.type = 'medecin'
    AND be.actif = true
    AND be.demi_journee IN ('matin', 'apres_midi')
  GROUP BY be.date, be.demi_journee, be.site_id, s.nom
),
besoins_bloc AS (
  SELECT
    pgbo.date,
    CASE 
      WHEN pgbo.periode = 'matin' THEN 'matin'
      WHEN pgbo.periode = 'apres_midi' THEN 'apres_midi'
    END AS periode,
    (SELECT id FROM public.sites WHERE nom = 'Clinique La Vallée - Bloc opératoire' LIMIT 1) AS site_id,
    'Clinique La Vallée - Bloc opératoire (Op #' || pgbo.id::text || ')' AS site_nom,
    tibp.besoin_operation_id,
    pgbo.id AS planning_genere_bloc_operatoire_id,
    'bloc_operatoire' AS type_besoin,
    SUM(tibp.nombre_requis) AS nombre_besoins
  FROM public.planning_genere_bloc_operatoire pgbo
  JOIN public.types_intervention_besoins_personnel tibp ON tibp.type_intervention_id = pgbo.type_intervention_id
  WHERE pgbo.statut != 'annule'
    AND tibp.actif = true
  GROUP BY pgbo.date, pgbo.periode, pgbo.id, tibp.besoin_operation_id
),
tous_besoins AS (
  SELECT * FROM besoins_sites
  UNION ALL
  SELECT * FROM besoins_bloc
),
capacites_assignees AS (
  SELECT
    ce.date,
    CASE 
      WHEN ce.demi_journee = 'matin' THEN 'matin'
      WHEN ce.demi_journee = 'apres_midi' THEN 'apres_midi'
    END AS periode,
    ce.site_id,
    ce.besoin_operation_id,
    ce.planning_genere_bloc_operatoire_id,
    COUNT(DISTINCT ce.secretaire_id) AS nombre_assignes
  FROM public.capacite_effective ce
  WHERE ce.actif = true
    AND ce.demi_journee IN ('matin', 'apres_midi')
  GROUP BY ce.date, ce.demi_journee, ce.site_id, ce.besoin_operation_id, ce.planning_genere_bloc_operatoire_id
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
  COALESCE(ca.nombre_assignes, 0) AS nombre_assignes,
  GREATEST(0, tb.nombre_besoins - COALESCE(ca.nombre_assignes, 0)) AS nombre_manquant
FROM tous_besoins tb
LEFT JOIN capacites_assignees ca 
  ON ca.date = tb.date 
  AND ca.periode = tb.periode 
  AND ca.site_id = tb.site_id
  AND COALESCE(ca.besoin_operation_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(tb.besoin_operation_id, '00000000-0000-0000-0000-000000000000'::uuid)
  AND COALESCE(ca.planning_genere_bloc_operatoire_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(tb.planning_genere_bloc_operatoire_id, '00000000-0000-0000-0000-000000000000'::uuid)
WHERE GREATEST(0, tb.nombre_besoins - COALESCE(ca.nombre_assignes, 0)) > 0
ORDER BY tb.date, tb.periode, tb.site_nom;

-- Create unique index to allow concurrent refresh
CREATE UNIQUE INDEX idx_besoins_non_satisfaits_unique 
ON public.besoins_non_satisfaits_summary(
  date, 
  periode, 
  site_id, 
  COALESCE(planning_genere_bloc_operatoire_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(besoin_operation_id, '00000000-0000-0000-0000-000000000000'::uuid), 
  type_besoin
);

-- Create additional performance indexes
CREATE INDEX idx_besoins_non_satisfaits_date ON public.besoins_non_satisfaits_summary(date);
CREATE INDEX idx_besoins_non_satisfaits_site ON public.besoins_non_satisfaits_summary(site_id);
CREATE INDEX idx_besoins_non_satisfaits_type ON public.besoins_non_satisfaits_summary(type_besoin);

-- Perform initial refresh
REFRESH MATERIALIZED VIEW public.besoins_non_satisfaits_summary;