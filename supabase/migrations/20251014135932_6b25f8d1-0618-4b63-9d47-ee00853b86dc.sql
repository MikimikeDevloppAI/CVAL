-- Étape 1: Créer la table unifiée planning_genere_personnel
CREATE TABLE public.planning_genere_personnel (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  planning_id uuid REFERENCES public.planning(id) ON DELETE CASCADE,
  date date NOT NULL,
  periode periode NOT NULL,
  secretaire_id uuid REFERENCES public.secretaires(id) ON DELETE SET NULL,
  type_assignation text NOT NULL CHECK (type_assignation IN ('site', 'administratif', 'bloc')),
  ordre integer NOT NULL DEFAULT 1,
  
  -- Références optionnelles selon le type
  besoin_effectif_id uuid REFERENCES public.besoin_effectif(id) ON DELETE CASCADE,
  planning_genere_bloc_operatoire_id uuid REFERENCES public.planning_genere_bloc_operatoire(id) ON DELETE CASCADE,
  type_besoin_bloc type_besoin_personnel,
  
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  -- Contraintes de validation
  CONSTRAINT valid_site_assignment CHECK (
    (type_assignation = 'site' AND besoin_effectif_id IS NOT NULL) OR
    (type_assignation = 'administratif') OR
    (type_assignation = 'bloc' AND planning_genere_bloc_operatoire_id IS NOT NULL)
  )
);

-- Index pour performances
CREATE INDEX idx_planning_personnel_planning ON public.planning_genere_personnel(planning_id);
CREATE INDEX idx_planning_personnel_date_periode ON public.planning_genere_personnel(date, periode);
CREATE INDEX idx_planning_personnel_secretaire ON public.planning_genere_personnel(secretaire_id);
CREATE INDEX idx_planning_personnel_type ON public.planning_genere_personnel(type_assignation);
CREATE INDEX idx_planning_personnel_besoin ON public.planning_genere_personnel(besoin_effectif_id);
CREATE INDEX idx_planning_personnel_bloc ON public.planning_genere_personnel(planning_genere_bloc_operatoire_id);

-- RLS Policies
ALTER TABLE public.planning_genere_personnel ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users with planning access can manage planning_genere_personnel"
  ON public.planning_genere_personnel
  FOR ALL
  USING (public.has_planning_access())
  WITH CHECK (public.has_planning_access());

CREATE POLICY "Users with planning or admin can view planning_genere_personnel"
  ON public.planning_genere_personnel
  FOR SELECT
  USING (public.has_planning_or_admin_access());

-- Étape 2: Migrer les données existantes depuis planning_genere_bloc_personnel
-- Convertir demi_journee en periode (matin -> matin, apres_midi -> apres_midi, toute_journee -> matin)
INSERT INTO public.planning_genere_personnel (
  planning_id, date, periode, secretaire_id,
  type_assignation, ordre, 
  planning_genere_bloc_operatoire_id, type_besoin_bloc
)
SELECT 
  pgbo.planning_id,
  pgbo.date,
  CASE 
    WHEN pgbo.periode::text = 'matin' THEN 'matin'::periode
    WHEN pgbo.periode::text = 'apres_midi' THEN 'apres_midi'::periode
    ELSE 'matin'::periode
  END,
  pgbp.secretaire_id,
  'bloc'::text,
  pgbp.ordre,
  pgbo.id,
  pgbp.type_besoin
FROM public.planning_genere_bloc_personnel pgbp
JOIN public.planning_genere_bloc_operatoire pgbo ON pgbo.id = pgbp.planning_genere_bloc_operatoire_id
WHERE pgbp.secretaire_id IS NOT NULL;

-- Migrer les données depuis planning_genere_site_personnel (uniquement les assignations administratives)
INSERT INTO public.planning_genere_personnel (
  planning_id, date, periode, secretaire_id,
  type_assignation, ordre
)
SELECT 
  pgsb.planning_id,
  pgsb.date,
  pgsb.periode,
  pgsp.secretaire_id,
  pgsp.type_assignation,
  pgsp.ordre
FROM public.planning_genere_site_personnel pgsp
JOIN public.planning_genere_site_besoin pgsb ON pgsb.id = pgsp.planning_genere_site_besoin_id
WHERE pgsp.secretaire_id IS NOT NULL
  AND pgsp.type_assignation = 'administratif';

-- Étape 3: Supprimer les anciennes tables
DROP TABLE IF EXISTS public.planning_genere_site_personnel CASCADE;
DROP TABLE IF EXISTS public.planning_genere_site_besoin CASCADE;
DROP TABLE IF EXISTS public.planning_genere_bloc_personnel CASCADE;