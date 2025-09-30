-- Drop triggers that regenerate everything on each row change
DROP TRIGGER IF EXISTS on_medecin_horaire_change ON public.horaires_base_medecins;
DROP TRIGGER IF EXISTS on_secretaire_horaire_change ON public.horaires_base_secretaires;

-- We'll call the generation functions manually from the application code
-- after bulk inserts/updates are complete