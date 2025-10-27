-- Drop existing materialized view
DROP MATERIALIZED VIEW IF EXISTS besoins_non_satisfaits_summary CASCADE;

-- Recreate the materialized view with corrected fermeture logic
CREATE MATERIALIZED VIEW besoins_non_satisfaits_summary AS
WITH 
-- Sites fermeture: sites nécessitant une fermeture avec besoins matin ET après-midi
sites_fermeture_besoins AS (
  SELECT 
    be.date,
    be.site_id,
    s.nom as site_nom
  FROM besoin_effectif be
  JOIN sites s ON s.id = be.site_id
  WHERE s.fermeture = true
    AND be.actif = true
    AND s.actif = true
  GROUP BY be.date, be.site_id, s.nom
  HAVING 
    COUNT(*) FILTER (WHERE be.demi_journee = 'matin') > 0
    AND COUNT(*) FILTER (WHERE be.demi_journee = 'apres_midi') > 0
),

-- Secrétaires 1R qui couvrent toute la journée (matin ET après-midi)
capacites_1r_journee AS (
  SELECT DISTINCT
    ce_matin.date,
    ce_matin.site_id,
    ce_matin.secretaire_id
  FROM capacite_effective ce_matin
  JOIN capacite_effective ce_am ON 
    ce_am.date = ce_matin.date
    AND ce_am.site_id = ce_matin.site_id
    AND ce_am.secretaire_id = ce_matin.secretaire_id
    AND ce_am.demi_journee = 'apres_midi'
  WHERE ce_matin.demi_journee = 'matin'
    AND ce_matin.is_1r = true
    AND ce_am.is_1r = true
    AND ce_matin.actif = true
    AND ce_am.actif = true
),

-- Secrétaires 2F qui couvrent toute la journée (matin ET après-midi)
capacites_2f_journee AS (
  SELECT DISTINCT
    ce_matin.date,
    ce_matin.site_id,
    ce_matin.secretaire_id
  FROM capacite_effective ce_matin
  JOIN capacite_effective ce_am ON 
    ce_am.date = ce_matin.date
    AND ce_am.site_id = ce_matin.site_id
    AND ce_am.secretaire_id = ce_matin.secretaire_id
    AND ce_am.demi_journee = 'apres_midi'
  WHERE ce_matin.demi_journee = 'matin'
    AND ce_matin.is_2f = true
    AND ce_am.is_2f = true
    AND ce_matin.actif = true
    AND ce_am.actif = true
),

-- Déficits fermeture: une ligne par site/date avec demi_journee = 'toute_journee'
deficits_fermeture AS (
  SELECT 
    sfb.date,
    'toute_journee'::demi_journee as demi_journee,
    sfb.site_id,
    sfb.site_nom,
    true as site_fermeture,
    NULL::integer as nombre_medecins,
    'fermeture' as type_besoin,
    NULL::uuid as besoin_operation_id,
    NULL::uuid as planning_genere_bloc_id,
    2 as nombre_requis,
    COALESCE(c1r.nb_1r, 0) + COALESCE(c2f.nb_2f, 0) as nombre_assigne,
    (CASE WHEN COALESCE(c1r.nb_1r, 0) < 1 THEN 1 ELSE 0 END +
     CASE WHEN COALESCE(c2f.nb_2f, 0) < 1 THEN 1 ELSE 0 END) as deficit,
    CASE WHEN COALESCE(c1r.nb_1r, 0) < 1 THEN 1 ELSE 0 END as deficit_1r,
    CASE WHEN COALESCE(c2f.nb_2f, 0) < 1 THEN 1 ELSE 0 END as deficit_2f
  FROM sites_fermeture_besoins sfb
  LEFT JOIN (
    SELECT date, site_id, COUNT(DISTINCT secretaire_id) as nb_1r
    FROM capacites_1r_journee
    GROUP BY date, site_id
  ) c1r ON c1r.date = sfb.date AND c1r.site_id = sfb.site_id
  LEFT JOIN (
    SELECT date, site_id, COUNT(DISTINCT secretaire_id) as nb_2f
    FROM capacites_2f_journee
    GROUP BY date, site_id
  ) c2f ON c2f.date = sfb.date AND c2f.site_id = sfb.site_id
  WHERE COALESCE(c1r.nb_1r, 0) < 1 OR COALESCE(c2f.nb_2f, 0) < 1
),

-- Déficits sites normaux (non fermeture)
besoins_sites AS (
  SELECT 
    be.date,
    be.demi_journee,
    be.site_id,
    s.nom as site_nom,
    s.fermeture as site_fermeture,
    COUNT(DISTINCT be.medecin_id) as nombre_medecins
  FROM besoin_effectif be
  JOIN sites s ON s.id = be.site_id
  WHERE be.type = 'medecin'
    AND be.actif = true
    AND s.actif = true
    AND s.fermeture = false
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
    AND ce.site_id != '00000000-0000-0000-0000-000000000001'
    AND ce.besoin_operation_id IS NULL
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
    bs.nombre_medecins as nombre_requis,
    COALESCE(cs.nombre_secretaires, 0) as nombre_assigne,
    bs.nombre_medecins - COALESCE(cs.nombre_secretaires, 0) as deficit,
    0 as deficit_1r,
    0 as deficit_2f
  FROM besoins_sites bs
  LEFT JOIN capacites_sites cs 
    ON cs.date = bs.date 
    AND cs.demi_journee = bs.demi_journee 
    AND cs.site_id = bs.site_id
  WHERE bs.nombre_medecins > COALESCE(cs.nombre_secretaires, 0)
),

-- Déficits bloc opératoire
besoins_bloc_operations AS (
  SELECT 
    pgb.date,
    pgb.periode as demi_journee,
    pgb.type_intervention_id,
    ti.nom as type_intervention_nom,
    pgb.id as planning_genere_bloc_id,
    SUM(tipb.nombre_requis) as nombre_requis_total
  FROM planning_genere_bloc_operatoire pgb
  JOIN types_intervention ti ON ti.id = pgb.type_intervention_id
  JOIN types_intervention_besoins_personnel tipb ON tipb.type_intervention_id = pgb.type_intervention_id
  WHERE pgb.validated = false
    AND ti.actif = true
    AND tipb.actif = true
  GROUP BY pgb.date, pgb.periode, pgb.type_intervention_id, ti.nom, pgb.id
),

capacites_bloc_operations AS (
  SELECT 
    ce.date,
    ce.demi_journee,
    ce.planning_genere_bloc_operatoire_id,
    ce.besoin_operation_id,
    COUNT(DISTINCT ce.secretaire_id) as nombre_secretaires
  FROM capacite_effective ce
  WHERE ce.actif = true
    AND ce.planning_genere_bloc_operatoire_id IS NOT NULL
  GROUP BY ce.date, ce.demi_journee, ce.planning_genere_bloc_operatoire_id, ce.besoin_operation_id
),

deficits_bloc AS (
  SELECT 
    bbo.date,
    bbo.demi_journee,
    NULL::uuid as site_id,
    bbo.type_intervention_nom as site_nom,
    false as site_fermeture,
    NULL::integer as nombre_medecins,
    'bloc_operatoire' as type_besoin,
    cbo.besoin_operation_id,
    bbo.planning_genere_bloc_id,
    bbo.nombre_requis_total as nombre_requis,
    COALESCE(cbo.nombre_secretaires, 0) as nombre_assigne,
    bbo.nombre_requis_total - COALESCE(cbo.nombre_secretaires, 0) as deficit,
    0 as deficit_1r,
    0 as deficit_2f
  FROM besoins_bloc_operations bbo
  LEFT JOIN capacites_bloc_operations cbo 
    ON cbo.date = bbo.date 
    AND cbo.demi_journee = bbo.demi_journee 
    AND cbo.planning_genere_bloc_operatoire_id = bbo.planning_genere_bloc_id
  WHERE bbo.nombre_requis_total > COALESCE(cbo.nombre_secretaires, 0)
)

-- Union de tous les déficits
SELECT * FROM deficits_fermeture
UNION ALL
SELECT * FROM deficits_sites
UNION ALL
SELECT * FROM deficits_bloc;

-- Create index for performance
CREATE INDEX idx_besoins_non_satisfaits_date ON besoins_non_satisfaits_summary(date);
CREATE INDEX idx_besoins_non_satisfaits_site ON besoins_non_satisfaits_summary(site_id);
CREATE INDEX idx_besoins_non_satisfaits_type ON besoins_non_satisfaits_summary(type_besoin);