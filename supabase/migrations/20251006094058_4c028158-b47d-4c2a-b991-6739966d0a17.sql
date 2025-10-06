-- Ajouter le champ responsable_3f_id à la table planning_genere
ALTER TABLE public.planning_genere 
ADD COLUMN responsable_3f_id uuid REFERENCES public.secretaires(id);