-- Create configurations_multi_flux table to store double and triple flux configurations
CREATE TABLE IF NOT EXISTS public.configurations_multi_flux (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nom TEXT NOT NULL,
  code TEXT NOT NULL,
  type_flux TEXT NOT NULL CHECK (type_flux IN ('double_flux', 'triple_flux')),
  actif BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create configurations_multi_flux_interventions table to store the intervention-to-room assignments
CREATE TABLE IF NOT EXISTS public.configurations_multi_flux_interventions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  configuration_id UUID NOT NULL REFERENCES public.configurations_multi_flux(id) ON DELETE CASCADE,
  type_intervention_id UUID NOT NULL REFERENCES public.types_intervention(id) ON DELETE CASCADE,
  salle TEXT NOT NULL CHECK (salle IN ('rouge', 'verte', 'jaune')),
  ordre INTEGER NOT NULL, -- 1, 2, or 3 to maintain order
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(configuration_id, ordre)
);

-- Add RLS policies
ALTER TABLE public.configurations_multi_flux ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.configurations_multi_flux_interventions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users with planning access can manage configurations"
  ON public.configurations_multi_flux
  FOR ALL
  USING (has_planning_access())
  WITH CHECK (has_planning_access());

CREATE POLICY "Users with planning or admin can view configurations"
  ON public.configurations_multi_flux
  FOR SELECT
  USING (has_planning_or_admin_access());

CREATE POLICY "Users with planning access can manage configuration interventions"
  ON public.configurations_multi_flux_interventions
  FOR ALL
  USING (has_planning_access())
  WITH CHECK (has_planning_access());

CREATE POLICY "Users with planning or admin can view configuration interventions"
  ON public.configurations_multi_flux_interventions
  FOR SELECT
  USING (has_planning_or_admin_access());

-- Add trigger for updated_at
CREATE TRIGGER update_configurations_multi_flux_updated_at
  BEFORE UPDATE ON public.configurations_multi_flux
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add indexes for better performance
CREATE INDEX idx_configurations_multi_flux_actif ON public.configurations_multi_flux(actif);
CREATE INDEX idx_configurations_multi_flux_type_flux ON public.configurations_multi_flux(type_flux);
CREATE INDEX idx_configurations_multi_flux_interventions_config ON public.configurations_multi_flux_interventions(configuration_id);