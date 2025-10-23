-- Create dry run table with same structure as capacite_effective
CREATE TABLE IF NOT EXISTS public.capacite_effective_dry_run (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  secretaire_id uuid,
  date date NOT NULL,
  demi_journee demi_journee NOT NULL,
  site_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  besoin_operation_id uuid,
  planning_genere_bloc_operatoire_id uuid,
  is_1r boolean NOT NULL DEFAULT false,
  is_2f boolean NOT NULL DEFAULT false,
  is_3f boolean NOT NULL DEFAULT false,
  actif boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.capacite_effective_dry_run ENABLE ROW LEVEL SECURITY;

-- Create policies (same as capacite_effective)
CREATE POLICY "Users with planning access can manage dry run"
  ON public.capacite_effective_dry_run
  FOR ALL
  USING (has_planning_access())
  WITH CHECK (has_planning_access());

CREATE POLICY "Users with planning or admin can view dry run"
  ON public.capacite_effective_dry_run
  FOR SELECT
  USING (has_planning_or_admin_access());

-- Add trigger for updated_at
CREATE TRIGGER update_capacite_effective_dry_run_updated_at
  BEFORE UPDATE ON public.capacite_effective_dry_run
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_capacite_effective_dry_run_date 
  ON public.capacite_effective_dry_run(date);

CREATE INDEX IF NOT EXISTS idx_capacite_effective_dry_run_secretaire 
  ON public.capacite_effective_dry_run(secretaire_id);