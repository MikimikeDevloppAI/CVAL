-- Drop unused columns from secretaires table
ALTER TABLE public.secretaires 
  DROP COLUMN IF EXISTS personnel_bloc,
  DROP COLUMN IF EXISTS prefere_port_en_truie;

-- Modify secretaires_besoins_operations to use preference instead of niveau_competence
ALTER TABLE public.secretaires_besoins_operations 
  DROP COLUMN IF EXISTS niveau_competence;

ALTER TABLE public.secretaires_besoins_operations 
  ADD COLUMN preference INTEGER CHECK (preference IN (1, 2, 3));

COMMENT ON COLUMN public.secretaires_besoins_operations.preference IS 'Niveau de préférence pour ce besoin opérationnel (1=priorité haute, 2=priorité moyenne, 3=priorité basse)';