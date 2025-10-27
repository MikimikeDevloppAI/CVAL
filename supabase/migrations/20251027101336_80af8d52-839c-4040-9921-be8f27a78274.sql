-- Drop existing materialized view
DROP MATERIALIZED VIEW IF EXISTS besoins_non_satisfaits_summary;

-- Recreate with corrected logic
CREATE MATERIALIZED VIEW besoins_non_satisfaits_summary AS
WITH 
-- Sites normaux (excluant Bloc opératoire)
besoins_sites AS (
  SELECT 
    be.date,
    be.demi_journee,
    be.site_id,
    s.nom as site_nom,
    s.fermeture as site_fermeture,
    COUNT(DISTINCT be.medecin_id) as nombre_medecins,
    CEIL(SUM(m.besoin_secretaires)) as nombre_requis
  FROM besoin_effectif be
  JOIN sites s ON s.id = be.site_id
  JOIN medecins m ON m.id = be.medecin_id
  WHERE be.type = 'medecin'
    AND be.actif = true
    AND s.actif = true
    AND s.fermeture = false
    AND s.id != '86f1047f-c4ff-441f-a064-42ee2f8ef37a'  -- Exclure Bloc opératoire
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
    AND ce.site_id != '86f1047f-c4ff-441f-a064-42ee2f8ef37a'  -- Exclure Bloc opératoire
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
    'site' as type_besoin,
    NULL::uuid as besoin_operation_id,
    NULL::uuid as planning_genere_bloc_id,
    bs.nombre_requis,
    COALESCE(cs.nombre_secretaires, 0) as nombre_assigne,
    bs.nombre_requis - COALESCE(cs.nombre_secretaires, 0) as deficit,
    0 as deficit_1r,
    0 as deficit_2f
  FROM besoins_sites bs
  LEFT JOIN capacites_sites cs 
    ON cs.date = bs.date 
    AND cs.demi_journee = bs.demi_journee 
    AND cs.site_id = bs.site_id
  WHERE bs.nombre_requis > COALESCE(cs.nombre_secretaires, 0)
),

-- Pour chaque opération planifiée, obtenir tous les besoins de personnel
besoins_bloc_detail AS (
  SELECT 
    pgb.id as planning_genere_bloc_id,
    pgb.date,
    pgb.periode as demi_journee,
    pgb.type_intervention_id,
    pgb.medecin_id,
    m.name as medecin_nom,
    m.first_name as medecin_prenom,
    tipb.besoin_operation_id,
    bo.nom as besoin_operation_nom,
    tipb.nombre_requis
  FROM planning_genere_bloc_operatoire pgb
  JOIN medecins m ON m.id = pgb.medecin_id
  JOIN types_intervention_besoins_personnel tipb ON tipb.type_intervention_id = pgb.type_intervention_id
  JOIN besoins_operations bo ON bo.id = tipb.besoin_operation_id
  WHERE pgb.statut != 'annule'
    AND tipb.actif = true
),

-- Compter les capacités assignées par opération ET par besoin
capacites_bloc_detail AS (
  SELECT 
    ce.planning_genere_bloc_operatoire_id,
    ce.besoin_operation_id,
    COUNT(DISTINCT ce.secretaire_id) as nombre_assigne
  FROM capacite_effective ce
  WHERE ce.actif = true
    AND ce.planning_genere_bloc_operatoire_id IS NOT NULL
    AND ce.besoin_operation_id IS NOT NULL
  GROUP BY ce.planning_genere_bloc_operatoire_id, ce.besoin_operation_id
),

-- Créer une ligne de déficit pour chaque besoin non satisfait
deficits_bloc AS (
  SELECT 
    bbd.date,
    bbd.demi_journee,
    NULL::uuid as site_id,
    (bbd.medecin_nom || ' ' || bbd.medecin_prenom || ' - ' || bbd.besoin_operation_nom) as site_nom,
    false as site_fermeture,
    NULL::integer as nombre_medecins,
    'bloc_operatoire' as type_besoin,
    bbd.besoin_operation_id,
    bbd.planning_genere_bloc_id,
    bbd.nombre_requis,
    COALESCE(cbd.nombre_assigne, 0) as nombre_assigne,
    bbd.nombre_requis - COALESCE(cbd.nombre_assigne, 0) as deficit,
    0 as deficit_1r,
    0 as deficit_2f
  FROM besoins_bloc_detail bbd
  LEFT JOIN capacites_bloc_detail cbd 
    ON cbd.planning_genere_bloc_operatoire_id = bbd.planning_genere_bloc_id
    AND cbd.besoin_operation_id = bbd.besoin_operation_id
  WHERE bbd.nombre_requis > COALESCE(cbd.nombre_assigne, 0)
),

-- Sites de fermeture (inchangé)
besoins_fermeture_detail AS (
  SELECT 
    be.date,
    be.demi_journee,
    be.site_id,
    s.nom as site_nom
  FROM besoin_effectif be
  JOIN sites s ON s.id = be.site_id
  WHERE be.type = 'medecin'
    AND be.actif = true
    AND s.actif = true
    AND s.fermeture = true
  GROUP BY be.date, be.demi_journee, be.site_id, s.nom
),

besoins_fermeture AS (
  SELECT 
    date,
    site_id,
    site_nom,
    COUNT(*) as periodes_count
  FROM besoins_fermeture_detail
  GROUP BY date, site_id, site_nom
  HAVING COUNT(*) = 2
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

capacites_fermeture_2f AS (
  SELECT 
    ce.date,
    ce.site_id,
    COUNT(DISTINCT CASE WHEN ce.demi_journee = 'matin' THEN ce.id END) as matin_count,
    COUNT(DISTINCT CASE WHEN ce.demi_journee = 'apres_midi' THEN ce.id END) as apres_midi_count
  FROM capacite_effective ce
  WHERE ce.actif = true
    AND ce.is_2f = true
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
     CASE WHEN cf2f.matin_count > 0 AND cf2f.apres_midi_count > 0 THEN 1 ELSE 0 END) as nombre_assigne,
    2 - (CASE WHEN cf1r.matin_count > 0 AND cf1r.apres_midi_count > 0 THEN 1 ELSE 0 END +
         CASE WHEN cf2f.matin_count > 0 AND cf2f.apres_midi_count > 0 THEN 1 ELSE 0 END) as deficit,
    CASE WHEN cf1r.matin_count > 0 AND cf1r.apres_midi_count > 0 THEN 0 ELSE 1 END as deficit_1r,
    CASE WHEN cf2f.matin_count > 0 AND cf2f.apres_midi_count > 0 THEN 0 ELSE 1 END as deficit_2f
  FROM besoins_fermeture bf
  LEFT JOIN capacites_fermeture_1r cf1r ON cf1r.date = bf.date AND cf1r.site_id = bf.site_id
  LEFT JOIN capacites_fermeture_2f cf2f ON cf2f.date = bf.date AND cf2f.site_id = bf.site_id
  WHERE (CASE WHEN cf1r.matin_count > 0 AND cf1r.apres_midi_count > 0 THEN 1 ELSE 0 END +
         CASE WHEN cf2f.matin_count > 0 AND cf2f.apres_midi_count > 0 THEN 1 ELSE 0 END) < 2
)

-- Union finale
SELECT * FROM deficits_sites
UNION ALL
SELECT * FROM deficits_bloc
UNION ALL
SELECT * FROM deficits_fermeture;

-- Create function to refresh the view
CREATE OR REPLACE FUNCTION refresh_besoins_non_satisfaits()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW besoins_non_satisfaits_summary;
END;
$$;