-- Create planning table (one planning per week)
CREATE TABLE IF NOT EXISTS public.planning (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date_debut DATE NOT NULL,
  date_fin DATE NOT NULL,
  date_generation TIMESTAMPTZ NOT NULL DEFAULT now(),
  statut TEXT NOT NULL DEFAULT 'en_cours' CHECK (statut IN ('en_cours', 'valide')),
  pdf_url TEXT,
  validated_at TIMESTAMPTZ,
  validated_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unique_planning_per_week UNIQUE (date_debut, date_fin)
);

-- Add planning_id to planning_genere
ALTER TABLE public.planning_genere 
ADD COLUMN IF NOT EXISTS planning_id UUID REFERENCES public.planning(id) ON DELETE CASCADE;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_planning_genere_planning_id ON public.planning_genere(planning_id);
CREATE INDEX IF NOT EXISTS idx_planning_dates ON public.planning(date_debut, date_fin);
CREATE INDEX IF NOT EXISTS idx_planning_statut ON public.planning(statut);

-- Enable RLS
ALTER TABLE public.planning ENABLE ROW LEVEL SECURITY;

-- RLS Policies for planning
CREATE POLICY "Users can view all planning metadata"
ON public.planning
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Users with planning access can manage planning metadata"
ON public.planning
FOR ALL
TO authenticated
USING (has_planning_access())
WITH CHECK (has_planning_access());

-- Add planning to realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.planning;