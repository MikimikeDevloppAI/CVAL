-- Ajouter la colonne site_id à la table horaires_base_medecins
ALTER TABLE public.horaires_base_medecins 
ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES public.sites(id);