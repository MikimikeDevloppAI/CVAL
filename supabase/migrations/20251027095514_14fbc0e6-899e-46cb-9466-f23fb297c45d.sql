-- Drop the existing materialized view and recreate with correct bloc site name
DROP MATERIALIZED VIEW IF EXISTS public.besoins_non_satisfaits_summary CASCADE;

-- Recreate the materialized view with corrected bloc site name
CREATE MATERIALIZED VIEW public.besoins_non_satisfaits_summary AS
WITH 
bloc_site AS (
  SELECT id FROM public.sites WHERE nom = 'Bloc opératoire' LIMIT 1
),
besoins_sites AS (
  SELECT 
    be.date,
    be.demi_journee,
    be.site_id,
    s.nom as site_nom,
    s.fermeture as site_fermeture,
    COUNT(DISTINCT be.medecin_id) as nombre_medecins,
    SUM(COALESCE(m.besoin_secretaires, 1.2)) as besoins_total
  FROM public.besoin_effectif be
  JOIN public.sites s ON s.id = be.site_id
  LEFT JOIN public.medecins m ON m.id = be.medecin_id
  WHERE be.actif = true 
    AND be.type = 'medecin'
    AND be.site_id NOT IN (SELECT id FROM bloc_site)
  GROUP BY be.date, be.demi_journee, be.site_id, s.nom, s.fermeture
),
besoins_bloc AS (
  SELECT 
    pgbo.date,
    pgbo.periode as demi_journee,
    (SELECT id FROM bloc_site) as site_id,
    'Bloc opératoire' as site_nom,
    false as site_fermeture,
    COUNT(DISTINCT pgbo.id) as nombre_operations,
    0 as besoins_total
  FROM public.planning_genere_bloc_operatoire pgbo
  WHERE pgbo.statut != 'annule'
  GROUP BY pgbo.date, pgbo.periode
),
besoins_fermeture AS (
  SELECT 
    ce.date,
    ce.demi_journee,
    ce.site_id,
    s.nom as site_nom,
    true as site_fermeture,
    0 as nombre_entites,
    0 as besoins_total
  FROM public.capacite_effective ce
  JOIN public.sites s ON s.id = ce.site_id
  WHERE s.fermeture = true
    AND ce.actif = true
    AND NOT (ce.is_1r OR ce.is_2f OR ce.is_3f)
  GROUP BY ce.date, ce.demi_journee, ce.site_id, s.nom
),
capacites AS (
  SELECT 
    ce.date,
    ce.demi_journee,
    ce.site_id,
    COUNT(DISTINCT CASE WHEN ce.secretaire_id IS NOT NULL THEN ce.secretaire_id END) as nombre_secretaires
  FROM public.capacite_effective ce
  WHERE ce.actif = true
    AND NOT (ce.is_1r OR ce.is_2f OR ce.is_3f)
  GROUP BY ce.date, ce.demi_journee, ce.site_id
),
tous_besoins AS (
  SELECT 
    date, demi_journee, site_id, site_nom, site_fermeture,
    nombre_medecins as nombre_entites, besoins_total,
    'site' as type_besoin
  FROM besoins_sites
  
  UNION ALL
  
  SELECT 
    date, demi_journee, site_id, site_nom, site_fermeture,
    nombre_operations as nombre_entites, besoins_total,
    'bloc' as type_besoin
  FROM besoins_bloc
  
  UNION ALL
  
  SELECT 
    date, demi_journee, site_id, site_nom, site_fermeture,
    nombre_entites, besoins_total,
    'fermeture' as type_besoin
  FROM besoins_fermeture
)
SELECT 
  tb.date,
  tb.demi_journee,
  tb.site_id,
  tb.site_nom,
  tb.site_fermeture,
  tb.nombre_entites,
  tb.type_besoin,
  CASE 
    WHEN tb.type_besoin = 'bloc' THEN tb.nombre_entites
    WHEN tb.type_besoin = 'fermeture' THEN 1
    ELSE CEIL(tb.besoins_total)
  END as nombre_requis,
  COALESCE(c.nombre_secretaires, 0) as nombre_assigne,
  CASE 
    WHEN tb.type_besoin = 'bloc' THEN 
      GREATEST(0, tb.nombre_entites - COALESCE(c.nombre_secretaires, 0))
    WHEN tb.type_besoin = 'fermeture' THEN
      GREATEST(0, 1 - COALESCE(c.nombre_secretaires, 0))
    ELSE 
      GREATEST(0, CEIL(tb.besoins_total) - COALESCE(c.nombre_secretaires, 0))
  END as deficit
FROM tous_besoins tb
LEFT JOIN capacites c ON c.date = tb.date 
  AND c.demi_journee = tb.demi_journee 
  AND c.site_id = tb.site_id
WHERE CASE 
  WHEN tb.type_besoin = 'bloc' THEN 
    tb.nombre_entites > COALESCE(c.nombre_secretaires, 0)
  WHEN tb.type_besoin = 'fermeture' THEN
    1 > COALESCE(c.nombre_secretaires, 0)
  ELSE 
    CEIL(tb.besoins_total) > COALESCE(c.nombre_secretaires, 0)
END;

-- Create unique index for concurrent refresh
CREATE UNIQUE INDEX idx_besoins_non_satisfaits_summary_unique 
ON public.besoins_non_satisfaits_summary(date, demi_journee, site_id);

-- Grant permissions
GRANT SELECT ON public.besoins_non_satisfaits_summary TO authenticated;
GRANT SELECT ON public.besoins_non_satisfaits_summary TO service_role;

-- Refresh the view immediately
REFRESH MATERIALIZED VIEW public.besoins_non_satisfaits_summary;