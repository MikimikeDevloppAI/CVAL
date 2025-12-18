-- Recreate besoins_unified_summary with improved logic and salle_id
DROP MATERIALIZED VIEW IF EXISTS public.besoins_unified_summary;

CREATE MATERIALIZED VIEW besoins_unified_summary AS

-- =====================================================
-- PARTIE 1: BESOINS SITES (hors bloc opératoire)
-- =====================================================
WITH params AS (
  SELECT
    DATE_TRUNC('week', CURRENT_DATE)::date AS start_date,
    (DATE_TRUNC('week', CURRENT_DATE) + INTERVAL '52 weeks' - INTERVAL '1 day')::date AS end_date
),

-- Calculer les besoins par site avec toutes les règles
site_needs_raw AS (
  SELECT
    be.date,
    be.demi_journee,
    be.site_id,
    s.nom AS site_nom,
    s.fermeture AS is_fermeture_site,
    COUNT(DISTINCT be.medecin_id) AS nombre_medecins,
    COALESCE(SUM(m.besoin_secretaires), 0) AS total_besoin_brut
  FROM besoin_effectif be
  JOIN sites s ON s.id = be.site_id
  LEFT JOIN medecins m ON m.id = be.medecin_id
  CROSS JOIN params p
  WHERE be.actif = true
    AND be.type = 'medecin'
    AND be.date >= p.start_date
    AND be.date <= p.end_date
    AND s.nom <> 'Bloc opératoire'
    AND be.site_id <> '00000000-0000-0000-0000-000000000001'
  GROUP BY be.date, be.demi_journee, be.site_id, s.nom, s.fermeture
),

-- Appliquer les règles spéciales
site_needs_with_rules AS (
  SELECT
    date,
    demi_journee,
    site_id,
    site_nom,
    is_fermeture_site,
    nombre_medecins,
    CASE
      WHEN EXTRACT(isodow FROM date) = 6 THEN nombre_medecins
      WHEN site_id = '7723c334-d06c-413d-96f0-be281d76520d' AND nombre_medecins >= 1
        THEN GREATEST(CEIL(total_besoin_brut), 3)
      WHEN site_id = 'd82c55ee-2964-49d4-a578-417b55b557ec' AND nombre_medecins >= 2
        THEN GREATEST(CEIL(total_besoin_brut), 4)
      WHEN site_id = 'd82c55ee-2964-49d4-a578-417b55b557ec' AND nombre_medecins >= 1
        THEN GREATEST(CEIL(total_besoin_brut), 3)
      WHEN nombre_medecins > 0 AND CEIL(total_besoin_brut) = 0 THEN 1
      ELSE CEIL(total_besoin_brut)
    END AS nombre_requis
  FROM site_needs_raw
),

-- Compter les assignations actuelles par site
site_assignments AS (
  SELECT
    ce.date,
    ce.demi_journee,
    ce.site_id,
    COUNT(DISTINCT ce.secretaire_id) AS nombre_assigne
  FROM capacite_effective ce
  JOIN sites s ON s.id = ce.site_id
  CROSS JOIN params p
  WHERE ce.actif = true
    AND ce.site_id <> '00000000-0000-0000-0000-000000000001'
    AND s.nom <> 'Bloc opératoire'
    AND ce.date >= p.start_date
    AND ce.date <= p.end_date
  GROUP BY ce.date, ce.demi_journee, ce.site_id
),

-- Résultat sites
sites_result AS (
  SELECT
    'site' AS type_besoin,
    sn.date,
    sn.demi_journee,
    sn.site_id,
    sn.site_nom,
    NULL::uuid AS planning_bloc_id,
    NULL::uuid AS salle_id,
    NULL::uuid AS besoin_operation_id,
    NULL::text AS besoin_operation_nom,
    NULL::text AS type_intervention_nom,
    NULL::text AS medecin_nom,
    sn.nombre_medecins,
    sn.nombre_requis::integer,
    COALESCE(sa.nombre_assigne, 0) AS nombre_assigne,
    (sn.nombre_requis - COALESCE(sa.nombre_assigne, 0))::integer AS balance,
    CASE
      WHEN sn.nombre_requis > COALESCE(sa.nombre_assigne, 0) THEN 'DEFICIT'
      WHEN sn.nombre_requis < COALESCE(sa.nombre_assigne, 0) THEN 'SURPLUS'
      ELSE 'OK'
    END AS statut,
    sn.is_fermeture_site
  FROM site_needs_with_rules sn
  LEFT JOIN site_assignments sa
    ON sn.date = sa.date
    AND sn.demi_journee = sa.demi_journee
    AND sn.site_id = sa.site_id
),

-- =====================================================
-- PARTIE 2: BESOINS BLOC OPERATOIRE
-- =====================================================
bloc_needs AS (
  SELECT
    pgbo.id AS planning_bloc_id,
    pgbo.salle_assignee AS salle_id,
    pgbo.date,
    pgbo.periode AS demi_journee,
    pgbo.type_intervention_id,
    ti.nom AS type_intervention_nom,
    pgbo.medecin_id,
    COALESCE(med.first_name || ' ' || med.name, 'Médecin inconnu') AS medecin_nom,
    tibp.besoin_operation_id,
    bo.nom AS besoin_operation_nom,
    tibp.nombre_requis,
    so.name AS salle_nom
  FROM planning_genere_bloc_operatoire pgbo
  JOIN types_intervention ti ON ti.id = pgbo.type_intervention_id
  JOIN types_intervention_besoins_personnel tibp
    ON tibp.type_intervention_id = pgbo.type_intervention_id AND tibp.actif = true
  JOIN besoins_operations bo ON bo.id = tibp.besoin_operation_id
  LEFT JOIN medecins med ON med.id = pgbo.medecin_id
  LEFT JOIN salles_operation so ON so.id = pgbo.salle_assignee
  CROSS JOIN params p
  WHERE pgbo.statut <> 'annule'
    AND pgbo.date >= p.start_date
    AND pgbo.date <= p.end_date
),

bloc_assignments AS (
  SELECT
    ce.planning_genere_bloc_operatoire_id,
    ce.besoin_operation_id,
    COUNT(DISTINCT ce.secretaire_id) AS nombre_assigne
  FROM capacite_effective ce
  WHERE ce.actif = true
    AND ce.planning_genere_bloc_operatoire_id IS NOT NULL
  GROUP BY ce.planning_genere_bloc_operatoire_id, ce.besoin_operation_id
),

bloc_result AS (
  SELECT
    'bloc' AS type_besoin,
    bn.date,
    bn.demi_journee,
    (SELECT id FROM sites WHERE nom ILIKE '%bloc%opératoire%' LIMIT 1) AS site_id,
    COALESCE(bn.salle_nom, 'Salle ?') || ' - ' || bn.type_intervention_nom || ' - ' || bn.besoin_operation_nom AS site_nom,
    bn.planning_bloc_id,
    bn.salle_id,
    bn.besoin_operation_id,
    bn.besoin_operation_nom,
    bn.type_intervention_nom,
    bn.medecin_nom,
    1 AS nombre_medecins,
    bn.nombre_requis::integer,
    COALESCE(ba.nombre_assigne, 0)::integer AS nombre_assigne,
    (bn.nombre_requis - COALESCE(ba.nombre_assigne, 0))::integer AS balance,
    CASE
      WHEN bn.nombre_requis > COALESCE(ba.nombre_assigne, 0) THEN 'DEFICIT'
      WHEN bn.nombre_requis < COALESCE(ba.nombre_assigne, 0) THEN 'SURPLUS'
      ELSE 'OK'
    END AS statut,
    false AS is_fermeture_site
  FROM bloc_needs bn
  LEFT JOIN bloc_assignments ba
    ON bn.planning_bloc_id = ba.planning_genere_bloc_operatoire_id
    AND bn.besoin_operation_id = ba.besoin_operation_id
),

-- =====================================================
-- PARTIE 3: BESOINS FERMETURE (1R, 2F) PAR DEMI-JOURNEE
-- =====================================================
fermeture_sites AS (
  SELECT id AS site_id, nom AS site_nom
  FROM sites
  WHERE actif = true AND fermeture = true
),

-- Demi-journées où le besoin secrétaires > 1 (hors samedi)
fermeture_needs_per_period AS (
  SELECT
    sn.site_id,
    fs.site_nom,
    sn.date,
    sn.demi_journee,
    sn.nombre_requis
  FROM site_needs_with_rules sn
  JOIN fermeture_sites fs ON fs.site_id = sn.site_id
  WHERE sn.nombre_requis > 1
    AND EXTRACT(isodow FROM sn.date) <> 6
),

-- Secrétaires avec 1R par demi-journée
assignments_1r_period AS (
  SELECT
    ce.site_id,
    ce.date,
    ce.demi_journee,
    COUNT(DISTINCT ce.secretaire_id) AS nombre_assigne
  FROM capacite_effective ce
  JOIN fermeture_sites fs ON fs.site_id = ce.site_id
  CROSS JOIN params p
  WHERE ce.actif = true
    AND ce.is_1r = true
    AND ce.date >= p.start_date
    AND ce.date <= p.end_date
  GROUP BY ce.site_id, ce.date, ce.demi_journee
),

-- Secrétaires avec 2F par demi-journée
assignments_2f_period AS (
  SELECT
    ce.site_id,
    ce.date,
    ce.demi_journee,
    COUNT(DISTINCT ce.secretaire_id) AS nombre_assigne
  FROM capacite_effective ce
  JOIN fermeture_sites fs ON fs.site_id = ce.site_id
  CROSS JOIN params p
  WHERE ce.actif = true
    AND ce.is_2f = true
    AND ce.date >= p.start_date
    AND ce.date <= p.end_date
  GROUP BY ce.site_id, ce.date, ce.demi_journee
),

-- Résultat 1R par demi-journée
fermeture_1r_result AS (
  SELECT
    'fermeture_1r' AS type_besoin,
    fnp.date,
    fnp.demi_journee,
    fnp.site_id,
    fnp.site_nom || ' (1R)' AS site_nom,
    NULL::uuid AS planning_bloc_id,
    NULL::uuid AS salle_id,
    NULL::uuid AS besoin_operation_id,
    'Rôle 1R (Responsable)' AS besoin_operation_nom,
    NULL::text AS type_intervention_nom,
    NULL::text AS medecin_nom,
    0 AS nombre_medecins,
    1 AS nombre_requis,
    COALESCE(a1r.nombre_assigne, 0)::integer AS nombre_assigne,
    (1 - COALESCE(a1r.nombre_assigne, 0))::integer AS balance,
    CASE
      WHEN COALESCE(a1r.nombre_assigne, 0) = 0 THEN 'DEFICIT'
      WHEN COALESCE(a1r.nombre_assigne, 0) > 1 THEN 'SURPLUS'
      ELSE 'OK'
    END AS statut,
    true AS is_fermeture_site
  FROM fermeture_needs_per_period fnp
  LEFT JOIN assignments_1r_period a1r
    ON fnp.site_id = a1r.site_id
    AND fnp.date = a1r.date
    AND fnp.demi_journee = a1r.demi_journee
),

-- Résultat 2F par demi-journée
fermeture_2f_result AS (
  SELECT
    'fermeture_2f' AS type_besoin,
    fnp.date,
    fnp.demi_journee,
    fnp.site_id,
    fnp.site_nom || ' (2F)' AS site_nom,
    NULL::uuid AS planning_bloc_id,
    NULL::uuid AS salle_id,
    NULL::uuid AS besoin_operation_id,
    'Rôle 2F (Fermeture)' AS besoin_operation_nom,
    NULL::text AS type_intervention_nom,
    NULL::text AS medecin_nom,
    0 AS nombre_medecins,
    1 AS nombre_requis,
    COALESCE(a2f.nombre_assigne, 0)::integer AS nombre_assigne,
    (1 - COALESCE(a2f.nombre_assigne, 0))::integer AS balance,
    CASE
      WHEN COALESCE(a2f.nombre_assigne, 0) = 0 THEN 'DEFICIT'
      WHEN COALESCE(a2f.nombre_assigne, 0) > 1 THEN 'SURPLUS'
      ELSE 'OK'
    END AS statut,
    true AS is_fermeture_site
  FROM fermeture_needs_per_period fnp
  LEFT JOIN assignments_2f_period a2f
    ON fnp.site_id = a2f.site_id
    AND fnp.date = a2f.date
    AND fnp.demi_journee = a2f.demi_journee
)

-- =====================================================
-- UNION FINALE
-- =====================================================
SELECT * FROM sites_result WHERE balance <> 0
UNION ALL
SELECT * FROM bloc_result WHERE balance <> 0
UNION ALL
SELECT * FROM fermeture_1r_result WHERE balance <> 0
UNION ALL
SELECT * FROM fermeture_2f_result WHERE balance <> 0

ORDER BY date, site_nom, demi_journee;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_besoins_unified_date ON besoins_unified_summary(date);
CREATE INDEX IF NOT EXISTS idx_besoins_unified_statut ON besoins_unified_summary(statut);
CREATE INDEX IF NOT EXISTS idx_besoins_unified_site ON besoins_unified_summary(site_id);
CREATE INDEX IF NOT EXISTS idx_besoins_unified_salle ON besoins_unified_summary(salle_id);