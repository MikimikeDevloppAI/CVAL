-- Ajouter la colonne validated aux tables de planning généré
ALTER TABLE public.planning_genere_personnel 
ADD COLUMN validated BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.planning_genere_bloc_operatoire
ADD COLUMN validated BOOLEAN NOT NULL DEFAULT false;

-- Index pour optimiser les requêtes de validation
CREATE INDEX idx_planning_personnel_validated 
ON public.planning_genere_personnel(validated, secretaire_id, date);

CREATE INDEX idx_planning_bloc_validated
ON public.planning_genere_bloc_operatoire(validated, date);