-- Create table for bloc operatoire needs
CREATE TABLE public.bloc_operatoire_besoins (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  date date NOT NULL,
  specialite_id uuid NOT NULL REFERENCES public.specialites(id) ON DELETE CASCADE,
  nombre_secretaires_requis integer NOT NULL DEFAULT 1,
  heure_debut time without time zone NOT NULL,
  heure_fin time without time zone NOT NULL,
  actif boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.bloc_operatoire_besoins ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Admins can manage bloc operatoire besoins"
ON public.bloc_operatoire_besoins
FOR ALL
USING (is_admin());

CREATE POLICY "Users can view bloc operatoire besoins"
ON public.bloc_operatoire_besoins
FOR SELECT
USING (true);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_bloc_operatoire_besoins_updated_at
BEFORE UPDATE ON public.bloc_operatoire_besoins
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();