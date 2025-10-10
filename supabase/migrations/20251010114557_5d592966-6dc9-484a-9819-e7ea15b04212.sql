-- Create types_intervention table
CREATE TABLE public.types_intervention (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nom TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  actif BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Insert the 5 intervention types
INSERT INTO public.types_intervention (nom, code) VALUES
  ('IVT', 'IVT'),
  ('Sédation-cataracte', 'SEDATION_CATARACTE'),
  ('Petite chirurgie', 'PETITE_CHIRURGIE'),
  ('Oculoplastie', 'OCULOPLASTIE'),
  ('Dermatologie', 'DERMATOLOGIE');

-- Add type_intervention_id to horaires_base_medecins
ALTER TABLE public.horaires_base_medecins
ADD COLUMN type_intervention_id UUID REFERENCES public.types_intervention(id);

-- Add type_intervention_id to besoin_effectif
ALTER TABLE public.besoin_effectif
ADD COLUMN type_intervention_id UUID REFERENCES public.types_intervention(id);

-- Add type_intervention_id to bloc_operatoire_besoins (NOT NULL because it's always required for bloc)
ALTER TABLE public.bloc_operatoire_besoins
ADD COLUMN type_intervention_id UUID REFERENCES public.types_intervention(id);

-- Enable RLS on types_intervention
ALTER TABLE public.types_intervention ENABLE ROW LEVEL SECURITY;

-- RLS policies for types_intervention
CREATE POLICY "Users with planning or admin can view types_intervention"
  ON public.types_intervention FOR SELECT
  USING (public.has_planning_or_admin_access());

CREATE POLICY "Users with planning access can manage types_intervention"
  ON public.types_intervention FOR ALL
  USING (public.has_planning_access())
  WITH CHECK (public.has_planning_access());

-- Update handle_horaire_medecin_insert_logic to propagate type_intervention_id
CREATE OR REPLACE FUNCTION public.handle_horaire_medecin_insert_logic(p_horaire record)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_current_date DATE;
  v_start_date DATE;
  v_end_date DATE;
  v_should_work BOOLEAN;
  v_abs_full INTEGER;
  v_has_partial_absence BOOLEAN;
  v_is_holiday BOOLEAN;
BEGIN
  v_start_date := COALESCE(p_horaire.date_debut, CURRENT_DATE);
  v_end_date := COALESCE(p_horaire.date_fin, CURRENT_DATE + INTERVAL '52 weeks');
  
  IF v_start_date < CURRENT_DATE THEN
    v_start_date := CURRENT_DATE;
  END IF;
  
  v_current_date := v_start_date;
  
  WHILE EXTRACT(ISODOW FROM v_current_date) != p_horaire.jour_semaine LOOP
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
  
  WHILE v_current_date <= v_end_date LOOP
    SELECT EXISTS(
      SELECT 1 FROM public.jours_feries
      WHERE date = v_current_date AND actif = true
    ) INTO v_is_holiday;
    
    v_should_work := public.should_doctor_work(
      p_horaire.alternance_type,
      p_horaire.alternance_semaine_modulo,
      v_current_date
    );
    
    IF v_should_work AND NOT v_is_holiday THEN
      SELECT COUNT(*) INTO v_abs_full
      FROM public.absences
      WHERE medecin_id = p_horaire.medecin_id
        AND v_current_date BETWEEN date_debut AND date_fin
        AND statut IN ('approuve', 'en_attente')
        AND heure_debut IS NULL AND heure_fin IS NULL;
      
      IF v_abs_full = 0 THEN
        SELECT EXISTS(
          SELECT 1 FROM public.absences
          WHERE medecin_id = p_horaire.medecin_id
            AND v_current_date BETWEEN date_debut AND date_fin
            AND statut IN ('approuve', 'en_attente')
            AND heure_debut IS NOT NULL AND heure_fin IS NOT NULL
        ) INTO v_has_partial_absence;

        IF NOT v_has_partial_absence THEN
          INSERT INTO public.besoin_effectif (
            date, type, medecin_id, site_id, demi_journee, type_intervention_id
          ) VALUES (
            v_current_date, 'medecin', p_horaire.medecin_id, p_horaire.site_id, 
            p_horaire.demi_journee, p_horaire.type_intervention_id
          );
        END IF;
      END IF;
    END IF;
    
    v_current_date := v_current_date + INTERVAL '7 days';
  END LOOP;
END;
$function$;

-- Update create_besoin_from_bloc to propagate type_intervention_id
CREATE OR REPLACE FUNCTION public.create_besoin_from_bloc(p_bloc_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_bloc RECORD;
  v_bloc_site_id UUID;
BEGIN
  SELECT id INTO v_bloc_site_id FROM public.sites WHERE nom = 'Clinique La Vallée - Bloc opératoire' LIMIT 1;

  SELECT * INTO v_bloc
  FROM public.bloc_operatoire_besoins
  WHERE id = p_bloc_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  INSERT INTO public.besoin_effectif (
    date,
    type,
    bloc_operatoire_besoin_id,
    site_id,
    demi_journee,
    type_intervention_id
  )
  VALUES (
    v_bloc.date,
    'bloc_operatoire',
    v_bloc.id,
    v_bloc_site_id,
    'toute_journee'::demi_journee,
    v_bloc.type_intervention_id
  );
END;
$function$;

-- Update recreate_doctor_besoin to propagate type_intervention_id
CREATE OR REPLACE FUNCTION public.recreate_doctor_besoin(p_medecin_id uuid, p_date_debut date, p_date_fin date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_current_date date;
  v_jour_semaine integer;
  v_medecin RECORD;
  v_horaire RECORD;
  v_abs_full integer;
  v_should_work boolean;
  v_max_date date;
  v_is_holiday boolean;
BEGIN
  SELECT COALESCE(MAX(date), (CURRENT_DATE + INTERVAL '52 weeks')::date) 
  INTO v_max_date 
  FROM public.besoin_effectif;
  
  p_date_fin := v_max_date;
  
  SELECT id
  INTO v_medecin
  FROM public.medecins 
  WHERE id = p_medecin_id AND actif = true;
  
  IF NOT FOUND THEN
    RETURN;
  END IF;

  DELETE FROM public.besoin_effectif
  WHERE medecin_id = p_medecin_id 
    AND date >= p_date_debut 
    AND date <= p_date_fin;

  v_current_date := p_date_debut;
  
  WHILE v_current_date <= p_date_fin LOOP
    v_jour_semaine := EXTRACT(ISODOW FROM v_current_date);
    
    SELECT EXISTS(
      SELECT 1 FROM public.jours_feries
      WHERE date = v_current_date AND actif = true
    ) INTO v_is_holiday;
    
    IF NOT v_is_holiday THEN
      FOR v_horaire IN
        SELECT * FROM public.horaires_base_medecins
        WHERE medecin_id = p_medecin_id
          AND jour_semaine = v_jour_semaine
          AND actif = true
      LOOP
        v_should_work := public.should_doctor_work(
          v_horaire.alternance_type,
          v_horaire.alternance_semaine_modulo,
          v_current_date
        );
        
        IF v_should_work THEN
          SELECT COUNT(*) INTO v_abs_full
          FROM public.absences
          WHERE medecin_id = p_medecin_id
            AND v_current_date BETWEEN date_debut AND date_fin
            AND statut IN ('approuve', 'en_attente')
            AND heure_debut IS NULL AND heure_fin IS NULL;
          
          IF v_abs_full = 0 THEN
            INSERT INTO public.besoin_effectif (
              date, type, medecin_id, site_id, demi_journee, type_intervention_id
            ) VALUES (
              v_current_date, 'medecin', v_medecin.id, v_horaire.site_id, 
              v_horaire.demi_journee, v_horaire.type_intervention_id
            )
            ON CONFLICT DO NOTHING;
          END IF;
        END IF;
      END LOOP;
    END IF;
    
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
END;
$function$;