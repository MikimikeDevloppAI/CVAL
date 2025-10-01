-- Create table to store base schedule optimization results
CREATE TABLE IF NOT EXISTS public.optimisation_horaires_base (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  specialite_id UUID NOT NULL REFERENCES public.specialites(id) ON DELETE CASCADE,
  jour_semaine INTEGER NOT NULL CHECK (jour_semaine BETWEEN 1 AND 7),
  demi_journee TEXT NOT NULL CHECK (demi_journee IN ('matin', 'apres_midi')),
  besoins NUMERIC NOT NULL DEFAULT 0,
  capacites_assignees INTEGER NOT NULL DEFAULT 0,
  secretaires_assignees UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(specialite_id, jour_semaine, demi_journee)
);

-- Enable RLS
ALTER TABLE public.optimisation_horaires_base ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view optimisation results"
ON public.optimisation_horaires_base
FOR SELECT
USING (true);

CREATE POLICY "Admins can manage optimisation results"
ON public.optimisation_horaires_base
FOR ALL
USING (is_admin());

-- Create trigger for updated_at
CREATE TRIGGER update_optimisation_horaires_base_updated_at
BEFORE UPDATE ON public.optimisation_horaires_base
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Function to recalculate base schedule optimization
CREATE OR REPLACE FUNCTION public.recalculate_base_schedule_optimization()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_specialite RECORD;
  v_jour INTEGER;
  v_demi_journee TEXT;
  v_besoins NUMERIC;
  v_secretaires RECORD;
  v_assigned_count INTEGER;
  v_assigned_secretaires UUID[];
BEGIN
  -- Clear existing optimization data
  DELETE FROM public.optimisation_horaires_base;
  
  -- For each specialty
  FOR v_specialite IN SELECT id, nom FROM public.specialites ORDER BY nom LOOP
    -- For each day (Monday to Friday)
    FOR v_jour IN 1..5 LOOP
      -- For each half-day
      FOR v_demi_journee IN SELECT unnest(ARRAY['matin', 'apres_midi']) LOOP
        -- Calculate needs for this slot
        v_besoins := 0;
        
        -- Sum up doctor needs
        SELECT COALESCE(SUM(
          CASE 
            WHEN v_demi_journee = 'matin' THEN
              CASE 
                WHEN hbm.heure_debut < '12:00:00' AND hbm.heure_fin > '07:30:00' THEN
                  m.besoin_secretaires * (
                    LEAST(EXTRACT(EPOCH FROM hbm.heure_fin::time), EXTRACT(EPOCH FROM '12:00:00'::time)) - 
                    GREATEST(EXTRACT(EPOCH FROM hbm.heure_debut::time), EXTRACT(EPOCH FROM '07:30:00'::time))
                  ) / (4.5 * 3600)
                ELSE 0
              END
            ELSE -- apres_midi
              CASE 
                WHEN hbm.heure_debut < '17:00:00' AND hbm.heure_fin > '13:00:00' THEN
                  m.besoin_secretaires * (
                    LEAST(EXTRACT(EPOCH FROM hbm.heure_fin::time), EXTRACT(EPOCH FROM '17:00:00'::time)) - 
                    GREATEST(EXTRACT(EPOCH FROM hbm.heure_debut::time), EXTRACT(EPOCH FROM '13:00:00'::time))
                  ) / (4.0 * 3600)
                ELSE 0
              END
          END
        ), 0)
        INTO v_besoins
        FROM public.horaires_base_medecins hbm
        JOIN public.medecins m ON m.id = hbm.medecin_id
        WHERE hbm.jour_semaine = v_jour
          AND hbm.actif = true
          AND m.actif = true
          AND m.specialite_id = v_specialite.id;
        
        -- Find available secretaries for this slot and specialty
        v_assigned_count := 0;
        v_assigned_secretaires := '{}';
        
        FOR v_secretaires IN
          SELECT DISTINCT s.id
          FROM public.horaires_base_secretaires hbs
          JOIN public.secretaires s ON s.id = hbs.secretaire_id
          WHERE hbs.jour_semaine = v_jour
            AND hbs.actif = true
            AND s.actif = true
            AND v_specialite.id = ANY(s.specialites)
            AND (
              (v_demi_journee = 'matin' AND hbs.heure_debut < '12:00:00' AND hbs.heure_fin > '07:30:00') OR
              (v_demi_journee = 'apres_midi' AND hbs.heure_debut < '17:00:00' AND hbs.heure_fin > '13:00:00')
            )
          LIMIT CEIL(v_besoins)::INTEGER
        LOOP
          v_assigned_count := v_assigned_count + 1;
          v_assigned_secretaires := array_append(v_assigned_secretaires, v_secretaires.id);
        END LOOP;
        
        -- Add backup capacity if needed
        IF v_assigned_count < CEIL(v_besoins) THEN
          FOR v_secretaires IN
            SELECT id
            FROM public.backup
            WHERE actif = true
              AND v_specialite.id = ANY(specialites)
            LIMIT (CEIL(v_besoins)::INTEGER - v_assigned_count)
          LOOP
            v_assigned_count := v_assigned_count + 1;
            v_assigned_secretaires := array_append(v_assigned_secretaires, v_secretaires.id);
          END LOOP;
        END IF;
        
        -- Insert optimization result
        INSERT INTO public.optimisation_horaires_base (
          specialite_id,
          jour_semaine,
          demi_journee,
          besoins,
          capacites_assignees,
          secretaires_assignees
        ) VALUES (
          v_specialite.id,
          v_jour,
          v_demi_journee,
          ROUND(v_besoins * 10) / 10,
          v_assigned_count,
          v_assigned_secretaires
        );
        
      END LOOP;
    END LOOP;
  END LOOP;
END;
$$;

-- Trigger function to recalculate on changes
CREATE OR REPLACE FUNCTION public.trigger_recalculate_base_optimization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.recalculate_base_schedule_optimization();
  RETURN NEW;
END;
$$;

-- Create triggers on horaires_base_medecins
CREATE TRIGGER recalc_optimization_on_medecins_insert
AFTER INSERT ON public.horaires_base_medecins
FOR EACH STATEMENT
EXECUTE FUNCTION public.trigger_recalculate_base_optimization();

CREATE TRIGGER recalc_optimization_on_medecins_update
AFTER UPDATE ON public.horaires_base_medecins
FOR EACH STATEMENT
EXECUTE FUNCTION public.trigger_recalculate_base_optimization();

CREATE TRIGGER recalc_optimization_on_medecins_delete
AFTER DELETE ON public.horaires_base_medecins
FOR EACH STATEMENT
EXECUTE FUNCTION public.trigger_recalculate_base_optimization();

-- Create triggers on horaires_base_secretaires
CREATE TRIGGER recalc_optimization_on_secretaires_insert
AFTER INSERT ON public.horaires_base_secretaires
FOR EACH STATEMENT
EXECUTE FUNCTION public.trigger_recalculate_base_optimization();

CREATE TRIGGER recalc_optimization_on_secretaires_update
AFTER UPDATE ON public.horaires_base_secretaires
FOR EACH STATEMENT
EXECUTE FUNCTION public.trigger_recalculate_base_optimization();

CREATE TRIGGER recalc_optimization_on_secretaires_delete
AFTER DELETE ON public.horaires_base_secretaires
FOR EACH STATEMENT
EXECUTE FUNCTION public.trigger_recalculate_base_optimization();

-- Initial calculation
SELECT public.recalculate_base_schedule_optimization();