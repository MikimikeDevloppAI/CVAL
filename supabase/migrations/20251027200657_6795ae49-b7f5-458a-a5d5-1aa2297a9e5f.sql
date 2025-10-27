-- Fix besoins_bloc_operatoire_summary: correctly count assigned secretaries
DROP MATERIALIZED VIEW IF EXISTS besoins_bloc_operatoire_summary CASCADE;

CREATE MATERIALIZED VIEW besoins_bloc_operatoire_summary AS
WITH bloc_needs AS (
  SELECT
    pgbo.id as planning_genere_bloc_id,
    pgbo.date,
    pgbo.periode as demi_journee,
    pgbo.type_intervention_id,
    ti.nom as type_intervention_nom,
    pgbo.medecin_id,
    COALESCE(m.first_name || ' ' || m.name, 'Non assigné') as medecin_nom,
    tibp.besoin_operation_id,
    bo.nom as besoin_operation_nom,
    tibp.nombre_requis
  FROM planning_genere_bloc_operatoire pgbo
  JOIN types_intervention ti ON ti.id = pgbo.type_intervention_id
  LEFT JOIN medecins m ON m.id = pgbo.medecin_id
  JOIN types_intervention_besoins_personnel tibp ON 
    tibp.type_intervention_id = pgbo.type_intervention_id 
    AND tibp.actif = true
  JOIN besoins_operations bo ON bo.id = tibp.besoin_operation_id
  WHERE pgbo.statut != 'annule'::statut_planning
    AND pgbo.date >= CURRENT_DATE
    AND pgbo.date <= CURRENT_DATE + INTERVAL '6 weeks'
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
  COALESCE(
    (SELECT COUNT(DISTINCT ce.secretaire_id)
     FROM capacite_effective ce
     WHERE ce.actif = true
       AND ce.planning_genere_bloc_operatoire_id = bn.planning_genere_bloc_id
       AND ce.besoin_operation_id = bn.besoin_operation_id
    ), 0
  ) as nombre_assigne,
  GREATEST(0, bn.nombre_requis - COALESCE(
    (SELECT COUNT(DISTINCT ce.secretaire_id)
     FROM capacite_effective ce
     WHERE ce.actif = true
       AND ce.planning_genere_bloc_operatoire_id = bn.planning_genere_bloc_id
       AND ce.besoin_operation_id = bn.besoin_operation_id
    ), 0
  )) as deficit,
  (bn.medecin_nom || ' • ' || bn.type_intervention_nom || ' • ' || bn.besoin_operation_nom) as nom_complet
FROM bloc_needs bn
WHERE (bn.nombre_requis - COALESCE(
  (SELECT COUNT(DISTINCT ce.secretaire_id)
   FROM capacite_effective ce
   WHERE ce.actif = true
     AND ce.planning_genere_bloc_operatoire_id = bn.planning_genere_bloc_id
     AND ce.besoin_operation_id = bn.besoin_operation_id
  ), 0
)) > 0;

-- Create indexes
CREATE UNIQUE INDEX idx_besoins_bloc_unique 
ON besoins_bloc_operatoire_summary(planning_genere_bloc_id, besoin_operation_id);

CREATE INDEX idx_besoins_bloc_date 
ON besoins_bloc_operatoire_summary(date);

CREATE INDEX idx_besoins_bloc_deficit 
ON besoins_bloc_operatoire_summary(deficit) WHERE deficit > 0;

-- Refresh the view
REFRESH MATERIALIZED VIEW besoins_bloc_operatoire_summary;