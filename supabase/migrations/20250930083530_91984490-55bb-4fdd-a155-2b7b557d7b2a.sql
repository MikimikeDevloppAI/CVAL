-- Drop all existing triggers first
DROP TRIGGER IF EXISTS on_medecin_horaire_change ON public.horaires_base_medecins;
DROP TRIGGER IF EXISTS trigger_horaires_base_medecins_change ON public.horaires_base_medecins;
DROP TRIGGER IF EXISTS on_secretaire_horaire_change ON public.horaires_base_secretaires;
DROP TRIGGER IF EXISTS trigger_horaires_base_secretaires_change ON public.horaires_base_secretaires;
DROP TRIGGER IF EXISTS on_new_medecin ON public.medecins;
DROP TRIGGER IF EXISTS on_new_secretaire ON public.secretaires;
DROP TRIGGER IF EXISTS on_bloc_operatoire_change ON public.bloc_operatoire_besoins;
DROP TRIGGER IF EXISTS on_absence_change ON public.absences;

-- Drop all existing functions with CASCADE
DROP FUNCTION IF EXISTS public.trigger_regenerate_medecin_horaires() CASCADE;
DROP FUNCTION IF EXISTS public.trigger_regenerate_secretaire_horaires() CASCADE;
DROP FUNCTION IF EXISTS public.trigger_new_medecin_horaires() CASCADE;
DROP FUNCTION IF EXISTS public.trigger_new_secretaire_horaires() CASCADE;
DROP FUNCTION IF EXISTS public.sync_bloc_operatoire_to_horaires() CASCADE;
DROP FUNCTION IF EXISTS public.apply_absences_to_horaires() CASCADE;
DROP FUNCTION IF EXISTS public.regenerate_horaires_for_person(uuid, type_personne) CASCADE;
DROP FUNCTION IF EXISTS public.generate_week_plus_5() CASCADE;

-- Create new enum for besoin type
CREATE TYPE type_besoin AS ENUM ('medecin', 'bloc_operatoire');

-- Create besoin_effectif table
CREATE TABLE public.besoin_effectif (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  type type_besoin NOT NULL,
  medecin_id UUID REFERENCES public.medecins(id) ON DELETE CASCADE,
  bloc_operatoire_besoin_id UUID REFERENCES public.bloc_operatoire_besoins(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  specialite_id UUID NOT NULL REFERENCES public.specialites(id) ON DELETE CASCADE,
  heure_debut TIME NOT NULL,
  heure_fin TIME NOT NULL,
  nombre_secretaires_requis NUMERIC NOT NULL DEFAULT 1.2,
  actif BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CHECK (
    (type = 'medecin' AND medecin_id IS NOT NULL AND bloc_operatoire_besoin_id IS NULL) OR
    (type = 'bloc_operatoire' AND bloc_operatoire_besoin_id IS NOT NULL AND medecin_id IS NULL)
  )
);

-- Create capacite_effective table
CREATE TABLE public.capacite_effective (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  secretaire_id UUID NOT NULL REFERENCES public.secretaires(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  heure_debut TIME NOT NULL,
  heure_fin TIME NOT NULL,
  specialites UUID[] NOT NULL DEFAULT '{}',
  actif BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.besoin_effectif ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capacite_effective ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Admins can manage besoin_effectif" ON public.besoin_effectif FOR ALL USING (is_admin());
CREATE POLICY "Users can view besoin_effectif" ON public.besoin_effectif FOR SELECT USING (true);

CREATE POLICY "Admins can manage capacite_effective" ON public.capacite_effective FOR ALL USING (is_admin());
CREATE POLICY "Users can view capacite_effective" ON public.capacite_effective FOR SELECT USING (true);

-- Create indexes
CREATE INDEX idx_besoin_effectif_date ON public.besoin_effectif(date);
CREATE INDEX idx_besoin_effectif_medecin ON public.besoin_effectif(medecin_id);
CREATE INDEX idx_besoin_effectif_site ON public.besoin_effectif(site_id);
CREATE INDEX idx_capacite_effective_date ON public.capacite_effective(date);
CREATE INDEX idx_capacite_effective_secretaire ON public.capacite_effective(secretaire_id);

-- Function to generate besoin_effectif for next 5 weeks
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
      SELECT id, profile_id, specialite_id FROM public.medecins WHERE actif = true
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
          -- Check for absence
          SELECT COUNT(*) INTO v_absence
          FROM public.absences
          WHERE profile_id = v_medecin.profile_id
            AND v_current_date BETWEEN date_debut AND date_fin
            AND statut IN ('approuve', 'en_attente');
          
          -- Only insert if no absence
          IF v_absence = 0 THEN
            INSERT INTO public.besoin_effectif (
              date, type, medecin_id, site_id, specialite_id,
              heure_debut, heure_fin, nombre_secretaires_requis
            ) VALUES (
              v_current_date, 'medecin', v_medecin.id, v_horaire.site_id, v_medecin.specialite_id,
              v_horaire.heure_debut, v_horaire.heure_fin, 1.2
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

-- Function to generate capacite_effective for next 5 weeks
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
      SELECT id, profile_id, specialites, site_preferentiel_id FROM public.secretaires WHERE actif = true
    LOOP
      FOR v_horaire IN
        SELECT * FROM public.horaires_base_secretaires
        WHERE secretaire_id = v_secretaire.id
          AND jour_semaine = v_jour_semaine
          AND actif = true
      LOOP
        -- Check for absence
        SELECT COUNT(*) INTO v_absence
        FROM public.absences
        WHERE profile_id = v_secretaire.profile_id
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

-- Function to handle absence changes
CREATE OR REPLACE FUNCTION public.handle_absence_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_medecin_id UUID;
  v_secretaire_id UUID;
BEGIN
  -- Check if it's a doctor
  SELECT id INTO v_medecin_id FROM public.medecins WHERE profile_id = NEW.profile_id;
  
  IF v_medecin_id IS NOT NULL THEN
    IF NEW.statut IN ('approuve', 'en_attente') THEN
      -- Remove doctor from besoin_effectif
      DELETE FROM public.besoin_effectif
      WHERE medecin_id = v_medecin_id
        AND date BETWEEN NEW.date_debut AND NEW.date_fin;
    ELSE
      -- Regenerate besoin for this period
      PERFORM public.generate_besoin_effectif();
    END IF;
  END IF;
  
  -- Check if it's a secretary
  SELECT id INTO v_secretaire_id FROM public.secretaires WHERE profile_id = NEW.profile_id;
  
  IF v_secretaire_id IS NOT NULL THEN
    IF NEW.statut IN ('approuve', 'en_attente') THEN
      -- Remove secretary from capacite_effective
      DELETE FROM public.capacite_effective
      WHERE secretaire_id = v_secretaire_id
        AND date BETWEEN NEW.date_debut AND NEW.date_fin;
    ELSE
      -- Regenerate capacite for this period
      PERFORM public.generate_capacite_effective();
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Trigger wrapper functions
CREATE OR REPLACE FUNCTION public.trigger_generate_besoin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.generate_besoin_effectif();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_generate_capacite()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.generate_capacite_effective();
  RETURN NEW;
END;
$$;

-- Create triggers
CREATE TRIGGER on_absence_change
  AFTER INSERT OR UPDATE ON public.absences
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_absence_changes();

CREATE TRIGGER on_medecin_horaire_change
  AFTER INSERT OR UPDATE OR DELETE ON public.horaires_base_medecins
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_generate_besoin();

CREATE TRIGGER on_secretaire_horaire_change
  AFTER INSERT OR UPDATE OR DELETE ON public.horaires_base_secretaires
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_generate_capacite();

-- Update timestamps trigger
CREATE TRIGGER update_besoin_effectif_updated_at
  BEFORE UPDATE ON public.besoin_effectif
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_capacite_effective_updated_at
  BEFORE UPDATE ON public.capacite_effective
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Initial generation
SELECT public.generate_besoin_effectif();
SELECT public.generate_capacite_effective();