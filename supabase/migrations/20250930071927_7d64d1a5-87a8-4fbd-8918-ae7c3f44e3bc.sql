-- Drop the existing backup table if it exists
DROP TABLE IF EXISTS public.backup CASCADE;

-- Create a simple backup table
CREATE TABLE public.backup (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  first_name text,
  name text,
  email text,
  phone_number text,
  specialites uuid[] NOT NULL DEFAULT '{}',
  actif boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.backup ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Admins can manage backup"
ON public.backup
FOR ALL
USING (is_admin());

CREATE POLICY "Users can view all backup"
ON public.backup
FOR SELECT
USING (true);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_backup_updated_at
BEFORE UPDATE ON public.backup
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();