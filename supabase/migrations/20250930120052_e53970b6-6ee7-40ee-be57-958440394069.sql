-- Ajouter la colonne backup_id à la table capacite_effective
ALTER TABLE public.capacite_effective 
ADD COLUMN backup_id UUID REFERENCES public.backup(id);

-- Créer une contrainte pour s'assurer qu'on a soit secretaire_id soit backup_id, mais pas les deux
ALTER TABLE public.capacite_effective 
ADD CONSTRAINT check_one_person_type 
CHECK (
  (secretaire_id IS NOT NULL AND backup_id IS NULL) OR 
  (secretaire_id IS NULL AND backup_id IS NOT NULL)
);

-- Mettre à jour la contrainte unique pour inclure backup_id
ALTER TABLE public.capacite_effective 
DROP CONSTRAINT IF EXISTS capacite_effective_secretaire_id_date_heure_debut_heure_fin_key;

-- Créer un index pour les backups
CREATE INDEX idx_capacite_effective_backup_id ON public.capacite_effective(backup_id);