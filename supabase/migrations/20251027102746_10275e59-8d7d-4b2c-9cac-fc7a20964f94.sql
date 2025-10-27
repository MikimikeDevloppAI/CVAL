-- Drop existing materialized view and function
DROP MATERIALIZED VIEW IF EXISTS besoins_non_satisfaits_summary CASCADE;
DROP FUNCTION IF EXISTS refresh_besoins_non_satisfaits() CASCADE;

-- Recreate materialized view with corrected 2F/3F logic
CREATE MATERIALIZED VIEW besoins_non_satisfaits_summary AS
WITH besoins_sites AS (
  SELECT 
    be.date,
    be.demi_journee,
    be.site_id,
    s.nom as site_nom,
    s.fermeture as site_fermeture,
    COUNT(DISTINCT be.medecin_id) as nombre_medecins,
    'site' as type_besoin,
    NULL::uuid as besoin_operation_id,
    NULL::uuid as planning_genere_bloc_id
  FROM besoin_effectif be
  JOIN sites s ON s.id = be.site_id
  WHERE be.actif = true
    AND be.type = 'medecin'
    AND s.actif = true
    AND s.id != '00000000-0000-0000-0000-000000000001'::uuid
  GROUP BY be.date, be.demi_journee, be.site_id, s.nom, s.fermeture
),
capacites_sites AS (
  SELECT 
    ce.date,
    ce.demi_journee,
    ce.site_id,
    COUNT(DISTINCT ce.secretaire_id) as nombre_secretaires
  FROM capacite_effective ce
  WHERE ce.actif = true
    AND ce.site_id != '00000000-0000-0000-0000-000000000001'::uuid
    AND ce.planning_genere_bloc_operatoire_id IS NULL
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
    bs.type_besoin,
    bs.besoin_operation_id,
    bs.planning_genere_bloc_id,
    bs.nombre_medecins as nombre_requis,
    COALESCE(cs.nombre_secretaires, 0) as nombre_assigne,
    GREATEST(bs.nombre_medecins - COALESCE(cs.nombre_secretaires, 0), 0) as deficit,
    0 as deficit_1r,
    0 as deficit_2f
  FROM besoins_sites bs
  LEFT JOIN capacites_sites cs ON cs.date = bs.date 
    AND cs.demi_journee = bs.demi_journee 
    AND cs.site_id = bs.site_id
  WHERE COALESCE(cs.nombre_secretaires, 0) < bs.nombre_medecins
),
besoins_operations AS (
  SELECT DISTINCT
    pgb.date,
    pgb.periode as demi_journee,
    NULL::uuid as site_id,
    NULL::text as site_nom,
    false as site_fermeture,
    NULL::integer as nombre_medecins,
    'operation' as type_besoin,
    bo.id as besoin_operation_id,
    pgb.id as planning_genere_bloc_id,
    tib.nombre_requis,
    bo.nom as besoin_nom,
    bo.code as besoin_code
  FROM planning_genere_bloc_operatoire pgb
  JOIN types_intervention_besoins_personnel tib ON tib.type_intervention_id = pgb.type_intervention_id
  JOIN besoins_operations bo ON bo.id = tib.besoin_operation_id
  WHERE pgb.statut != 'annule'::statut_planning
    AND tib.actif = true
    AND bo.actif = true
),
capacites_operations AS (
  SELECT 
    ce.planning_genere_bloc_operatoire_id,
    ce.besoin_operation_id,
    COUNT(DISTINCT ce.secretaire_id) as nombre_secretaires
  FROM capacite_effective ce
  WHERE ce.actif = true
    AND ce.planning_genere_bloc_operatoire_id IS NOT NULL
    AND ce.besoin_operation_id IS NOT NULL
  GROUP BY ce.planning_genere_bloc_operatoire_id, ce.besoin_operation_id
),
deficits_operations AS (
  SELECT 
    bo.date,
    bo.demi_journee,
    bo.site_id,
    bo.site_nom,
    bo.site_fermeture,
    bo.nombre_medecins,
    bo.type_besoin,
    bo.besoin_operation_id,
    bo.planning_genere_bloc_id,
    bo.nombre_requis,
    COALESCE(co.nombre_secretaires, 0) as nombre_assigne,
    GREATEST(bo.nombre_requis - COALESCE(co.nombre_secretaires, 0), 0) as deficit,
    0 as deficit_1r,
    0 as deficit_2f
  FROM besoins_operations bo
  LEFT JOIN capacites_operations co ON co.planning_genere_bloc_operatoire_id = bo.planning_genere_bloc_id
    AND co.besoin_operation_id = bo.besoin_operation_id
  WHERE COALESCE(co.nombre_secretaires, 0) < bo.nombre_requis
),
besoins_fermeture AS (
  SELECT DISTINCT
    s.id as site_id,
    s.nom as site_nom,
    ce.date
  FROM sites s
  CROSS JOIN capacite_effective ce
  WHERE s.fermeture = true 
    AND s.actif = true
    AND ce.actif = true
    AND ce.site_id = s.id
),
capacites_fermeture_1r AS (
  SELECT 
    ce.date,
    ce.site_id,
    COUNT(DISTINCT CASE WHEN ce.demi_journee = 'matin' THEN ce.id END) as matin_count,
    COUNT(DISTINCT CASE WHEN ce.demi_journee = 'apres_midi' THEN ce.id END) as apres_midi_count
  FROM capacite_effective ce
  WHERE ce.actif = true
    AND ce.is_1r = true
    AND ce.planning_genere_bloc_operatoire_id IS NULL
  GROUP BY ce.date, ce.site_id
),
capacites_fermeture_2f3f AS (
  SELECT 
    ce.date,
    ce.site_id,
    COUNT(DISTINCT CASE WHEN ce.demi_journee = 'matin' THEN ce.id END) as matin_count,
    COUNT(DISTINCT CASE WHEN ce.demi_journee = 'apres_midi' THEN ce.id END) as apres_midi_count
  FROM capacite_effective ce
  WHERE ce.actif = true
    AND (ce.is_2f = true OR ce.is_3f = true)
    AND ce.planning_genere_bloc_operatoire_id IS NULL
  GROUP BY ce.date, ce.site_id
),
deficits_fermeture AS (
  SELECT 
    bf.date,
    'toute_journee'::demi_journee as demi_journee,
    bf.site_id,
    bf.site_nom,
    true as site_fermeture,
    NULL::integer as nombre_medecins,
    'fermeture' as type_besoin,
    NULL::uuid as besoin_operation_id,
    NULL::uuid as planning_genere_bloc_id,
    2 as nombre_requis,
    (CASE WHEN cf1r.matin_count > 0 AND cf1r.apres_midi_count > 0 THEN 1 ELSE 0 END +
     CASE WHEN cf2f3f.matin_count > 0 AND cf2f3f.apres_midi_count > 0 THEN 1 ELSE 0 END) as nombre_assigne,
    2 - (CASE WHEN cf1r.matin_count > 0 AND cf1r.apres_midi_count > 0 THEN 1 ELSE 0 END +
         CASE WHEN cf2f3f.matin_count > 0 AND cf2f3f.apres_midi_count > 0 THEN 1 ELSE 0 END) as deficit,
    CASE WHEN cf1r.matin_count > 0 AND cf1r.apres_midi_count > 0 THEN 0 ELSE 1 END as deficit_1r,
    CASE WHEN cf2f3f.matin_count > 0 AND cf2f3f.apres_midi_count > 0 THEN 0 ELSE 1 END as deficit_2f
  FROM besoins_fermeture bf
  LEFT JOIN capacites_fermeture_1r cf1r ON cf1r.date = bf.date AND cf1r.site_id = bf.site_id
  LEFT JOIN capacites_fermeture_2f3f cf2f3f ON cf2f3f.date = bf.date AND cf2f3f.site_id = bf.site_id
  WHERE (CASE WHEN cf1r.matin_count > 0 AND cf1r.apres_midi_count > 0 THEN 1 ELSE 0 END +
         CASE WHEN cf2f3f.matin_count > 0 AND cf2f3f.apres_midi_count > 0 THEN 1 ELSE 0 END) < 2
)
SELECT * FROM deficits_sites
UNION ALL
SELECT * FROM deficits_operations
UNION ALL
SELECT * FROM deficits_fermeture;

-- Create index on the materialized view
CREATE INDEX idx_besoins_non_satisfaits_date ON besoins_non_satisfaits_summary(date);
CREATE INDEX idx_besoins_non_satisfaits_type ON besoins_non_satisfaits_summary(type_besoin);
CREATE INDEX idx_besoins_non_satisfaits_site ON besoins_non_satisfaits_summary(site_id);

-- Recreate the refresh function
CREATE OR REPLACE FUNCTION refresh_besoins_non_satisfaits()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW besoins_non_satisfaits_summary;
END;
$$;