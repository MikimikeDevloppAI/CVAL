-- Ajouter les colonnes à capacite_effective pour lier les capacités aux opérations du bloc
ALTER TABLE public.capacite_effective 
ADD COLUMN planning_genere_bloc_operatoire_id UUID REFERENCES public.planning_genere_bloc_operatoire(id) ON DELETE SET NULL,
ADD COLUMN besoin_operation_id UUID REFERENCES public.besoins_operations(id) ON DELETE SET NULL;

-- Créer des index pour améliorer les performances des requêtes
CREATE INDEX idx_capacite_effective_planning_bloc ON public.capacite_effective(planning_genere_bloc_operatoire_id);
CREATE INDEX idx_capacite_effective_besoin ON public.capacite_effective(besoin_operation_id);
CREATE INDEX idx_capacite_effective_date_periode ON public.capacite_effective(date, demi_journee);

COMMENT ON COLUMN public.capacite_effective.planning_genere_bloc_operatoire_id IS 'ID de l''opération du bloc à laquelle cette capacité est assignée (NULL = disponible)';
COMMENT ON COLUMN public.capacite_effective.besoin_operation_id IS 'ID du rôle/besoin que la secrétaire remplit pour cette opération (instrumentiste, aide salle, etc.)';