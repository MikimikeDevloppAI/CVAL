-- Drop all existing triggers first
DROP TRIGGER IF EXISTS trigger_refresh_besoins_on_besoin ON public.besoin_effectif;
DROP TRIGGER IF EXISTS trigger_refresh_besoins_on_capacite ON public.capacite_effective;
DROP TRIGGER IF EXISTS trigger_refresh_besoins_on_planning_bloc ON public.planning_genere_bloc_operatoire;
DROP TRIGGER IF EXISTS refresh_on_besoin_effectif_change ON public.besoin_effectif;
DROP TRIGGER IF EXISTS refresh_on_capacite_effective_change ON public.capacite_effective;

-- Drop function with CASCADE to remove any remaining dependencies
DROP FUNCTION IF EXISTS public.trigger_refresh_besoins() CASCADE;
DROP FUNCTION IF EXISTS public.refresh_besoins_non_satisfaits() CASCADE;

-- Drop materialized view with CASCADE
DROP MATERIALIZED VIEW IF EXISTS public.besoins_non_satisfaits_summary CASCADE;

-- Recreate materialized view with corrected logic for bloc operatoire
CREATE MATERIALIZED VIEW public.besoins_non_satisfaits_summary AS
WITH besoins_sites AS (
  -- Besoins des sites (médecins)
  SELECT 
    be.date,
    be.demi_journee as periode,
    be.site_id,
    s.nom as site_nom,
    NULL::uuid as planning_genere_bloc_operatoire_id,
    NULL::uuid as besoin_operation_id,
    NULL::text as besoin_operation_nom,
    CEIL(SUM(m.besoin_secretaires)) as nombre_requis,
    'site'::text as type_besoin,
    false as is_fermeture_incomplete
  FROM besoin_effectif be
  JOIN medecins m ON be.medecin_id = m.id
  JOIN sites s ON be.site_id = s.id
  WHERE be.type = 'medecin'
    AND be.actif = true
    AND s.actif = true
    AND s.nom != 'Clinique La Vallée - Administratif'
  GROUP BY be.date, be.demi_journee, be.site_id, s.nom
),

besoins_bloc AS (
  -- Besoins du bloc opératoire - UN BESOIN PAR OPÉRATION
  SELECT 
    pgbo.date,
    pgbo.periode as periode,
    s.id as site_id,
    CONCAT('Bloc - ', ti.nom, CASE WHEN m.name IS NOT NULL THEN CONCAT(' - Dr ', m.name) ELSE '' END) as site_nom,
    pgbo.id as planning_genere_bloc_operatoire_id,
    tibp.besoin_operation_id,
    bo.nom as besoin_operation_nom,
    tibp.nombre_requis,
    'bloc'::text as type_besoin,
    false as is_fermeture_incomplete
  FROM planning_genere_bloc_operatoire pgbo
  JOIN types_intervention ti ON pgbo.type_intervention_id = ti.id
  JOIN types_intervention_besoins_personnel tibp ON ti.id = tibp.type_intervention_id AND tibp.actif = true
  JOIN besoins_operations bo ON tibp.besoin_operation_id = bo.id
  LEFT JOIN medecins m ON pgbo.medecin_id = m.id
  CROSS JOIN sites s
  WHERE pgbo.statut != 'annule'::statut_planning
    AND s.nom = 'Clinique La Vallée - Bloc opératoire'
),

besoins_fermetures AS (
  -- Besoins pour fermetures de sites (1R + 2F)
  SELECT 
    be.date,
    be.demi_journee as periode,
    be.site_id,
    s.nom as site_nom,
    NULL::uuid as planning_genere_bloc_operatoire_id,
    NULL::uuid as besoin_operation_id,
    NULL::text as besoin_operation_nom,
    2 as nombre_requis,
    'fermeture'::text as type_besoin,
    true as is_fermeture_incomplete
  FROM besoin_effectif be
  JOIN sites s ON be.site_id = s.id
  WHERE s.fermeture = true
    AND be.actif = true
    AND be.type = 'medecin'
  GROUP BY be.date, be.demi_journee, be.site_id, s.nom
),

tous_besoins AS (
  SELECT * FROM besoins_sites
  UNION ALL
  SELECT * FROM besoins_bloc
  UNION ALL
  SELECT * FROM besoins_fermetures
),

capacites_assignees AS (
  SELECT 
    ce.date,
    ce.demi_journee as periode,
    ce.site_id,
    ce.planning_genere_bloc_operatoire_id,
    COALESCE(ce.besoin_operation_id, '00000000-0000-0000-0000-000000000000'::uuid) as besoin_operation_id,
    COUNT(DISTINCT ce.secretaire_id) as nombre_assigne
  FROM capacite_effective ce
  WHERE ce.actif = true
    AND ce.secretaire_id IS NOT NULL
  GROUP BY 
    ce.date, 
    ce.demi_journee, 
    ce.site_id, 
    ce.planning_genere_bloc_operatoire_id,
    COALESCE(ce.besoin_operation_id, '00000000-0000-0000-0000-000000000000'::uuid)
),

responsables_fermetures AS (
  SELECT 
    ce.date,
    ce.demi_journee as periode,
    ce.site_id,
    BOOL_OR(ce.is_1r) as has_1r,
    BOOL_OR(ce.is_2f) as has_2f
  FROM capacite_effective ce
  JOIN sites s ON ce.site_id = s.id
  WHERE s.fermeture = true
    AND ce.actif = true
    AND ce.secretaire_id IS NOT NULL
  GROUP BY ce.date, ce.demi_journee, ce.site_id
)

SELECT 
  tb.date,
  tb.periode,
  tb.site_id,
  tb.site_nom,
  tb.planning_genere_bloc_operatoire_id,
  tb.besoin_operation_id,
  tb.besoin_operation_nom,
  tb.nombre_requis,
  COALESCE(ca.nombre_assigne, 0) as nombre_assigne,
  (tb.nombre_requis - COALESCE(ca.nombre_assigne, 0)) as manque,
  tb.type_besoin,
  CASE 
    WHEN tb.type_besoin = 'fermeture' THEN 
      NOT (COALESCE(rf.has_1r, false) AND COALESCE(rf.has_2f, false))
    ELSE tb.is_fermeture_incomplete
  END as is_fermeture_incomplete
FROM tous_besoins tb
LEFT JOIN capacites_assignees ca ON 
  tb.date = ca.date 
  AND tb.periode = ca.periode 
  AND tb.site_id = ca.site_id
  AND COALESCE(tb.planning_genere_bloc_operatoire_id, '00000000-0000-0000-0000-000000000000'::uuid) 
    = COALESCE(ca.planning_genere_bloc_operatoire_id, '00000000-0000-0000-0000-000000000000'::uuid)
  AND COALESCE(tb.besoin_operation_id, '00000000-0000-0000-0000-000000000000'::uuid) 
    = ca.besoin_operation_id
LEFT JOIN responsables_fermetures rf ON
  tb.date = rf.date
  AND tb.periode = rf.periode
  AND tb.site_id = rf.site_id
  AND tb.type_besoin = 'fermeture';

-- Create indices for performance
CREATE INDEX idx_besoins_non_satisfaits_date ON public.besoins_non_satisfaits_summary(date);
CREATE INDEX idx_besoins_non_satisfaits_manque ON public.besoins_non_satisfaits_summary(manque) WHERE manque > 0;
CREATE INDEX idx_besoins_non_satisfaits_site ON public.besoins_non_satisfaits_summary(site_id);
CREATE INDEX idx_besoins_non_satisfaits_pgbo ON public.besoins_non_satisfaits_summary(planning_genere_bloc_operatoire_id) WHERE planning_genere_bloc_operatoire_id IS NOT NULL;

-- Create function to refresh the materialized view
CREATE OR REPLACE FUNCTION public.refresh_besoins_non_satisfaits()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY besoins_non_satisfaits_summary;
END;
$function$;

-- Create trigger function
CREATE OR REPLACE FUNCTION public.trigger_refresh_besoins()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM refresh_besoins_non_satisfaits();
  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- Create triggers on relevant tables
CREATE TRIGGER trigger_refresh_besoins_on_besoin
  AFTER INSERT OR UPDATE OR DELETE ON public.besoin_effectif
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.trigger_refresh_besoins();

CREATE TRIGGER trigger_refresh_besoins_on_capacite
  AFTER INSERT OR UPDATE OR DELETE ON public.capacite_effective
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.trigger_refresh_besoins();

CREATE TRIGGER trigger_refresh_besoins_on_planning_bloc
  AFTER INSERT OR UPDATE OR DELETE ON public.planning_genere_bloc_operatoire
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.trigger_refresh_besoins();

-- Initial refresh
REFRESH MATERIALIZED VIEW public.besoins_non_satisfaits_summary;