-- Create materialized view for unfilled needs calculation
CREATE MATERIALIZED VIEW besoins_non_satisfaits_summary AS
WITH besoins_sites AS (
  -- Pour chaque site/date/période, calculer le besoin total
  SELECT 
    be.date,
    be.demi_journee as periode,
    be.site_id,
    s.nom as site_nom,
    NULL::uuid as besoin_operation_id,
    NULL as besoin_operation_nom,
    CEIL(SUM(m.besoin_secretaires)) as nombre_requis,
    'site'::text as type_besoin,
    false as is_fermeture_incomplete
  FROM besoin_effectif be
  JOIN medecins m ON be.medecin_id = m.id
  JOIN sites s ON be.site_id = s.id
  WHERE be.type = 'medecin'
    AND be.actif = true
    AND s.actif = true
    AND s.id != '00000000-0000-0000-0000-000000000001' -- Exclure admin
    AND s.nom != 'Clinique La Vallée - Bloc opératoire' -- Exclure bloc
  GROUP BY be.date, be.demi_journee, be.site_id, s.nom
),
besoins_bloc AS (
  -- Pour chaque intervention bloc, calculer les besoins par type de personnel
  SELECT 
    be.date,
    be.demi_journee as periode,
    s.id as site_id,
    CONCAT('Bloc opératoire - ', ti.nom) as site_nom,
    tibp.besoin_operation_id,
    bo.nom as besoin_operation_nom,
    tibp.nombre_requis,
    'bloc'::text as type_besoin,
    false as is_fermeture_incomplete
  FROM besoin_effectif be
  JOIN types_intervention ti ON be.type_intervention_id = ti.id
  JOIN types_intervention_besoins_personnel tibp ON ti.id = tibp.type_intervention_id
  JOIN besoins_operations bo ON tibp.besoin_operation_id = bo.id
  CROSS JOIN sites s
  WHERE be.type = 'bloc_operatoire'
    AND be.actif = true
    AND tibp.actif = true
    AND s.nom = 'Clinique La Vallée - Bloc opératoire'
),
fermetures_incomplete AS (
  -- Vérifier les sites de fermeture qui n'ont pas de 1R et 2F
  SELECT 
    be.date,
    be.demi_journee as periode,
    s.id as site_id,
    CONCAT(s.nom, ' - Manque responsables') as site_nom,
    NULL::uuid as besoin_operation_id,
    NULL as besoin_operation_nom,
    2 as nombre_requis, -- 1R + 2F
    'fermeture'::text as type_besoin,
    true as is_fermeture_incomplete,
    COUNT(DISTINCT CASE WHEN ce.is_1r THEN ce.secretaire_id END) as count_1r,
    COUNT(DISTINCT CASE WHEN ce.is_2f THEN ce.secretaire_id END) as count_2f
  FROM besoin_effectif be
  JOIN sites s ON be.site_id = s.id
  LEFT JOIN capacite_effective ce ON 
    be.date = ce.date 
    AND be.demi_journee = ce.demi_journee 
    AND be.site_id = ce.site_id
    AND ce.actif = true
  WHERE s.fermeture = true
    AND be.actif = true
    AND be.type = 'medecin'
    AND s.id != '00000000-0000-0000-0000-000000000001'
  GROUP BY be.date, be.demi_journee, s.id, s.nom
  HAVING COUNT(DISTINCT be.medecin_id) > 0 -- Au moins un médecin travaille
    AND (
      COUNT(DISTINCT CASE WHEN ce.is_1r THEN ce.secretaire_id END) = 0
      OR COUNT(DISTINCT CASE WHEN ce.is_2f THEN ce.secretaire_id END) = 0
    )
),
tous_besoins AS (
  SELECT 
    date, periode, site_id, site_nom, besoin_operation_id, 
    besoin_operation_nom, nombre_requis, type_besoin, is_fermeture_incomplete
  FROM besoins_sites
  UNION ALL
  SELECT 
    date, periode, site_id, site_nom, besoin_operation_id, 
    besoin_operation_nom, nombre_requis, type_besoin, is_fermeture_incomplete
  FROM besoins_bloc
  UNION ALL
  SELECT 
    date, periode, site_id, site_nom, besoin_operation_id, 
    besoin_operation_nom, nombre_requis, type_besoin, is_fermeture_incomplete
  FROM fermetures_incomplete
),
capacites_assignees AS (
  -- Compter les capacités assignées
  SELECT 
    ce.date,
    ce.demi_journee as periode,
    ce.site_id,
    COALESCE(ce.besoin_operation_id, '00000000-0000-0000-0000-000000000000'::uuid) as besoin_operation_id,
    COUNT(DISTINCT ce.secretaire_id) as nombre_assigne
  FROM capacite_effective ce
  WHERE ce.actif = true
    AND ce.secretaire_id IS NOT NULL
  GROUP BY ce.date, ce.demi_journee, ce.site_id, COALESCE(ce.besoin_operation_id, '00000000-0000-0000-0000-000000000000'::uuid)
)
SELECT 
  tb.date,
  tb.periode,
  tb.site_id,
  tb.site_nom,
  tb.besoin_operation_id,
  tb.besoin_operation_nom,
  tb.nombre_requis,
  COALESCE(ca.nombre_assigne, 0) as nombre_assigne,
  tb.nombre_requis - COALESCE(ca.nombre_assigne, 0) as manque,
  tb.type_besoin,
  tb.is_fermeture_incomplete
FROM tous_besoins tb
LEFT JOIN capacites_assignees ca ON 
  tb.date = ca.date 
  AND tb.periode = ca.periode 
  AND tb.site_id = ca.site_id
  AND COALESCE(tb.besoin_operation_id, '00000000-0000-0000-0000-000000000000'::uuid) = ca.besoin_operation_id
WHERE tb.nombre_requis > COALESCE(ca.nombre_assigne, 0)
ORDER BY tb.date, tb.periode, tb.site_nom;

-- Create unique index for concurrent refresh
CREATE UNIQUE INDEX idx_besoins_non_satisfaits_unique 
ON besoins_non_satisfaits_summary(date, periode, site_id, COALESCE(besoin_operation_id, '00000000-0000-0000-0000-000000000000'::uuid), type_besoin);

-- Create performance indexes
CREATE INDEX idx_besoins_non_satisfaits_date ON besoins_non_satisfaits_summary(date);
CREATE INDEX idx_besoins_non_satisfaits_manque ON besoins_non_satisfaits_summary(manque) WHERE manque > 0;

-- Function to refresh the materialized view
CREATE OR REPLACE FUNCTION refresh_besoins_non_satisfaits()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY besoins_non_satisfaits_summary;
END;
$$;

-- Trigger function to refresh the view
CREATE OR REPLACE FUNCTION trigger_refresh_besoins()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM refresh_besoins_non_satisfaits();
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Triggers on besoin_effectif
CREATE TRIGGER refresh_on_besoin_effectif_change
AFTER INSERT OR UPDATE OR DELETE ON besoin_effectif
FOR EACH STATEMENT
EXECUTE FUNCTION trigger_refresh_besoins();

-- Triggers on capacite_effective
CREATE TRIGGER refresh_on_capacite_effective_change
AFTER INSERT OR UPDATE OR DELETE ON capacite_effective
FOR EACH STATEMENT
EXECUTE FUNCTION trigger_refresh_besoins();

-- Enable RLS on the materialized view
ALTER MATERIALIZED VIEW besoins_non_satisfaits_summary OWNER TO postgres;

-- Grant access to authenticated users
GRANT SELECT ON besoins_non_satisfaits_summary TO authenticated;