-- Drop the trigger on absences first
DROP TRIGGER IF EXISTS on_absence_change ON public.absences;

-- Recreate absences table without profile_id
DROP TABLE IF EXISTS public.absences CASCADE;

CREATE TABLE public.absences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type_personne type_personne NOT NULL,
  medecin_id UUID REFERENCES public.medecins(id) ON DELETE CASCADE,
  secretaire_id UUID REFERENCES public.secretaires(id) ON DELETE CASCADE,
  date_debut DATE NOT NULL,
  date_fin DATE NOT NULL,
  type type_absence NOT NULL,
  motif TEXT,
  statut statut_absence NOT NULL DEFAULT 'en_attente',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CHECK (
    (type_personne = 'medecin' AND medecin_id IS NOT NULL AND secretaire_id IS NULL) OR
    (type_personne = 'secretaire' AND secretaire_id IS NOT NULL AND medecin_id IS NULL)
  )
);

-- Enable RLS
ALTER TABLE public.absences ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Admins can manage absences" ON public.absences FOR ALL USING (is_admin());
CREATE POLICY "Users can view all absences" ON public.absences FOR SELECT USING (true);

-- Create index
CREATE INDEX idx_absences_medecin ON public.absences(medecin_id);
CREATE INDEX idx_absences_secretaire ON public.absences(secretaire_id);
CREATE INDEX idx_absences_dates ON public.absences(date_debut, date_fin);

-- Update handle_absence_changes function
CREATE OR REPLACE FUNCTION public.handle_absence_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.type_personne = 'medecin' THEN
    IF NEW.statut IN ('approuve', 'en_attente') THEN
      -- Remove doctor from besoin_effectif
      DELETE FROM public.besoin_effectif
      WHERE medecin_id = NEW.medecin_id
        AND date BETWEEN NEW.date_debut AND NEW.date_fin;
    ELSE
      -- Regenerate besoin for this period
      PERFORM public.generate_besoin_effectif();
    END IF;
  ELSIF NEW.type_personne = 'secretaire' THEN
    IF NEW.statut IN ('approuve', 'en_attente') THEN
      -- Remove secretary from capacite_effective
      DELETE FROM public.capacite_effective
      WHERE secretaire_id = NEW.secretaire_id
        AND date BETWEEN NEW.date_debut AND NEW.date_fin;
    ELSE
      -- Regenerate capacite for this period
      PERFORM public.generate_capacite_effective();
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Update generate_besoin_effectif to check absences properly
CREATE OR REPLACE FUNCTION public.generate_besoin_effectif()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start_date DATE := CURRENT_DATE;
  v_end_date DATE := CURRENT_DATE + INTERVAL '5 weeks';
  v_current_date DATE;
  v_jour_semaine INTEGER;
  v_medecin RECORD;
  v_horaire RECORD;
  v_bloc RECORD;
  v_absence INTEGER;
  v_semaines_diff INTEGER;
  v_should_work BOOLEAN;
BEGIN
  -- Clean old data (older than 8 weeks)
  DELETE FROM public.besoin_effectif WHERE date < CURRENT_DATE - INTERVAL '8 weeks';

  v_current_date := v_start_date;
  
  WHILE v_current_date <= v_end_date LOOP
    v_jour_semaine := EXTRACT(ISODOW FROM v_current_date);
    
    -- Generate for all active doctors
    FOR v_medecin IN
      SELECT id, specialite_id, besoin_secretaires FROM public.medecins WHERE actif = true
    LOOP
      FOR v_horaire IN
        SELECT * FROM public.horaires_base_medecins
        WHERE medecin_id = v_medecin.id
          AND jour_semaine = v_jour_semaine
          AND actif = true
      LOOP
        -- Calculate if doctor should work this week based on alternance
        v_semaines_diff := FLOOR((v_current_date - v_horaire.alternance_semaine_reference) / 7);
        
        v_should_work := CASE v_horaire.alternance_type
          WHEN 'hebdomadaire' THEN true
          WHEN 'une_sur_deux' THEN (v_semaines_diff % 2 = 0)
          WHEN 'une_sur_trois' THEN (v_semaines_diff % 3 = 0)
          WHEN 'une_sur_quatre' THEN (v_semaines_diff % 4 = 0)
          ELSE true
        END;
        
        IF v_should_work THEN
          -- Check for absence using medecin_id
          SELECT COUNT(*) INTO v_absence
          FROM public.absences
          WHERE medecin_id = v_medecin.id
            AND v_current_date BETWEEN date_debut AND date_fin
            AND statut IN ('approuve', 'en_attente');
          
          -- Only insert if no absence
          IF v_absence = 0 THEN
            INSERT INTO public.besoin_effectif (
              date, type, medecin_id, site_id, specialite_id,
              heure_debut, heure_fin, nombre_secretaires_requis
            ) VALUES (
              v_current_date, 'medecin', v_medecin.id, v_horaire.site_id, v_medecin.specialite_id,
              v_horaire.heure_debut, v_horaire.heure_fin, v_medecin.besoin_secretaires
            )
            ON CONFLICT DO NOTHING;
          END IF;
        END IF;
      END LOOP;
    END LOOP;
    
    -- Generate for bloc operatoire
    FOR v_bloc IN
      SELECT * FROM public.bloc_operatoire_besoins
      WHERE date = v_current_date AND actif = true
    LOOP
      INSERT INTO public.besoin_effectif (
        date, type, bloc_operatoire_besoin_id, site_id, specialite_id,
        heure_debut, heure_fin, nombre_secretaires_requis
      ) VALUES (
        v_bloc.date, 'bloc_operatoire', v_bloc.id,
        (SELECT id FROM public.sites WHERE actif = true LIMIT 1),
        v_bloc.specialite_id, v_bloc.heure_debut, v_bloc.heure_fin,
        v_bloc.nombre_secretaires_requis
      )
      ON CONFLICT DO NOTHING;
    END LOOP;
    
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
END;
$$;

-- Update generate_capacite_effective to check absences properly
CREATE OR REPLACE FUNCTION public.generate_capacite_effective()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start_date DATE := CURRENT_DATE;
  v_end_date DATE := CURRENT_DATE + INTERVAL '5 weeks';
  v_current_date DATE;
  v_jour_semaine INTEGER;
  v_secretaire RECORD;
  v_horaire RECORD;
  v_absence INTEGER;
BEGIN
  -- Clean old data
  DELETE FROM public.capacite_effective WHERE date < CURRENT_DATE - INTERVAL '8 weeks';

  v_current_date := v_start_date;
  
  WHILE v_current_date <= v_end_date LOOP
    v_jour_semaine := EXTRACT(ISODOW FROM v_current_date);
    
    FOR v_secretaire IN
      SELECT id, specialites, site_preferentiel_id FROM public.secretaires WHERE actif = true
    LOOP
      FOR v_horaire IN
        SELECT * FROM public.horaires_base_secretaires
        WHERE secretaire_id = v_secretaire.id
          AND jour_semaine = v_jour_semaine
          AND actif = true
      LOOP
        -- Check for absence using secretaire_id
        SELECT COUNT(*) INTO v_absence
        FROM public.absences
        WHERE secretaire_id = v_secretaire.id
          AND v_current_date BETWEEN date_debut AND date_fin
          AND statut IN ('approuve', 'en_attente');
        
        -- Only insert if no absence
        IF v_absence = 0 THEN
          INSERT INTO public.capacite_effective (
            date, secretaire_id, site_id, heure_debut, heure_fin, specialites
          ) VALUES (
            v_current_date, v_secretaire.id,
            COALESCE(v_secretaire.site_preferentiel_id, (SELECT id FROM public.sites WHERE actif = true LIMIT 1)),
            v_horaire.heure_debut, v_horaire.heure_fin, v_secretaire.specialites
          )
          ON CONFLICT DO NOTHING;
        END IF;
      END LOOP;
    END LOOP;
    
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
END;
$$;

-- Recreate trigger
CREATE TRIGGER on_absence_change
  AFTER INSERT OR UPDATE ON public.absences
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_absence_changes();

-- Update timestamps trigger
CREATE TRIGGER update_absences_updated_at
  BEFORE UPDATE ON public.absences
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();