-- Rendre secretaire_id nullable pour permettre l'utilisation de backup_id
ALTER TABLE public.capacite_effective
ALTER COLUMN secretaire_id DROP NOT NULL;

-- Mettre à jour la contrainte pour s'assurer qu'exactement un des deux est renseigné
ALTER TABLE public.capacite_effective
DROP CONSTRAINT IF EXISTS check_one_person_type;

ALTER TABLE public.capacite_effective
ADD CONSTRAINT check_one_person_type
CHECK (
  (secretaire_id IS NOT NULL AND backup_id IS NULL) OR
  (secretaire_id IS NULL AND backup_id IS NOT NULL)
);