-- Ajouter la colonne salle_preferentielle à la table types_intervention
ALTER TABLE public.types_intervention
ADD COLUMN salle_preferentielle TEXT;

-- Ajouter un constraint pour valider les valeurs possibles
ALTER TABLE public.types_intervention
ADD CONSTRAINT types_intervention_salle_preferentielle_check 
CHECK (salle_preferentielle IS NULL OR salle_preferentielle IN ('rouge', 'verte', 'jaune'));