-- ============================================
-- PHASE 1: Créer les nouvelles tables et structures
-- ============================================

-- 1. Créer la table de référence besoins_operations
CREATE TABLE IF NOT EXISTS public.besoins_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  nom TEXT NOT NULL,
  description TEXT,
  categorie TEXT,
  actif BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Créer la table de liaison secretaires_besoins_operations
CREATE TABLE IF NOT EXISTS public.secretaires_besoins_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  secretaire_id UUID NOT NULL REFERENCES public.secretaires(id) ON DELETE CASCADE,
  besoin_operation_id UUID NOT NULL REFERENCES public.besoins_operations(id) ON DELETE CASCADE,
  niveau_competence TEXT DEFAULT 'standard',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(secretaire_id, besoin_operation_id)
);

-- 3. Ajouter la nouvelle colonne à types_intervention_besoins_personnel
ALTER TABLE public.types_intervention_besoins_personnel 
  ADD COLUMN IF NOT EXISTS besoin_operation_id UUID REFERENCES public.besoins_operations(id);

-- 4. Trigger pour updated_at sur besoins_operations
CREATE TRIGGER update_besoins_operations_updated_at
  BEFORE UPDATE ON public.besoins_operations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 5. Trigger pour updated_at sur secretaires_besoins_operations
CREATE TRIGGER update_secretaires_besoins_operations_updated_at
  BEFORE UPDATE ON public.secretaires_besoins_operations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- PHASE 2: Peupler les données de référence
-- ============================================

-- Insérer les types de besoins d'opération
INSERT INTO public.besoins_operations (code, nom, categorie, description) VALUES
  ('anesthesiste', 'Anesthésiste', 'bloc_operatoire', 'Personnel anesthésiste pour bloc opératoire'),
  ('instrumentiste', 'Instrumentiste', 'bloc_operatoire', 'Instrumentiste pour assistance chirurgicale'),
  ('instrumentiste_aide_salle', 'Instrumentiste / Aide de salle', 'bloc_operatoire', 'Personnel polyvalent instrumentiste et aide de salle'),
  ('aide_salle', 'Aide de salle', 'bloc_operatoire', 'Aide de salle pour bloc opératoire'),
  ('accueil', 'Accueil', 'accueil', 'Personnel d''accueil général'),
  ('accueil_ophtalmo', 'Accueil Ophtalmologie', 'accueil', 'Personnel d''accueil spécialisé en ophtalmologie'),
  ('accueil_dermato', 'Accueil Dermatologie', 'accueil', 'Personnel d''accueil spécialisé en dermatologie'),
  ('administratif', 'Assignation Administrative', 'administratif', 'Assignation pour tâches administratives')
ON CONFLICT (code) DO NOTHING;

-- ============================================
-- PHASE 3: Migrer les données existantes
-- ============================================

-- Migrer les capacités des secrétaires vers secretaires_besoins_operations
INSERT INTO public.secretaires_besoins_operations (secretaire_id, besoin_operation_id, niveau_competence)
SELECT DISTINCT s.id, b.id, 'standard'
FROM public.secretaires s
CROSS JOIN public.besoins_operations b
WHERE 
  (s.anesthesiste = true AND b.code = 'anesthesiste') OR
  (s.instrumentaliste = true AND b.code = 'instrumentiste') OR
  (s.aide_de_salle = true AND b.code = 'aide_salle') OR
  (s.bloc_ophtalmo_accueil = true AND b.code = 'accueil_ophtalmo') OR
  (s.bloc_dermato_accueil = true AND b.code = 'accueil_dermato') OR
  (s.assignation_administrative = true AND b.code = 'administratif')
ON CONFLICT (secretaire_id, besoin_operation_id) DO NOTHING;

-- Migrer les besoins des types d'intervention
UPDATE public.types_intervention_besoins_personnel tip
SET besoin_operation_id = b.id
FROM public.besoins_operations b
WHERE tip.besoin_operation_id IS NULL
  AND (
    (tip.type_besoin = 'anesthesiste' AND b.code = 'anesthesiste') OR
    (tip.type_besoin = 'instrumentiste' AND b.code = 'instrumentiste') OR
    (tip.type_besoin = 'instrumentiste_aide_salle' AND b.code = 'instrumentiste_aide_salle') OR
    (tip.type_besoin = 'aide_salle' AND b.code = 'aide_salle') OR
    (tip.type_besoin = 'accueil' AND b.code = 'accueil') OR
    (tip.type_besoin = 'accueil_ophtalmo' AND b.code = 'accueil_ophtalmo') OR
    (tip.type_besoin = 'accueil_dermato' AND b.code = 'accueil_dermato')
  );

-- ============================================
-- PHASE 4: Supprimer les anciennes structures
-- ============================================

-- Rendre besoin_operation_id NOT NULL après migration
ALTER TABLE public.types_intervention_besoins_personnel 
  ALTER COLUMN besoin_operation_id SET NOT NULL;

-- Supprimer l'ancienne colonne type_besoin
ALTER TABLE public.types_intervention_besoins_personnel 
  DROP COLUMN IF EXISTS type_besoin;

-- Supprimer les colonnes booléennes obsolètes de secretaires
ALTER TABLE public.secretaires 
  DROP COLUMN IF EXISTS anesthesiste,
  DROP COLUMN IF EXISTS instrumentaliste,
  DROP COLUMN IF EXISTS aide_de_salle,
  DROP COLUMN IF EXISTS bloc_ophtalmo_accueil,
  DROP COLUMN IF EXISTS bloc_dermato_accueil,
  DROP COLUMN IF EXISTS personnel_bloc_operatoire,
  DROP COLUMN IF EXISTS assignation_administrative;

-- ============================================
-- PHASE 5: Configurer les politiques RLS
-- ============================================

-- Activer RLS sur besoins_operations
ALTER TABLE public.besoins_operations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users with planning access can manage besoins operations"
  ON public.besoins_operations FOR ALL
  USING (public.has_planning_access())
  WITH CHECK (public.has_planning_access());

CREATE POLICY "Users with planning or admin can view besoins operations"
  ON public.besoins_operations FOR SELECT
  USING (public.has_planning_or_admin_access());

-- Activer RLS sur secretaires_besoins_operations
ALTER TABLE public.secretaires_besoins_operations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users with planning access can manage secretaires besoins"
  ON public.secretaires_besoins_operations FOR ALL
  USING (public.has_planning_access())
  WITH CHECK (public.has_planning_access());

CREATE POLICY "Users with planning or admin can view secretaires besoins"
  ON public.secretaires_besoins_operations FOR SELECT
  USING (public.has_planning_or_admin_access());

-- ============================================
-- PHASE 6: Créer des index pour la performance
-- ============================================

CREATE INDEX IF NOT EXISTS idx_secretaires_besoins_secretaire 
  ON public.secretaires_besoins_operations(secretaire_id);

CREATE INDEX IF NOT EXISTS idx_secretaires_besoins_besoin 
  ON public.secretaires_besoins_operations(besoin_operation_id);

CREATE INDEX IF NOT EXISTS idx_types_intervention_besoins_besoin 
  ON public.types_intervention_besoins_personnel(besoin_operation_id);

CREATE INDEX IF NOT EXISTS idx_besoins_operations_code 
  ON public.besoins_operations(code) WHERE actif = true;