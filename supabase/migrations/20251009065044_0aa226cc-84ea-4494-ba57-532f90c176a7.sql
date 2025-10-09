-- Correction des warnings de sécurité: ajout de search_path aux fonctions

CREATE OR REPLACE FUNCTION public.date_ranges_overlap(
  p_start1 DATE,
  p_end1 DATE,
  p_start2 DATE,
  p_end2 DATE
) RETURNS BOOLEAN 
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start1 DATE;
  v_end1 DATE;
  v_start2 DATE;
  v_end2 DATE;
BEGIN
  v_start1 := COALESCE(p_start1, CURRENT_DATE);
  v_end1 := COALESCE(p_end1, CURRENT_DATE + INTERVAL '52 weeks');
  v_start2 := COALESCE(p_start2, CURRENT_DATE);
  v_end2 := COALESCE(p_end2, CURRENT_DATE + INTERVAL '52 weeks');
  
  RETURN (v_start1, v_end1) OVERLAPS (v_start2, v_end2);
END;
$$;

CREATE OR REPLACE FUNCTION public.check_horaire_overlap(
  p_table_name TEXT,
  p_person_id UUID,
  p_jour_semaine INTEGER,
  p_heure_debut TIME,
  p_heure_fin TIME,
  p_alternance_type type_alternance,
  p_alternance_semaine_ref DATE,
  p_date_debut DATE,
  p_date_fin DATE,
  p_horaire_id UUID DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conflict RECORD;
  v_test_date DATE;
  v_has_time_overlap BOOLEAN;
  v_has_date_overlap BOOLEAN;
  v_has_alternance_overlap BOOLEAN;
  v_start_date DATE;
  v_end_date DATE;
BEGIN
  v_start_date := COALESCE(p_date_debut, CURRENT_DATE);
  v_end_date := COALESCE(p_date_fin, CURRENT_DATE + INTERVAL '52 weeks');

  FOR v_conflict IN 
    EXECUTE format('
      SELECT 
        id, 
        heure_debut, 
        heure_fin, 
        alternance_type, 
        alternance_semaine_reference,
        date_debut,
        date_fin
      FROM public.%I
      WHERE %s = $1
        AND jour_semaine = $2
        AND id != COALESCE($3, ''00000000-0000-0000-0000-000000000000''::uuid)
        AND actif = true
    ', p_table_name, 
       CASE WHEN p_table_name = 'horaires_base_medecins' THEN 'medecin_id' ELSE 'secretaire_id' END)
    USING p_person_id, p_jour_semaine, p_horaire_id
  LOOP
    v_has_time_overlap := (p_heure_debut, p_heure_fin) OVERLAPS (v_conflict.heure_debut, v_conflict.heure_fin);
    
    IF NOT v_has_time_overlap THEN
      CONTINUE;
    END IF;
    
    v_has_date_overlap := public.date_ranges_overlap(
      p_date_debut, p_date_fin,
      v_conflict.date_debut, v_conflict.date_fin
    );
    
    IF NOT v_has_date_overlap THEN
      CONTINUE;
    END IF;
    
    v_has_alternance_overlap := FALSE;
    
    FOR v_test_date IN 
      SELECT generate_series(
        GREATEST(
          COALESCE(p_date_debut, CURRENT_DATE),
          COALESCE(v_conflict.date_debut, CURRENT_DATE)
        ),
        LEAST(
          COALESCE(p_date_fin, CURRENT_DATE + INTERVAL '52 weeks'),
          COALESCE(v_conflict.date_fin, CURRENT_DATE + INTERVAL '52 weeks')
        ),
        '7 days'::interval
      )::DATE AS test_date
      WHERE EXTRACT(ISODOW FROM generate_series) = p_jour_semaine
    LOOP
      IF public.should_doctor_work(p_alternance_type, p_alternance_semaine_ref, v_test_date) AND
         public.should_doctor_work(v_conflict.alternance_type, v_conflict.alternance_semaine_reference, v_test_date) THEN
        v_has_alternance_overlap := TRUE;
        EXIT;
      END IF;
    END LOOP;
    
    IF v_has_alternance_overlap THEN
      RETURN FALSE;
    END IF;
  END LOOP;
  
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_horaire_medecin_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.check_horaire_overlap(
    'horaires_base_medecins',
    NEW.medecin_id,
    NEW.jour_semaine,
    NEW.heure_debut,
    NEW.heure_fin,
    NEW.alternance_type,
    NEW.alternance_semaine_reference,
    NEW.date_debut,
    NEW.date_fin,
    NEW.id
  ) THEN
    RAISE EXCEPTION 'Chevauchement détecté : un horaire avec les mêmes alternances et période existe déjà pour ce jour';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_horaire_secretaire_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.check_horaire_overlap(
    'horaires_base_secretaires',
    NEW.secretaire_id,
    NEW.jour_semaine,
    NEW.heure_debut,
    NEW.heure_fin,
    'hebdomadaire'::type_alternance,
    CURRENT_DATE,
    NEW.date_debut,
    NEW.date_fin,
    NEW.id
  ) THEN
    RAISE EXCEPTION 'Chevauchement détecté : un horaire existe déjà pour ce jour et cette période';
  END IF;
  RETURN NEW;
END;
$$;