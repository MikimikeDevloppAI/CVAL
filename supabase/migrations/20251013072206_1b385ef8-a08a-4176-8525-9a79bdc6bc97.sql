-- Create enum for types of personnel needs
CREATE TYPE type_besoin_personnel AS ENUM (
  'anesthesiste',
  'instrumentaliste',
  'instrumentaliste_aide_salle',
  'aide_salle',
  'accueil'
);

-- Create table for personnel needs per intervention type
CREATE TABLE public.types_intervention_besoins_personnel (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  type_intervention_id uuid NOT NULL REFERENCES public.types_intervention(id) ON DELETE CASCADE,
  type_besoin type_besoin_personnel NOT NULL,
  nombre_requis integer NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  actif boolean NOT NULL DEFAULT true,
  UNIQUE(type_intervention_id, type_besoin)
);

-- Enable RLS
ALTER TABLE public.types_intervention_besoins_personnel ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users with planning access can manage besoins personnel"
  ON public.types_intervention_besoins_personnel
  FOR ALL
  USING (public.has_planning_access())
  WITH CHECK (public.has_planning_access());

CREATE POLICY "Users with planning or admin can view besoins personnel"
  ON public.types_intervention_besoins_personnel
  FOR SELECT
  USING (public.has_planning_or_admin_access());

-- Add trigger for updated_at
CREATE TRIGGER update_types_intervention_besoins_personnel_updated_at
  BEFORE UPDATE ON public.types_intervention_besoins_personnel
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add index for better performance
CREATE INDEX idx_types_intervention_besoins_personnel_type_intervention 
  ON public.types_intervention_besoins_personnel(type_intervention_id);