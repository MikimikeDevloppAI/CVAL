-- Remove triggers and functions that cause multiple regenerations when horaires_base are modified
-- Drop triggers first
DROP TRIGGER IF EXISTS trigger_regenerate_doctor_on_horaire_change ON public.horaires_base_medecins;
DROP TRIGGER IF EXISTS trigger_regenerate_secretary_on_horaire_change ON public.horaires_base_secretaires;
DROP TRIGGER IF EXISTS trigger_regenerate_doctor_individual ON public.horaires_base_medecins;
DROP TRIGGER IF EXISTS trigger_regenerate_secretary_individual ON public.horaires_base_secretaires;
DROP TRIGGER IF EXISTS trigger_regenerate_medecin_on_change ON public.medecins;
DROP TRIGGER IF EXISTS trigger_regenerate_secretaire_on_change ON public.secretaires;

-- Then drop the functions with CASCADE to handle any remaining dependencies
DROP FUNCTION IF EXISTS public.trigger_regenerate_doctor_individual() CASCADE;
DROP FUNCTION IF EXISTS public.trigger_regenerate_secretary_individual() CASCADE;
DROP FUNCTION IF EXISTS public.trigger_regenerate_medecin_on_change() CASCADE;
DROP FUNCTION IF EXISTS public.trigger_regenerate_secretaire_on_change() CASCADE;