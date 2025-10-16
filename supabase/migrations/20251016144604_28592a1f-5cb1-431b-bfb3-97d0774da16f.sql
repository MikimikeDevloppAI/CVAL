-- Ajouter la nouvelle colonne besoin_operation_id à planning_genere_personnel
ALTER TABLE public.planning_genere_personnel
ADD COLUMN besoin_operation_id UUID REFERENCES public.besoins_operations(id);

-- Créer un index pour améliorer les performances des requêtes
CREATE INDEX idx_planning_genere_personnel_besoin_operation 
ON public.planning_genere_personnel(besoin_operation_id);

-- Supprimer l'ancienne colonne type_besoin_bloc
ALTER TABLE public.planning_genere_personnel
DROP COLUMN type_besoin_bloc;