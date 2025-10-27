-- Drop existing materialized view and indexes
DROP MATERIALIZED VIEW IF EXISTS public.besoins_non_satisfaits_summary CASCADE;

-- Recreate the materialized view with closing roles detection
CREATE MATERIALIZED VIEW public.besoins_non_satisfaits_summary AS
WITH 
-- Sites normaux (pas de bloc opératoire)
besoins_sites AS (
  SELECT
    be.date,
    CASE 
      WHEN be.demi_journee = 'matin' THEN 'matin'
      WHEN be.demi_journee = 'apres_midi' THEN 'apres_midi'
    END AS periode,
    be.site_id,
    s.nom AS site_nom,
    NULL::uuid AS besoin_operation_id,
    NULL::uuid AS planning_genere_bloc_operatoire_id,
    'site' AS type_besoin,
    COUNT(DISTINCT be.medecin_id) AS nombre_besoins
  FROM public.besoin_effectif be
  JOIN public.sites s ON s.id = be.site_id
  WHERE be.type = 'medecin'
    AND be.actif = true
    AND be.demi_journee IN ('matin', 'apres_midi')
    AND s.nom NOT IN ('Clinique La Vallée - Bloc opératoire', 'Bloc opératoire')
  GROUP BY be.date, be.demi_journee, be.site_id, s.nom
),
-- Besoins du bloc opératoire
besoins_bloc AS (
  SELECT
    pgbo.date,
    CASE 
      WHEN pgbo.periode = 'matin' THEN 'matin'
      WHEN pgbo.periode = 'apres_midi' THEN 'apres_midi'
    END AS periode,
    (SELECT id FROM public.sites WHERE nom = 'Clinique La Vallée - Bloc opératoire' LIMIT 1) AS site_id,
    ti.nom || ' - ' || bo.nom || COALESCE(' (' || m.name || ')', '') AS site_nom,
    tibp.besoin_operation_id,
    pgbo.id AS planning_genere_bloc_operatoire_id,
    'bloc_operatoire' AS type_besoin,
    tibp.nombre_requis AS nombre_besoins
  FROM public.planning_genere_bloc_operatoire pgbo
  JOIN public.types_intervention ti ON ti.id = pgbo.type_intervention_id
  JOIN public.types_intervention_besoins_personnel tibp ON tibp.type_intervention_id = pgbo.type_intervention_id
  JOIN public.besoins_operations bo ON bo.id = tibp.besoin_operation_id
  LEFT JOIN public.medecins m ON m.id = pgbo.medecin_id
  WHERE pgbo.statut != 'annule'
    AND tibp.actif = true
),
-- Identifier les sites de fermeture nécessitant 1R/2F/3F
sites_fermeture_besoins AS (
  SELECT DISTINCT
    be.date,
    be.site_id,
    s.nom AS site_nom
  FROM public.besoin_effectif be
  JOIN public.sites s ON s.id = be.site_id
  WHERE s.fermeture = true
    AND s.actif = true
    AND be.actif = true
    AND be.type = 'medecin'
    AND s.nom NOT IN ('Clinique La Vallée - Bloc opératoire', 'Bloc opératoire')
  GROUP BY be.date, be.site_id, s.nom
  HAVING 
    -- Médecins travaillent matin ET après-midi
    COUNT(DISTINCT CASE WHEN be.demi_journee = 'matin' THEN be.medecin_id END) > 0
    AND COUNT(DISTINCT CASE WHEN be.demi_journee = 'apres_midi' THEN be.medecin_id END) > 0
),
-- Compter secrétaires avec 1R présentes toute la journée
secretaires_1r AS (
  SELECT
    ce.date,
    ce.site_id,
    COUNT(DISTINCT CASE 
      WHEN EXISTS (
        SELECT 1 FROM public.capacite_effective ce2 
        WHERE ce2.secretaire_id = ce.secretaire_id 
          AND ce2.date = ce.date 
          AND ce2.site_id = ce.site_id
          AND ce2.demi_journee = 'matin' 
          AND ce2.is_1r = true
          AND ce2.actif = true
      ) AND EXISTS (
        SELECT 1 FROM public.capacite_effective ce3
        WHERE ce3.secretaire_id = ce.secretaire_id 
          AND ce3.date = ce.date 
          AND ce3.site_id = ce.site_id
          AND ce3.demi_journee = 'apres_midi' 
          AND ce3.is_1r = true
          AND ce3.actif = true
      ) THEN ce.secretaire_id 
    END) AS count_1r
  FROM public.capacite_effective ce
  WHERE ce.actif = true
  GROUP BY ce.date, ce.site_id
),
-- Compter secrétaires avec 2F/3F présentes toute la journée
secretaires_2f3f AS (
  SELECT
    ce.date,
    ce.site_id,
    COUNT(DISTINCT CASE 
      WHEN EXISTS (
        SELECT 1 FROM public.capacite_effective ce2 
        WHERE ce2.secretaire_id = ce.secretaire_id 
          AND ce2.date = ce.date 
          AND ce2.site_id = ce.site_id
          AND ce2.demi_journee = 'matin' 
          AND (ce2.is_2f = true OR ce2.is_3f = true)
          AND ce2.actif = true
      ) AND EXISTS (
        SELECT 1 FROM public.capacite_effective ce3
        WHERE ce3.secretaire_id = ce.secretaire_id 
          AND ce3.date = ce.date 
          AND ce3.site_id = ce.site_id
          AND ce3.demi_journee = 'apres_midi' 
          AND (ce3.is_2f = true OR ce3.is_3f = true)
          AND ce3.actif = true
      ) THEN ce.secretaire_id 
    END) AS count_2f3f
  FROM public.capacite_effective ce
  WHERE ce.actif = true
  GROUP BY ce.date, ce.site_id
),
-- Créer des besoins virtuels pour les rôles de fermeture manquants
besoins_fermeture_roles AS (
  -- Manque de 1R
  SELECT
    sfb.date,
    'matin' AS periode,
    sfb.site_id,
    sfb.site_nom || ' - Manque 1R' AS site_nom,
    NULL::uuid AS besoin_operation_id,
    NULL::uuid AS planning_genere_bloc_operatoire_id,
    'fermeture_1r' AS type_besoin,
    1 AS nombre_besoins
  FROM sites_fermeture_besoins sfb
  LEFT JOIN secretaires_1r s1r 
    ON s1r.date = sfb.date AND s1r.site_id = sfb.site_id
  WHERE COALESCE(s1r.count_1r, 0) < 1
  
  UNION ALL
  
  -- Manque de 2F/3F
  SELECT
    sfb.date,
    'matin' AS periode,
    sfb.site_id,
    sfb.site_nom || ' - Manque 2F/3F' AS site_nom,
    NULL::uuid AS besoin_operation_id,
    NULL::uuid AS planning_genere_bloc_operatoire_id,
    'fermeture_2f3f' AS type_besoin,
    1 AS nombre_besoins
  FROM sites_fermeture_besoins sfb
  LEFT JOIN secretaires_2f3f s2f 
    ON s2f.date = sfb.date AND s2f.site_id = sfb.site_id
  WHERE COALESCE(s2f.count_2f3f, 0) < 1
),
-- Fusionner tous les besoins
tous_besoins AS (
  SELECT * FROM besoins_sites
  UNION ALL
  SELECT * FROM besoins_bloc
  UNION ALL
  SELECT * FROM besoins_fermeture_roles
),
-- Capacités assignées
capacites_assignees AS (
  SELECT
    ce.date,
    CASE 
      WHEN ce.demi_journee = 'matin' THEN 'matin'
      WHEN ce.demi_journee = 'apres_midi' THEN 'apres_midi'
    END AS periode,
    ce.site_id,
    ce.besoin_operation_id,
    ce.planning_genere_bloc_operatoire_id,
    COUNT(DISTINCT ce.secretaire_id) AS nombre_assignes
  FROM public.capacite_effective ce
  WHERE ce.actif = true
    AND ce.demi_journee IN ('matin', 'apres_midi')
  GROUP BY ce.date, ce.demi_journee, ce.site_id, ce.besoin_operation_id, ce.planning_genere_bloc_operatoire_id
)
SELECT
  tb.date,
  tb.periode,
  tb.site_id,
  MAX(tb.site_nom) AS site_nom,
  tb.besoin_operation_id,
  tb.planning_genere_bloc_operatoire_id,
  tb.type_besoin,
  SUM(tb.nombre_besoins) AS nombre_besoins,
  CASE 
    -- Pour les rôles de fermeture, ne pas compter les assignés normaux
    WHEN tb.type_besoin IN ('fermeture_1r', 'fermeture_2f3f') THEN 0
    ELSE COALESCE(MAX(ca.nombre_assignes), 0)
  END AS nombre_assignes,
  CASE 
    -- Pour les rôles de fermeture, toujours afficher comme manquant
    WHEN tb.type_besoin IN ('fermeture_1r', 'fermeture_2f3f') THEN 1
    ELSE GREATEST(0, SUM(tb.nombre_besoins) - COALESCE(MAX(ca.nombre_assignes), 0))
  END AS nombre_manquant
FROM tous_besoins tb
LEFT JOIN capacites_assignees ca 
  ON ca.date = tb.date 
  AND ca.periode = tb.periode 
  AND (
    (tb.type_besoin = 'site' AND ca.site_id = tb.site_id)
    OR
    (tb.type_besoin = 'bloc_operatoire' 
     AND ca.planning_genere_bloc_operatoire_id = tb.planning_genere_bloc_operatoire_id
     AND ca.besoin_operation_id = tb.besoin_operation_id)
  )
GROUP BY tb.date, tb.periode, tb.site_id, tb.besoin_operation_id, tb.planning_genere_bloc_operatoire_id, tb.type_besoin
HAVING 
  CASE 
    WHEN tb.type_besoin IN ('fermeture_1r', 'fermeture_2f3f') THEN 1
    ELSE GREATEST(0, SUM(tb.nombre_besoins) - COALESCE(MAX(ca.nombre_assignes), 0))
  END > 0
ORDER BY tb.date, tb.periode, MAX(tb.site_nom);

-- Create unique index to allow concurrent refresh
CREATE UNIQUE INDEX idx_besoins_non_satisfaits_unique 
ON public.besoins_non_satisfaits_summary(
  date, 
  periode, 
  site_id, 
  COALESCE(planning_genere_bloc_operatoire_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(besoin_operation_id, '00000000-0000-0000-0000-000000000000'::uuid), 
  type_besoin
);

-- Create additional performance indexes
CREATE INDEX idx_besoins_non_satisfaits_date ON public.besoins_non_satisfaits_summary(date);
CREATE INDEX idx_besoins_non_satisfaits_site ON public.besoins_non_satisfaits_summary(site_id);
CREATE INDEX idx_besoins_non_satisfaits_type ON public.besoins_non_satisfaits_summary(type_besoin);

-- Perform initial refresh
REFRESH MATERIALIZED VIEW public.besoins_non_satisfaits_summary;

-- Set permissions
REVOKE ALL ON public.besoins_non_satisfaits_summary FROM anon, authenticated;
GRANT SELECT ON public.besoins_non_satisfaits_summary TO authenticated;