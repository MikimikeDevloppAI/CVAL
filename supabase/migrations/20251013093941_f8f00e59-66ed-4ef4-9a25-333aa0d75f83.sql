-- Table 1: planning_genere_site (assignations aux sites/horaires réguliers)
CREATE TABLE public.planning_genere_site (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  planning_id UUID REFERENCES public.planning(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  heure_debut TIME NOT NULL,
  heure_fin TIME NOT NULL,
  site_id UUID REFERENCES public.sites(id) ON DELETE CASCADE,
  type_assignation TEXT NOT NULL DEFAULT 'site' CHECK (type_assignation IN ('site', 'administratif')),
  secretaires_ids UUID[] DEFAULT '{}',
  responsable_1r_id UUID REFERENCES public.secretaires(id) ON DELETE SET NULL,
  responsable_2f_id UUID REFERENCES public.secretaires(id) ON DELETE SET NULL,
  responsable_3f_id UUID REFERENCES public.secretaires(id) ON DELETE SET NULL,
  statut statut_planning NOT NULL DEFAULT 'planifie',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Table 2: planning_genere_bloc_operatoire (assignations détaillées pour le bloc)
CREATE TABLE public.planning_genere_bloc_operatoire (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  planning_id UUID REFERENCES public.planning(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  bloc_operatoire_besoin_id UUID REFERENCES public.bloc_operatoire_besoins(id) ON DELETE CASCADE,
  type_intervention_id UUID REFERENCES public.types_intervention(id) ON DELETE CASCADE NOT NULL,
  salle_assignee TEXT CHECK (salle_assignee IN ('rouge', 'verte', 'jaune')),
  heure_debut TIME NOT NULL,
  heure_fin TIME NOT NULL,
  medecin_id UUID REFERENCES public.medecins(id) ON DELETE SET NULL,
  statut statut_planning NOT NULL DEFAULT 'planifie',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Table 3: planning_genere_bloc_personnel (détail du personnel assigné par besoin)
CREATE TABLE public.planning_genere_bloc_personnel (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  planning_genere_bloc_operatoire_id UUID REFERENCES public.planning_genere_bloc_operatoire(id) ON DELETE CASCADE NOT NULL,
  type_besoin type_besoin_personnel NOT NULL,
  secretaire_id UUID REFERENCES public.secretaires(id) ON DELETE CASCADE NOT NULL,
  ordre INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create indexes for better performance
CREATE INDEX idx_planning_genere_site_planning_id ON public.planning_genere_site(planning_id);
CREATE INDEX idx_planning_genere_site_date ON public.planning_genere_site(date);
CREATE INDEX idx_planning_genere_site_site_id ON public.planning_genere_site(site_id);

CREATE INDEX idx_planning_genere_bloc_planning_id ON public.planning_genere_bloc_operatoire(planning_id);
CREATE INDEX idx_planning_genere_bloc_date ON public.planning_genere_bloc_operatoire(date);
CREATE INDEX idx_planning_genere_bloc_besoin_id ON public.planning_genere_bloc_operatoire(bloc_operatoire_besoin_id);

CREATE INDEX idx_planning_genere_bloc_personnel_bloc_id ON public.planning_genere_bloc_personnel(planning_genere_bloc_operatoire_id);
CREATE INDEX idx_planning_genere_bloc_personnel_secretaire_id ON public.planning_genere_bloc_personnel(secretaire_id);

-- Enable RLS on all tables
ALTER TABLE public.planning_genere_site ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planning_genere_bloc_operatoire ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planning_genere_bloc_personnel ENABLE ROW LEVEL SECURITY;

-- RLS Policies for planning_genere_site
CREATE POLICY "Users with planning access can manage planning_genere_site"
ON public.planning_genere_site
FOR ALL
TO authenticated
USING (has_planning_access())
WITH CHECK (has_planning_access());

CREATE POLICY "Users with planning or admin can view planning_genere_site"
ON public.planning_genere_site
FOR SELECT
TO authenticated
USING (has_planning_or_admin_access());

-- RLS Policies for planning_genere_bloc_operatoire
CREATE POLICY "Users with planning access can manage planning_genere_bloc"
ON public.planning_genere_bloc_operatoire
FOR ALL
TO authenticated
USING (has_planning_access())
WITH CHECK (has_planning_access());

CREATE POLICY "Users with planning or admin can view planning_genere_bloc"
ON public.planning_genere_bloc_operatoire
FOR SELECT
TO authenticated
USING (has_planning_or_admin_access());

-- RLS Policies for planning_genere_bloc_personnel
CREATE POLICY "Users with planning access can manage planning_genere_bloc_personnel"
ON public.planning_genere_bloc_personnel
FOR ALL
TO authenticated
USING (has_planning_access())
WITH CHECK (has_planning_access());

CREATE POLICY "Users with planning or admin can view planning_genere_bloc_personnel"
ON public.planning_genere_bloc_personnel
FOR SELECT
TO authenticated
USING (has_planning_or_admin_access());

-- Create triggers for updated_at
CREATE TRIGGER update_planning_genere_site_updated_at
BEFORE UPDATE ON public.planning_genere_site
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_planning_genere_bloc_updated_at
BEFORE UPDATE ON public.planning_genere_bloc_operatoire
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_planning_genere_bloc_personnel_updated_at
BEFORE UPDATE ON public.planning_genere_bloc_personnel
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();