-- Create enum for person type
CREATE TYPE type_personne AS ENUM ('medecin', 'secretaire');

-- Create enum for schedule status
CREATE TYPE statut_horaire AS ENUM ('disponible', 'absent', 'bloc_operatoire');

-- Create enum for schedule source
CREATE TYPE source_horaire AS ENUM ('horaire_base', 'bloc_operatoire', 'absence');

-- Create the centralized schedule table
CREATE TABLE public.horaires_effectifs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE NOT NULL,
  personne_id UUID NOT NULL,
  type_personne type_personne NOT NULL,
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  heure_debut TIME NOT NULL,
  heure_fin TIME NOT NULL,
  specialite_id UUID REFERENCES public.specialites(id) ON DELETE SET NULL,
  specialites UUID[] DEFAULT '{}',
  statut statut_horaire NOT NULL DEFAULT 'disponible',
  source source_horaire NOT NULL DEFAULT 'horaire_base',
  reference_id UUID,
  actif BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX idx_horaires_effectifs_date_site_type ON public.horaires_effectifs(date, site_id, type_personne);
CREATE INDEX idx_horaires_effectifs_personne ON public.horaires_effectifs(personne_id);
CREATE INDEX idx_horaires_effectifs_specialite ON public.horaires_effectifs(specialite_id);
CREATE INDEX idx_horaires_effectifs_date ON public.horaires_effectifs(date);
CREATE INDEX idx_horaires_effectifs_statut ON public.horaires_effectifs(statut);

-- Create unique constraint to avoid duplicates
CREATE UNIQUE INDEX idx_horaires_effectifs_unique ON public.horaires_effectifs(date, personne_id, type_personne, heure_debut, heure_fin) WHERE actif = true;

-- Enable RLS
ALTER TABLE public.horaires_effectifs ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Admins can manage horaires effectifs"
ON public.horaires_effectifs
FOR ALL
USING (is_admin());

CREATE POLICY "Users can view all horaires effectifs"
ON public.horaires_effectifs
FOR SELECT
USING (true);

-- Function to regenerate schedules for a person for the next 5 weeks
CREATE OR REPLACE FUNCTION public.regenerate_horaires_for_person(
  p_personne_id UUID,
  p_type_personne type_personne
)
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
  v_horaire RECORD;
  v_absence RECORD;
  v_new_statut statut_horaire;
BEGIN
  -- Delete existing schedules for this person for the next 5 weeks
  DELETE FROM public.horaires_effectifs
  WHERE personne_id = p_personne_id
    AND type_personne = p_type_personne
    AND date BETWEEN v_start_date AND v_end_date
    AND source = 'horaire_base';

  -- Generate schedules based on base hours
  v_current_date := v_start_date;
  
  WHILE v_current_date <= v_end_date LOOP
    v_jour_semaine := EXTRACT(ISODOW FROM v_current_date); -- 1=Monday, 7=Sunday
    
    IF p_type_personne = 'medecin' THEN
      -- Generate for doctors
      FOR v_horaire IN
        SELECT hbm.*, m.specialite_id
        FROM public.horaires_base_medecins hbm
        JOIN public.medecins m ON m.id = hbm.medecin_id
        WHERE hbm.medecin_id = p_personne_id
          AND hbm.jour_semaine = v_jour_semaine
          AND hbm.actif = true
          AND m.actif = true
      LOOP
        -- Check if there's an absence for this date
        v_new_statut := 'disponible';
        
        FOR v_absence IN
          SELECT *
          FROM public.absences
          WHERE profile_id = (SELECT profile_id FROM public.medecins WHERE id = p_personne_id)
            AND v_current_date BETWEEN date_debut AND date_fin
            AND statut IN ('approuvee', 'en_attente')
        LOOP
          v_new_statut := 'absent';
        END LOOP;
        
        -- Insert the schedule
        INSERT INTO public.horaires_effectifs (
          date, personne_id, type_personne, site_id,
          heure_debut, heure_fin, specialite_id,
          statut, source, reference_id
        ) VALUES (
          v_current_date, p_personne_id, p_type_personne, v_horaire.site_id,
          v_horaire.heure_debut, v_horaire.heure_fin, v_horaire.specialite_id,
          v_new_statut, 'horaire_base', v_horaire.id
        )
        ON CONFLICT (date, personne_id, type_personne, heure_debut, heure_fin) 
        WHERE actif = true
        DO UPDATE SET
          statut = EXCLUDED.statut,
          updated_at = now();
      END LOOP;
      
    ELSE -- secretaire
      -- Generate for secretaries
      FOR v_horaire IN
        SELECT hbs.*, s.specialites, s.site_preferentiel_id
        FROM public.horaires_base_secretaires hbs
        JOIN public.secretaires s ON s.id = hbs.secretaire_id
        WHERE hbs.secretaire_id = p_personne_id
          AND hbs.jour_semaine = v_jour_semaine
          AND hbs.actif = true
          AND s.actif = true
      LOOP
        -- Check if there's an absence for this date
        v_new_statut := 'disponible';
        
        FOR v_absence IN
          SELECT *
          FROM public.absences
          WHERE profile_id = (SELECT profile_id FROM public.secretaires WHERE id = p_personne_id)
            AND v_current_date BETWEEN date_debut AND date_fin
            AND statut IN ('approuvee', 'en_attente')
        LOOP
          v_new_statut := 'absent';
        END LOOP;
        
        -- Insert the schedule (use preferential site if available)
        INSERT INTO public.horaires_effectifs (
          date, personne_id, type_personne, site_id,
          heure_debut, heure_fin, specialites,
          statut, source, reference_id
        ) VALUES (
          v_current_date, p_personne_id, p_type_personne, 
          COALESCE(v_horaire.site_preferentiel_id, (SELECT id FROM public.sites WHERE actif = true LIMIT 1)),
          v_horaire.heure_debut, v_horaire.heure_fin, v_horaire.specialites,
          v_new_statut, 'horaire_base', v_horaire.id
        )
        ON CONFLICT (date, personne_id, type_personne, heure_debut, heure_fin) 
        WHERE actif = true
        DO UPDATE SET
          statut = EXCLUDED.statut,
          updated_at = now();
      END LOOP;
    END IF;
    
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
END;
$$;

-- Function to apply absences to schedules
CREATE OR REPLACE FUNCTION public.apply_absences_to_horaires()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type_personne type_personne;
  v_personne_id UUID;
BEGIN
  -- Determine person type and ID
  IF EXISTS (SELECT 1 FROM public.medecins WHERE profile_id = NEW.profile_id) THEN
    v_type_personne := 'medecin';
    SELECT id INTO v_personne_id FROM public.medecins WHERE profile_id = NEW.profile_id;
  ELSIF EXISTS (SELECT 1 FROM public.secretaires WHERE profile_id = NEW.profile_id) THEN
    v_type_personne := 'secretaire';
    SELECT id INTO v_personne_id FROM public.secretaires WHERE profile_id = NEW.profile_id;
  ELSE
    RETURN NEW;
  END IF;

  -- Mark schedules as absent
  IF NEW.statut IN ('approuvee', 'en_attente') THEN
    UPDATE public.horaires_effectifs
    SET statut = 'absent',
        updated_at = now()
    WHERE personne_id = v_personne_id
      AND type_personne = v_type_personne
      AND date BETWEEN NEW.date_debut AND NEW.date_fin
      AND source = 'horaire_base';
  ELSE
    -- If absence is rejected or cancelled, restore to disponible
    UPDATE public.horaires_effectifs
    SET statut = 'disponible',
        updated_at = now()
    WHERE personne_id = v_personne_id
      AND type_personne = v_type_personne
      AND date BETWEEN NEW.date_debut AND NEW.date_fin
      AND source = 'horaire_base';
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger on absences
CREATE TRIGGER trigger_apply_absences
AFTER INSERT OR UPDATE ON public.absences
FOR EACH ROW
EXECUTE FUNCTION public.apply_absences_to_horaires();

-- Trigger on horaires_base_medecins changes
CREATE OR REPLACE FUNCTION public.trigger_regenerate_medecin_horaires()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.regenerate_horaires_for_person(
    COALESCE(NEW.medecin_id, OLD.medecin_id),
    'medecin'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_horaires_base_medecins_change
AFTER INSERT OR UPDATE OR DELETE ON public.horaires_base_medecins
FOR EACH ROW
EXECUTE FUNCTION public.trigger_regenerate_medecin_horaires();

-- Trigger on horaires_base_secretaires changes
CREATE OR REPLACE FUNCTION public.trigger_regenerate_secretaire_horaires()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.regenerate_horaires_for_person(
    COALESCE(NEW.secretaire_id, OLD.secretaire_id),
    'secretaire'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_horaires_base_secretaires_change
AFTER INSERT OR UPDATE OR DELETE ON public.horaires_base_secretaires
FOR EACH ROW
EXECUTE FUNCTION public.trigger_regenerate_secretaire_horaires();

-- Trigger on bloc_operatoire_besoins
CREATE OR REPLACE FUNCTION public.sync_bloc_operatoire_to_horaires()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND NEW.actif = false) THEN
    -- Remove the operating room entry
    DELETE FROM public.horaires_effectifs
    WHERE reference_id = OLD.id
      AND source = 'bloc_operatoire';
  ELSIF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.actif = true) THEN
    -- Insert or update the operating room entry
    INSERT INTO public.horaires_effectifs (
      date, personne_id, type_personne, site_id,
      heure_debut, heure_fin, specialite_id,
      statut, source, reference_id
    ) VALUES (
      NEW.date, '00000000-0000-0000-0000-000000000000'::UUID, 'secretaire', 
      (SELECT id FROM public.sites WHERE actif = true LIMIT 1),
      NEW.heure_debut, NEW.heure_fin, NEW.specialite_id,
      'bloc_operatoire', 'bloc_operatoire', NEW.id
    )
    ON CONFLICT (date, personne_id, type_personne, heure_debut, heure_fin) 
    WHERE actif = true
    DO UPDATE SET
      heure_debut = EXCLUDED.heure_debut,
      heure_fin = EXCLUDED.heure_fin,
      specialite_id = EXCLUDED.specialite_id,
      updated_at = now();
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_bloc_operatoire_sync
AFTER INSERT OR UPDATE OR DELETE ON public.bloc_operatoire_besoins
FOR EACH ROW
EXECUTE FUNCTION public.sync_bloc_operatoire_to_horaires();

-- Function to generate week +5 for all people
CREATE OR REPLACE FUNCTION public.generate_week_plus_5()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_date DATE := CURRENT_DATE + INTERVAL '5 weeks';
  v_start_of_week DATE := date_trunc('week', v_target_date)::DATE;
  v_end_of_week DATE := v_start_of_week + INTERVAL '6 days';
  v_current_date DATE;
  v_jour_semaine INTEGER;
  v_person RECORD;
  v_horaire RECORD;
  v_absence RECORD;
  v_new_statut statut_horaire;
BEGIN
  -- Clean old data (older than 8 weeks)
  DELETE FROM public.horaires_effectifs
  WHERE date < CURRENT_DATE - INTERVAL '8 weeks';

  v_current_date := v_start_of_week;
  
  WHILE v_current_date <= v_end_of_week LOOP
    v_jour_semaine := EXTRACT(ISODOW FROM v_current_date);
    
    -- Generate for all active doctors
    FOR v_person IN
      SELECT id FROM public.medecins WHERE actif = true
    LOOP
      FOR v_horaire IN
        SELECT hbm.*, m.specialite_id
        FROM public.horaires_base_medecins hbm
        JOIN public.medecins m ON m.id = hbm.medecin_id
        WHERE hbm.medecin_id = v_person.id
          AND hbm.jour_semaine = v_jour_semaine
          AND hbm.actif = true
      LOOP
        v_new_statut := 'disponible';
        
        FOR v_absence IN
          SELECT *
          FROM public.absences
          WHERE profile_id = (SELECT profile_id FROM public.medecins WHERE id = v_person.id)
            AND v_current_date BETWEEN date_debut AND date_fin
            AND statut IN ('approuvee', 'en_attente')
        LOOP
          v_new_statut := 'absent';
        END LOOP;
        
        INSERT INTO public.horaires_effectifs (
          date, personne_id, type_personne, site_id,
          heure_debut, heure_fin, specialite_id,
          statut, source, reference_id
        ) VALUES (
          v_current_date, v_person.id, 'medecin', v_horaire.site_id,
          v_horaire.heure_debut, v_horaire.heure_fin, v_horaire.specialite_id,
          v_new_statut, 'horaire_base', v_horaire.id
        )
        ON CONFLICT (date, personne_id, type_personne, heure_debut, heure_fin) 
        WHERE actif = true
        DO NOTHING;
      END LOOP;
    END LOOP;
    
    -- Generate for all active secretaries
    FOR v_person IN
      SELECT id FROM public.secretaires WHERE actif = true
    LOOP
      FOR v_horaire IN
        SELECT hbs.*, s.specialites, s.site_preferentiel_id
        FROM public.horaires_base_secretaires hbs
        JOIN public.secretaires s ON s.id = hbs.secretaire_id
        WHERE hbs.secretaire_id = v_person.id
          AND hbs.jour_semaine = v_jour_semaine
          AND hbs.actif = true
      LOOP
        v_new_statut := 'disponible';
        
        FOR v_absence IN
          SELECT *
          FROM public.absences
          WHERE profile_id = (SELECT profile_id FROM public.secretaires WHERE id = v_person.id)
            AND v_current_date BETWEEN date_debut AND date_fin
            AND statut IN ('approuvee', 'en_attente')
        LOOP
          v_new_statut := 'absent';
        END LOOP;
        
        INSERT INTO public.horaires_effectifs (
          date, personne_id, type_personne, site_id,
          heure_debut, heure_fin, specialites,
          statut, source, reference_id
        ) VALUES (
          v_current_date, v_person.id, 'secretaire',
          COALESCE(v_horaire.site_preferentiel_id, (SELECT id FROM public.sites WHERE actif = true LIMIT 1)),
          v_horaire.heure_debut, v_horaire.heure_fin, v_horaire.specialites,
          v_new_statut, 'horaire_base', v_horaire.id
        )
        ON CONFLICT (date, personne_id, type_personne, heure_debut, heure_fin) 
        WHERE actif = true
        DO NOTHING;
      END LOOP;
    END LOOP;
    
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
END;
$$;

-- Trigger to auto-generate schedules when a new doctor is created
CREATE OR REPLACE FUNCTION public.trigger_new_medecin_horaires()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Generate schedules for the next 5 weeks
  PERFORM public.regenerate_horaires_for_person(NEW.id, 'medecin');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_new_medecin
AFTER INSERT ON public.medecins
FOR EACH ROW
EXECUTE FUNCTION public.trigger_new_medecin_horaires();

-- Trigger to auto-generate schedules when a new secretary is created
CREATE OR REPLACE FUNCTION public.trigger_new_secretaire_horaires()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Generate schedules for the next 5 weeks
  PERFORM public.regenerate_horaires_for_person(NEW.id, 'secretaire');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_new_secretaire
AFTER INSERT ON public.secretaires
FOR EACH ROW
EXECUTE FUNCTION public.trigger_new_secretaire_horaires();

-- Add trigger for updated_at
CREATE TRIGGER update_horaires_effectifs_updated_at
BEFORE UPDATE ON public.horaires_effectifs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();