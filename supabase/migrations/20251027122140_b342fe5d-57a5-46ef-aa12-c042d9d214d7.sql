-- Modifier la vue besoins_sites_summary pour le samedi
DROP MATERIALIZED VIEW IF EXISTS besoins_sites_summary CASCADE;

CREATE MATERIALIZED VIEW besoins_sites_summary AS
WITH site_needs AS (
  SELECT
    be.date,
    be.demi_journee,
    be.site_id,
    s.nom as site_nom,
    -- Logique conditionnelle selon le jour de la semaine
    CASE 
      WHEN EXTRACT(ISODOW FROM be.date) = 6 THEN 
        -- Samedi : nombre exact de médecins
        COUNT(DISTINCT be.medecin_id)
      ELSE 
        -- Autres jours : arrondi au supérieur de la somme des besoins
        CEIL(SUM(m.besoin_secretaires))::integer
    END as nombre_requis
  FROM besoin_effectif be
  JOIN sites s ON s.id = be.site_id
  JOIN medecins m ON m.id = be.medecin_id
  WHERE be.actif = true
    AND be.type = 'medecin'
    AND be.site_id != '86f1047f-c4ff-441f-a064-42ee2f8ef37a'
  GROUP BY be.date, be.demi_journee, be.site_id, s.nom
),
site_assignments AS (
  SELECT
    ce.date,
    ce.demi_journee,
    ce.site_id,
    COUNT(DISTINCT ce.secretaire_id) as nombre_assigne
  FROM capacite_effective ce
  WHERE ce.actif = true
    AND ce.site_id != '00000000-0000-0000-0000-000000000001'
    AND ce.site_id != '86f1047f-c4ff-441f-a064-42ee2f8ef37a'
  GROUP BY ce.date, ce.demi_journee, ce.site_id
)
SELECT
  sn.date,
  sn.demi_journee,
  sn.site_id,
  sn.site_nom,
  sn.nombre_requis,
  COALESCE(sa.nombre_assigne, 0) as nombre_assigne,
  GREATEST(0, sn.nombre_requis - COALESCE(sa.nombre_assigne, 0)) as deficit
FROM site_needs sn
LEFT JOIN site_assignments sa ON 
  sn.date = sa.date 
  AND sn.demi_journee = sa.demi_journee 
  AND sn.site_id = sa.site_id
WHERE (sn.nombre_requis - COALESCE(sa.nombre_assigne, 0)) > 0;

CREATE UNIQUE INDEX idx_besoins_sites_unique ON besoins_sites_summary(date, demi_journee, site_id);
CREATE INDEX idx_besoins_sites_date ON besoins_sites_summary(date);
CREATE INDEX idx_besoins_sites_deficit ON besoins_sites_summary(deficit);