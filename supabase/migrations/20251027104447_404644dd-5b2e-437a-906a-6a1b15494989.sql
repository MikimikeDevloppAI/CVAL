-- Corriger la vue besoins_bloc_operatoire_summary
DROP MATERIALIZED VIEW IF EXISTS besoins_bloc_operatoire_summary CASCADE;

CREATE MATERIALIZED VIEW besoins_bloc_operatoire_summary AS
WITH bloc_needs AS (
  SELECT
    pgbo.date,
    pgbo.periode as demi_journee,
    pgbo.type_intervention_id,
    ti.nom as type_intervention_nom,
    pgbo.medecin_id,
    CONCAT(m.first_name, ' ', m.name) as medecin_nom,
    COUNT(DISTINCT tipb.id) as nombre_besoins_distincts,
    SUM(tipb.nombre_requis) as nombre_requis
  FROM planning_genere_bloc_operatoire pgbo
  JOIN types_intervention ti ON ti.id = pgbo.type_intervention_id
  LEFT JOIN medecins m ON m.id = pgbo.medecin_id
  JOIN types_intervention_besoins_personnel tipb ON tipb.type_intervention_id = pgbo.type_intervention_id
  WHERE pgbo.statut != 'annule'
    AND tipb.actif = true
  GROUP BY pgbo.date, pgbo.periode, pgbo.type_intervention_id, ti.nom, pgbo.medecin_id, m.first_name, m.name
),
bloc_assignments AS (
  SELECT
    ce.date,
    ce.demi_journee,
    ce.planning_genere_bloc_operatoire_id,
    ce.besoin_operation_id,
    COUNT(DISTINCT ce.secretaire_id) as nombre_assigne
  FROM capacite_effective ce
  WHERE ce.actif = true
    AND ce.planning_genere_bloc_operatoire_id IS NOT NULL
  GROUP BY ce.date, ce.demi_journee, ce.planning_genere_bloc_operatoire_id, ce.besoin_operation_id
),
bloc_assignments_aggregated AS (
  SELECT
    pgbo.date,
    pgbo.periode as demi_journee,
    pgbo.type_intervention_id,
    pgbo.medecin_id,
    ba.besoin_operation_id,
    bo.nom as besoin_operation_nom,
    SUM(ba.nombre_assigne) as nombre_assigne
  FROM planning_genere_bloc_operatoire pgbo
  LEFT JOIN bloc_assignments ba ON 
    ba.date = pgbo.date 
    AND ba.demi_journee = pgbo.periode
    AND ba.planning_genere_bloc_operatoire_id = pgbo.id
  LEFT JOIN besoins_operations bo ON bo.id = ba.besoin_operation_id
  WHERE pgbo.statut != 'annule'
  GROUP BY pgbo.date, pgbo.periode, pgbo.type_intervention_id, pgbo.medecin_id, ba.besoin_operation_id, bo.nom
)
SELECT
  bn.date,
  bn.demi_journee,
  bn.type_intervention_id,
  bn.type_intervention_nom,
  bn.medecin_id,
  bn.medecin_nom,
  baa.besoin_operation_id,
  baa.besoin_operation_nom,
  bn.nombre_requis,
  COALESCE(baa.nombre_assigne, 0) as nombre_assigne,
  GREATEST(0, bn.nombre_requis - COALESCE(baa.nombre_assigne, 0)) as deficit
FROM bloc_needs bn
LEFT JOIN bloc_assignments_aggregated baa ON 
  bn.date = baa.date 
  AND bn.demi_journee = baa.demi_journee 
  AND bn.type_intervention_id = baa.type_intervention_id
  AND bn.medecin_id = baa.medecin_id
WHERE (bn.nombre_requis - COALESCE(baa.nombre_assigne, 0)) > 0;

CREATE INDEX idx_besoins_bloc_date ON besoins_bloc_operatoire_summary(date);
CREATE INDEX idx_besoins_bloc_deficit ON besoins_bloc_operatoire_summary(deficit);