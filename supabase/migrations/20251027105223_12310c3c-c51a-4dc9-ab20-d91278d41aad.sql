-- Corriger la vue besoins_bloc_operatoire_summary pour utiliser le nombre_requis correct
-- et ajouter planning_genere_bloc_operatoire_id

DROP MATERIALIZED VIEW IF EXISTS besoins_bloc_operatoire_summary CASCADE;

CREATE MATERIALIZED VIEW besoins_bloc_operatoire_summary AS
WITH bloc_needs AS (
  SELECT
    pgbo.id as planning_genere_bloc_id,
    pgbo.date,
    CASE 
      WHEN pgbo.periode = 'matin' THEN 'matin'::demi_journee
      ELSE 'apres_midi'::demi_journee
    END as demi_journee,
    pgbo.type_intervention_id,
    ti.nom as type_intervention_nom,
    pgbo.medecin_id,
    CONCAT(m.name, ' ', m.first_name) as medecin_nom,
    tibp.besoin_operation_id,
    bo.nom as besoin_operation_nom,
    tibp.nombre_requis as nombre_requis
  FROM planning_genere_bloc_operatoire pgbo
  JOIN types_intervention ti ON ti.id = pgbo.type_intervention_id
  LEFT JOIN medecins m ON m.id = pgbo.medecin_id
  JOIN types_intervention_besoins_personnel tibp ON 
    tibp.type_intervention_id = pgbo.type_intervention_id 
    AND tibp.actif = true
  JOIN besoins_operations bo ON bo.id = tibp.besoin_operation_id
  WHERE pgbo.statut != 'annule'
),
bloc_assignments AS (
  SELECT
    ce.date,
    ce.demi_journee,
    ce.besoin_operation_id,
    ce.planning_genere_bloc_operatoire_id,
    COUNT(DISTINCT ce.secretaire_id) as nombre_assigne
  FROM capacite_effective ce
  WHERE ce.actif = true
    AND ce.besoin_operation_id IS NOT NULL
  GROUP BY ce.date, ce.demi_journee, ce.besoin_operation_id, ce.planning_genere_bloc_operatoire_id
),
bloc_assignments_aggregated AS (
  SELECT
    bn.planning_genere_bloc_id,
    bn.date,
    bn.demi_journee,
    bn.besoin_operation_id,
    bn.besoin_operation_nom,
    SUM(ba.nombre_assigne) as nombre_assigne
  FROM bloc_needs bn
  LEFT JOIN bloc_assignments ba ON 
    bn.date = ba.date 
    AND bn.demi_journee = ba.demi_journee 
    AND bn.besoin_operation_id = ba.besoin_operation_id
    AND bn.planning_genere_bloc_id = ba.planning_genere_bloc_operatoire_id
  GROUP BY bn.planning_genere_bloc_id, bn.date, bn.demi_journee, bn.besoin_operation_id, bn.besoin_operation_nom
)
SELECT
  bn.planning_genere_bloc_id,
  bn.date,
  bn.demi_journee,
  bn.type_intervention_id,
  bn.type_intervention_nom,
  bn.medecin_id,
  bn.medecin_nom,
  bn.besoin_operation_id,
  bn.besoin_operation_nom,
  bn.nombre_requis,
  COALESCE(baa.nombre_assigne, 0) as nombre_assigne,
  GREATEST(0, bn.nombre_requis - COALESCE(baa.nombre_assigne, 0)) as deficit
FROM bloc_needs bn
LEFT JOIN bloc_assignments_aggregated baa ON 
  bn.planning_genere_bloc_id = baa.planning_genere_bloc_id
  AND bn.besoin_operation_id = baa.besoin_operation_id
WHERE (bn.nombre_requis - COALESCE(baa.nombre_assigne, 0)) > 0;

CREATE UNIQUE INDEX idx_besoins_bloc_unique ON besoins_bloc_operatoire_summary(
  planning_genere_bloc_id, besoin_operation_id
);
CREATE INDEX idx_besoins_bloc_date ON besoins_bloc_operatoire_summary(date);
CREATE INDEX idx_besoins_bloc_deficit ON besoins_bloc_operatoire_summary(deficit);