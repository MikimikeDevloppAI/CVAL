-- Add planning column to profiles table
ALTER TABLE public.profiles ADD COLUMN planning boolean NOT NULL DEFAULT false;

-- Create security definer function to check planning access
CREATE OR REPLACE FUNCTION public.has_planning_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT planning FROM public.profiles WHERE id = auth.uid()), FALSE);
$$;

-- Update RLS policies for absences
DROP POLICY IF EXISTS "Admins can manage absences" ON public.absences;
CREATE POLICY "Users with planning access can manage absences"
ON public.absences
FOR ALL
USING (has_planning_access())
WITH CHECK (has_planning_access());

-- Update RLS policies for assignations_1r_2f_historique
DROP POLICY IF EXISTS "Admins can manage assignations 1r/2f historique" ON public.assignations_1r_2f_historique;
CREATE POLICY "Users with planning access can manage assignations 1r/2f"
ON public.assignations_1r_2f_historique
FOR ALL
USING (has_planning_access())
WITH CHECK (has_planning_access());

-- Update RLS policies for backup
DROP POLICY IF EXISTS "Admins can manage backup" ON public.backup;
CREATE POLICY "Users with planning access can manage backup"
ON public.backup
FOR ALL
USING (has_planning_access())
WITH CHECK (has_planning_access());

-- Update RLS policies for besoin_effectif
DROP POLICY IF EXISTS "Admins can manage besoin_effectif" ON public.besoin_effectif;
CREATE POLICY "Users with planning access can manage besoin_effectif"
ON public.besoin_effectif
FOR ALL
USING (has_planning_access())
WITH CHECK (has_planning_access());

-- Update RLS policies for besoins_sites
DROP POLICY IF EXISTS "Admins can manage besoins sites" ON public.besoins_sites;
CREATE POLICY "Users with planning access can manage besoins sites"
ON public.besoins_sites
FOR ALL
USING (has_planning_access())
WITH CHECK (has_planning_access());

-- Update RLS policies for bloc_operatoire_besoins
DROP POLICY IF EXISTS "Admins can manage bloc operatoire besoins" ON public.bloc_operatoire_besoins;
CREATE POLICY "Users with planning access can manage bloc operatoire besoins"
ON public.bloc_operatoire_besoins
FOR ALL
USING (has_planning_access())
WITH CHECK (has_planning_access());

-- Update RLS policies for capacite_effective
DROP POLICY IF EXISTS "Admins can manage capacite_effective" ON public.capacite_effective;
CREATE POLICY "Users with planning access can manage capacite_effective"
ON public.capacite_effective
FOR ALL
USING (has_planning_access())
WITH CHECK (has_planning_access());

-- Update RLS policies for horaires_base_medecins
DROP POLICY IF EXISTS "Admins can manage horaires medecins" ON public.horaires_base_medecins;
CREATE POLICY "Users with planning access can manage horaires medecins"
ON public.horaires_base_medecins
FOR ALL
USING (has_planning_access())
WITH CHECK (has_planning_access());

-- Update RLS policies for horaires_base_secretaires
DROP POLICY IF EXISTS "Admins can manage horaires secretaires" ON public.horaires_base_secretaires;
CREATE POLICY "Users with planning access can manage horaires secretaires"
ON public.horaires_base_secretaires
FOR ALL
USING (has_planning_access())
WITH CHECK (has_planning_access());

-- Update RLS policies for horaires_effectifs
DROP POLICY IF EXISTS "Admins can manage horaires effectifs" ON public.horaires_effectifs;
CREATE POLICY "Users with planning access can manage horaires effectifs"
ON public.horaires_effectifs
FOR ALL
USING (has_planning_access())
WITH CHECK (has_planning_access());

-- Update RLS policies for medecins
DROP POLICY IF EXISTS "Admins can manage medecins" ON public.medecins;
CREATE POLICY "Users with planning access can manage medecins"
ON public.medecins
FOR ALL
USING (has_planning_access())
WITH CHECK (has_planning_access());

-- Update RLS policies for optimisation_horaires_base
DROP POLICY IF EXISTS "Admins can manage optimisation results" ON public.optimisation_horaires_base;
CREATE POLICY "Users with planning access can manage optimisation results"
ON public.optimisation_horaires_base
FOR ALL
USING (has_planning_access())
WITH CHECK (has_planning_access());

-- Update RLS policies for planning_genere
DROP POLICY IF EXISTS "Admins can manage planning" ON public.planning_genere;
CREATE POLICY "Users with planning access can manage planning"
ON public.planning_genere
FOR ALL
USING (has_planning_access())
WITH CHECK (has_planning_access());

-- Update RLS policies for secretaires
DROP POLICY IF EXISTS "Admins can manage secretaires" ON public.secretaires;
CREATE POLICY "Users with planning access can manage secretaires"
ON public.secretaires
FOR ALL
USING (has_planning_access())
WITH CHECK (has_planning_access());

-- Update RLS policies for sites
DROP POLICY IF EXISTS "Admins can manage sites" ON public.sites;
CREATE POLICY "Users with planning access can manage sites"
ON public.sites
FOR ALL
USING (has_planning_access())
WITH CHECK (has_planning_access());

-- Update RLS policies for specialites
DROP POLICY IF EXISTS "Admins can manage specialites" ON public.specialites;
CREATE POLICY "Users with planning access can manage specialites"
ON public.specialites
FOR ALL
USING (has_planning_access())
WITH CHECK (has_planning_access());