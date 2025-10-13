-- 1. Nettoyer les anciennes structures si elles existent
DROP TABLE IF EXISTS planning_genere CASCADE;
DROP TABLE IF EXISTS planning_genere_site_personnel CASCADE;
DROP TABLE IF EXISTS planning_genere_site_besoin CASCADE;
DROP TABLE IF EXISTS planning_genere_site CASCADE;

-- 2. Créer le type periode s'il n'existe pas déjà
DO $$ BEGIN
  CREATE TYPE periode AS ENUM ('matin', 'apres_midi');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 3. Créer table planning_genere_site_besoin
CREATE TABLE planning_genere_site_besoin (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  planning_id UUID REFERENCES planning(id),
  date DATE NOT NULL,
  site_id UUID REFERENCES sites(id) NOT NULL,
  periode periode NOT NULL,
  medecins_ids UUID[] NOT NULL DEFAULT '{}',
  nombre_secretaires_requis INTEGER NOT NULL DEFAULT 0,
  statut statut_planning DEFAULT 'planifie',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_planning_site_besoin_planning ON planning_genere_site_besoin(planning_id);
CREATE INDEX idx_planning_site_besoin_date ON planning_genere_site_besoin(date);
CREATE INDEX idx_planning_site_besoin_site ON planning_genere_site_besoin(site_id);

-- 4. Créer table planning_genere_site_personnel
CREATE TABLE planning_genere_site_personnel (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  planning_genere_site_besoin_id UUID NOT NULL REFERENCES planning_genere_site_besoin(id) ON DELETE CASCADE,
  medecin_id UUID REFERENCES medecins(id),
  secretaire_id UUID REFERENCES secretaires(id),
  ordre INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_planning_site_personnel_besoin ON planning_genere_site_personnel(planning_genere_site_besoin_id);
CREATE INDEX idx_planning_site_personnel_medecin ON planning_genere_site_personnel(medecin_id);
CREATE INDEX idx_planning_site_personnel_secretaire ON planning_genere_site_personnel(secretaire_id);

-- 5. Créer table planning_genere unifiée
CREATE TABLE planning_genere (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  planning_id UUID REFERENCES planning(id),
  date DATE NOT NULL,
  periode periode NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('site', 'bloc_operatoire', 'administratif')),
  
  -- Références vers détails
  planning_genere_site_besoin_id UUID REFERENCES planning_genere_site_besoin(id) ON DELETE CASCADE,
  planning_genere_bloc_operatoire_id UUID REFERENCES planning_genere_bloc_operatoire(id) ON DELETE CASCADE,
  
  -- Pour administratif directement
  secretaire_id UUID REFERENCES secretaires(id),
  
  statut statut_planning DEFAULT 'planifie',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_planning_genere_planning ON planning_genere(planning_id);
CREATE INDEX idx_planning_genere_date ON planning_genere(date);
CREATE INDEX idx_planning_genere_type ON planning_genere(type);
CREATE INDEX idx_planning_genere_site_besoin ON planning_genere(planning_genere_site_besoin_id);
CREATE INDEX idx_planning_genere_bloc ON planning_genere(planning_genere_bloc_operatoire_id);

-- 6. Créer site Administratif
INSERT INTO sites (id, nom, adresse, actif, fermeture, specialite_id)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Administratif',
  'Tâches administratives',
  true,
  false,
  NULL
)
ON CONFLICT (id) DO NOTHING;

-- 7. RLS policies pour nouvelles tables
ALTER TABLE planning_genere_site_besoin ENABLE ROW LEVEL SECURITY;
ALTER TABLE planning_genere_site_personnel ENABLE ROW LEVEL SECURITY;
ALTER TABLE planning_genere ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users with planning access can manage site besoin"
  ON planning_genere_site_besoin FOR ALL
  USING (has_planning_access())
  WITH CHECK (has_planning_access());

CREATE POLICY "Users with planning or admin can view site besoin"
  ON planning_genere_site_besoin FOR SELECT
  USING (has_planning_or_admin_access());

CREATE POLICY "Users with planning access can manage site personnel"
  ON planning_genere_site_personnel FOR ALL
  USING (has_planning_access())
  WITH CHECK (has_planning_access());

CREATE POLICY "Users with planning or admin can view site personnel"
  ON planning_genere_site_personnel FOR SELECT
  USING (has_planning_or_admin_access());

CREATE POLICY "Users with planning access can manage planning_genere"
  ON planning_genere FOR ALL
  USING (has_planning_access())
  WITH CHECK (has_planning_access());

CREATE POLICY "Users with planning or admin can view planning_genere"
  ON planning_genere FOR SELECT
  USING (has_planning_or_admin_access());