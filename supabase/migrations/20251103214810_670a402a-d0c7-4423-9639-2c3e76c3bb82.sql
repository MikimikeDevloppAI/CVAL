-- Drop existing materialized views
DROP MATERIALIZED VIEW IF EXISTS public.besoins_sites_summary;
DROP MATERIALIZED VIEW IF EXISTS public.besoins_bloc_operatoire_summary;
DROP MATERIALIZED VIEW IF EXISTS public.besoins_fermeture_summary;

-- Recreate besoins_sites_summary with new date range
CREATE MATERIALIZED VIEW public.besoins_sites_summary AS
WITH site_needs AS (
  SELECT 
    be.date,
    be.demi_journee,
    be.site_id,
    s.nom AS site_nom,
    COUNT(DISTINCT be.medecin_id) AS nombre_medecins,
    CASE
      WHEN EXTRACT(ISODOW FROM be.date) = 6 THEN COUNT(DISTINCT be.medecin_id)::numeric
      ELSE CEIL(COALESCE(SUM(m.besoin_secretaires), 0))
    END AS nombre_requis
  FROM besoin_effectif be
  JOIN sites s ON s.id = be.site_id
  LEFT JOIN medecins m ON m.id = be.medecin_id
  WHERE be.actif = true
    AND be.type = 'medecin'::type_besoin
    AND be.date >= GREATEST(CURRENT_DATE, DATE '2025-12-08')
    AND be.date <= GREATEST(CURRENT_DATE, DATE '2025-12-08') + INTERVAL '6 weeks'
    AND s.nom <> 'Bloc opératoire'
  GROUP BY be.date, be.demi_journee, be.site_id, s.nom
),
site_assignments AS (
  SELECT 
    ce.date,
    ce.demi_journee,
    ce.site_id,
    COUNT(DISTINCT ce.secretaire_id) AS nombre_assigne
  FROM capacite_effective ce
  JOIN sites s ON s.id = ce.site_id
  WHERE ce.actif = true
    AND ce.site_id <> '00000000-0000-0000-0000-000000000001'::uuid
    AND s.nom <> 'Bloc opératoire'
  GROUP BY ce.date, ce.demi_journee, ce.site_id
)
SELECT 
  sn.date,
  sn.demi_journee,
  sn.site_id,
  sn.site_nom,
  sn.nombre_medecins,
  sn.nombre_requis,
  COALESCE(sa.nombre_assigne, 0) AS nombre_assigne,
  GREATEST(0, sn.nombre_requis - COALESCE(sa.nombre_assigne, 0)::numeric) AS deficit
FROM site_needs sn
LEFT JOIN site_assignments sa ON sn.date = sa.date 
  AND sn.demi_journee = sa.demi_journee 
  AND sn.site_id = sa.site_id
WHERE (sn.nombre_requis - COALESCE(sa.nombre_assigne, 0)::numeric) > 0;

-- Recreate besoins_bloc_operatoire_summary with new date range
CREATE MATERIALIZED VIEW public.besoins_bloc_operatoire_summary AS
WITH bloc_needs AS (
  SELECT 
    pgbo.id AS planning_genere_bloc_id,
    pgbo.date,
    pgbo.periode AS demi_journee,
    pgbo.type_intervention_id,
    ti.nom AS type_intervention_nom,
    pgbo.medecin_id,
    COALESCE(m.first_name || ' ' || m.name, 'Non assigné') AS medecin_nom,
    tibp.besoin_operation_id,
    bo.nom AS besoin_operation_nom,
    tibp.nombre_requis
  FROM planning_genere_bloc_operatoire pgbo
  JOIN types_intervention ti ON ti.id = pgbo.type_intervention_id
  LEFT JOIN medecins m ON m.id = pgbo.medecin_id
  JOIN types_intervention_besoins_personnel tibp 
    ON tibp.type_intervention_id = pgbo.type_intervention_id AND tibp.actif = true
  JOIN besoins_operations bo ON bo.id = tibp.besoin_operation_id
  WHERE pgbo.statut <> 'annule'::statut_planning
    AND pgbo.date >= GREATEST(CURRENT_DATE, DATE '2025-12-08')
    AND pgbo.date <= GREATEST(CURRENT_DATE, DATE '2025-12-08') + INTERVAL '6 weeks'
)
SELECT 
  planning_genere_bloc_id,
  date,
  demi_journee,
  type_intervention_id,
  type_intervention_nom,
  medecin_id,
  medecin_nom,
  besoin_operation_id,
  besoin_operation_nom,
  nombre_requis,
  COALESCE((
    SELECT COUNT(DISTINCT ce.secretaire_id)
    FROM capacite_effective ce
    WHERE ce.actif = true
      AND ce.planning_genere_bloc_operatoire_id = bn.planning_genere_bloc_id
      AND ce.besoin_operation_id = bn.besoin_operation_id
  ), 0) AS nombre_assigne,
  GREATEST(0, nombre_requis - COALESCE((
    SELECT COUNT(DISTINCT ce.secretaire_id)
    FROM capacite_effective ce
    WHERE ce.actif = true
      AND ce.planning_genere_bloc_operatoire_id = bn.planning_genere_bloc_id
      AND ce.besoin_operation_id = bn.besoin_operation_id
  ), 0)) AS deficit,
  medecin_nom || ' • ' || type_intervention_nom || ' • ' || besoin_operation_nom AS nom_complet
FROM bloc_needs bn
WHERE (nombre_requis - COALESCE((
  SELECT COUNT(DISTINCT ce.secretaire_id)
  FROM capacite_effective ce
  WHERE ce.actif = true
    AND ce.planning_genere_bloc_operatoire_id = bn.planning_genere_bloc_id
    AND ce.besoin_operation_id = bn.besoin_operation_id
), 0)) > 0;

-- Recreate besoins_fermeture_summary with new date range
CREATE MATERIALIZED VIEW public.besoins_fermeture_summary AS
WITH fermeture_sites AS (
  SELECT 
    sites.id AS site_id,
    sites.nom AS site_nom
  FROM sites
  WHERE sites.actif = true AND sites.fermeture = true
),
sites_with_full_day_doctors AS (
  SELECT DISTINCT 
    be_m.site_id,
    be_m.date
  FROM besoin_effectif be_m
  JOIN besoin_effectif be_a 
    ON be_a.site_id = be_m.site_id 
    AND be_a.date = be_m.date 
    AND be_a.demi_journee = 'apres_midi'::demi_journee 
    AND be_a.actif = true 
    AND be_a.type = 'medecin'::type_besoin
  WHERE be_m.demi_journee = 'matin'::demi_journee 
    AND be_m.actif = true 
    AND be_m.type = 'medecin'::type_besoin
),
valid_fermeture_dates AS (
  SELECT 
    fs.site_id,
    fs.site_nom,
    sfd.date
  FROM fermeture_sites fs
  JOIN sites_with_full_day_doctors sfd ON sfd.site_id = fs.site_id
  WHERE sfd.date >= GREATEST(CURRENT_DATE, DATE '2025-12-08')
    AND sfd.date <= GREATEST(CURRENT_DATE, DATE '2025-12-08') + INTERVAL '6 weeks'
),
secretaires_1r_toute_journee AS (
  SELECT DISTINCT 
    ce_m.site_id,
    ce_m.date,
    ce_m.secretaire_id
  FROM capacite_effective ce_m
  JOIN capacite_effective ce_a 
    ON ce_a.site_id = ce_m.site_id 
    AND ce_a.date = ce_m.date 
    AND ce_a.secretaire_id = ce_m.secretaire_id 
    AND ce_a.demi_journee = 'apres_midi'::demi_journee 
    AND ce_a.actif = true 
    AND ce_a.is_1r = true
  WHERE ce_m.demi_journee = 'matin'::demi_journee 
    AND ce_m.actif = true 
    AND ce_m.is_1r = true
),
secretaires_2f3f_toute_journee AS (
  SELECT DISTINCT 
    ce_m.site_id,
    ce_m.date,
    ce_m.secretaire_id
  FROM capacite_effective ce_m
  JOIN capacite_effective ce_a 
    ON ce_a.site_id = ce_m.site_id 
    AND ce_a.date = ce_m.date 
    AND ce_a.secretaire_id = ce_m.secretaire_id 
    AND ce_a.demi_journee = 'apres_midi'::demi_journee 
    AND ce_a.actif = true 
    AND (ce_a.is_2f = true OR ce_a.is_3f = true)
  WHERE ce_m.demi_journee = 'matin'::demi_journee 
    AND ce_m.actif = true 
    AND (ce_m.is_2f = true OR ce_m.is_3f = true)
),
assignments_1r AS (
  SELECT 
    site_id,
    date,
    COUNT(DISTINCT secretaire_id) AS nombre_assigne_1r
  FROM secretaires_1r_toute_journee
  GROUP BY site_id, date
),
assignments_2f3f AS (
  SELECT 
    site_id,
    date,
    COUNT(DISTINCT secretaire_id) AS nombre_assigne_2f3f
  FROM secretaires_2f3f_toute_journee
  GROUP BY site_id, date
)
SELECT 
  vfd.site_id,
  vfd.site_nom,
  vfd.date,
  1 AS nombre_requis_1r,
  1 AS nombre_requis_2f3f,
  COALESCE(a1r.nombre_assigne_1r, 0) AS nombre_assigne_1r,
  COALESCE(a23.nombre_assigne_2f3f, 0) AS nombre_assigne_2f3f,
  GREATEST(0, 1 - COALESCE(a1r.nombre_assigne_1r, 0)) AS deficit_1r,
  GREATEST(0, 1 - COALESCE(a23.nombre_assigne_2f3f, 0)) AS deficit_2f3f,
  GREATEST(
    GREATEST(0, 1 - COALESCE(a1r.nombre_assigne_1r, 0)),
    GREATEST(0, 1 - COALESCE(a23.nombre_assigne_2f3f, 0))
  ) AS deficit
FROM valid_fermeture_dates vfd
LEFT JOIN assignments_1r a1r ON a1r.site_id = vfd.site_id AND a1r.date = vfd.date
LEFT JOIN assignments_2f3f a23 ON a23.site_id = vfd.site_id AND a23.date = vfd.date;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_besoins_sites_summary_date ON public.besoins_sites_summary(date);
CREATE INDEX IF NOT EXISTS idx_besoins_sites_summary_site ON public.besoins_sites_summary(site_id);
CREATE INDEX IF NOT EXISTS idx_besoins_bloc_summary_date ON public.besoins_bloc_operatoire_summary(date);
CREATE INDEX IF NOT EXISTS idx_besoins_fermeture_summary_date ON public.besoins_fermeture_summary(date);

-- Refresh the views
REFRESH MATERIALIZED VIEW public.besoins_sites_summary;
REFRESH MATERIALIZED VIEW public.besoins_bloc_operatoire_summary;
REFRESH MATERIALIZED VIEW public.besoins_fermeture_summary;