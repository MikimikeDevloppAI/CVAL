-- Supprimer l'ancien trigger qui utilise heure_debut/heure_fin
DROP TRIGGER IF EXISTS validate_absence_times_trigger ON public.absences CASCADE;
DROP FUNCTION IF EXISTS public.validate_absence_times() CASCADE;