-- 1. Ajouter les colonnes date_debut et date_fin
ALTER TABLE public.horaires_base_medecins 
  ADD COLUMN IF NOT EXISTS date_debut DATE DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS date_fin DATE DEFAULT NULL;

ALTER TABLE public.horaires_base_secretaires 
  ADD COLUMN IF NOT EXISTS date_debut DATE DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS date_fin DATE DEFAULT NULL;

-- 2. Fonction pour vérifier si deux plages de dates se chevauchent
-- NULL = 52 semaines par défaut
CREATE OR REPLACE FUNCTION public.date_ranges_overlap(
  p_start1 DATE,
  p_end1 DATE,
  p_start2 DATE,
  p_end2 DATE
) RETURNS BOOLEAN AS $$
DECLARE
  v_start1 DATE;
  v_end1 DATE;
  v_start2 DATE;
  v_end2 DATE;
BEGIN
  -- Gérer les valeurs NULL (= 52 semaines)
  v_start1 := COALESCE(p_start1, CURRENT_DATE);
  v_end1 := COALESCE(p_end1, CURRENT_DATE + INTERVAL '52 weeks');
  v_start2 := COALESCE(p_start2, CURRENT_DATE);
  v_end2 := COALESCE(p_end2, CURRENT_DATE + INTERVAL '52 weeks');
  
  -- Vérifier le chevauchement
  RETURN (v_start1, v_end1) OVERLAPS (v_start2, v_end2);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 3. Fonction pour vérifier les chevauchements d'horaires
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
) RETURNS BOOLEAN AS $$
DECLARE
  v_conflict RECORD;
  v_test_date DATE;
  v_has_time_overlap BOOLEAN;
  v_has_date_overlap BOOLEAN;
  v_has_alternance_overlap BOOLEAN;
  v_start_date DATE;
  v_end_date DATE;
BEGIN
  -- Déterminer la plage de dates à tester
  v_start_date := COALESCE(p_date_debut, CURRENT_DATE);
  v_end_date := COALESCE(p_date_fin, CURRENT_DATE + INTERVAL '52 weeks');

  -- Récupérer tous les horaires existants pour ce jour
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
    -- Vérifier le chevauchement d'horaires
    v_has_time_overlap := (p_heure_debut, p_heure_fin) OVERLAPS (v_conflict.heure_debut, v_conflict.heure_fin);
    
    IF NOT v_has_time_overlap THEN
      CONTINUE;
    END IF;
    
    -- Vérifier le chevauchement de plages de dates
    v_has_date_overlap := public.date_ranges_overlap(
      p_date_debut, p_date_fin,
      v_conflict.date_debut, v_conflict.date_fin
    );
    
    IF NOT v_has_date_overlap THEN
      CONTINUE;
    END IF;
    
    -- Vérifier le chevauchement d'alternances sur la période commune
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
      -- Vérifier si les deux horaires tombent le même jour
      IF public.should_doctor_work(p_alternance_type, p_alternance_semaine_ref, v_test_date) AND
         public.should_doctor_work(v_conflict.alternance_type, v_conflict.alternance_semaine_reference, v_test_date) THEN
        v_has_alternance_overlap := TRUE;
        EXIT;
      END IF;
    END LOOP;
    
    -- Si tous les chevauchements sont confirmés, retourner FALSE
    IF v_has_alternance_overlap THEN
      RETURN FALSE;
    END IF;
  END LOOP;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- 4. Triggers de validation pour médecins
CREATE OR REPLACE FUNCTION public.validate_horaire_medecin_overlap()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS validate_medecin_overlap_before_insert_update ON public.horaires_base_medecins;
CREATE TRIGGER validate_medecin_overlap_before_insert_update
  BEFORE INSERT OR UPDATE ON public.horaires_base_medecins
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_horaire_medecin_overlap();

-- 5. Triggers de validation pour secrétaires
CREATE OR REPLACE FUNCTION public.validate_horaire_secretaire_overlap()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT public.check_horaire_overlap(
    'horaires_base_secretaires',
    NEW.secretaire_id,
    NEW.jour_semaine,
    NEW.heure_debut,
    NEW.heure_fin,
    'hebdomadaire'::type_alternance, -- Les secrétaires n'ont pas d'alternance mais on utilise hebdomadaire
    CURRENT_DATE,
    NEW.date_debut,
    NEW.date_fin,
    NEW.id
  ) THEN
    RAISE EXCEPTION 'Chevauchement détecté : un horaire existe déjà pour ce jour et cette période';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS validate_secretaire_overlap_before_insert_update ON public.horaires_base_secretaires;
CREATE TRIGGER validate_secretaire_overlap_before_insert_update
  BEFORE INSERT OR UPDATE ON public.horaires_base_secretaires
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_horaire_secretaire_overlap();

-- 6. Mise à jour de handle_horaire_medecin_insert
CREATE OR REPLACE FUNCTION public.handle_horaire_medecin_insert()
RETURNS TRIGGER AS $$
DECLARE
  v_current_date DATE;
  v_start_date DATE;
  v_end_date DATE;
  v_semaines_diff INTEGER;
  v_should_work BOOLEAN;
  v_abs_full INTEGER;
  v_abs_start TIME;
  v_abs_end TIME;
  v_seg_start TIME;
  v_seg_end TIME;
BEGIN
  -- Déterminer les dates de début et fin
  v_start_date := COALESCE(NEW.date_debut, CURRENT_DATE);
  v_end_date := COALESCE(NEW.date_fin, CURRENT_DATE + INTERVAL '52 weeks');
  
  -- S'assurer que la date de début n'est pas dans le passé
  IF v_start_date < CURRENT_DATE THEN
    v_start_date := CURRENT_DATE;
  END IF;
  
  v_current_date := v_start_date;
  
  -- Trouver la première occurrence de ce jour de semaine
  WHILE EXTRACT(ISODOW FROM v_current_date) != NEW.jour_semaine LOOP
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
  
  -- Boucle de génération
  WHILE v_current_date <= v_end_date LOOP
    v_semaines_diff := FLOOR((v_current_date - NEW.alternance_semaine_reference) / 7);
    
    v_should_work := CASE NEW.alternance_type
      WHEN 'hebdomadaire' THEN true
      WHEN 'une_sur_deux' THEN (v_semaines_diff % 2 = 0)
      WHEN 'une_sur_trois' THEN (v_semaines_diff % 3 = 0)
      WHEN 'une_sur_quatre' THEN (v_semaines_diff % 4 = 0)
      ELSE true
    END;
    
    IF v_should_work THEN
      SELECT COUNT(*) INTO v_abs_full
      FROM public.absences
      WHERE medecin_id = NEW.medecin_id
        AND v_current_date BETWEEN date_debut AND date_fin
        AND statut IN ('approuve', 'en_attente')
        AND heure_debut IS NULL AND heure_fin IS NULL;
      
      IF v_abs_full = 0 THEN
        SELECT MIN(heure_debut), MAX(heure_fin)
        INTO v_abs_start, v_abs_end
        FROM public.absences
        WHERE medecin_id = NEW.medecin_id
          AND v_current_date BETWEEN date_debut AND date_fin
          AND statut IN ('approuve', 'en_attente')
          AND heure_debut IS NOT NULL AND heure_fin IS NOT NULL;

        IF v_abs_start IS NULL OR v_abs_end IS NULL THEN
          INSERT INTO public.besoin_effectif (
            date, type, medecin_id, site_id,
            heure_debut, heure_fin
          ) VALUES (
            v_current_date, 'medecin', NEW.medecin_id, NEW.site_id,
            NEW.heure_debut, NEW.heure_fin
          )
          ON CONFLICT DO NOTHING;
        ELSE
          v_seg_start := NEW.heure_debut;
          v_seg_end := LEAST(v_abs_start, NEW.heure_fin);
          IF v_seg_start < v_seg_end AND (v_seg_end - v_seg_start) >= INTERVAL '30 minutes' THEN
            INSERT INTO public.besoin_effectif (
              date, type, medecin_id, site_id,
              heure_debut, heure_fin
            ) VALUES (
              v_current_date, 'medecin', NEW.medecin_id, NEW.site_id,
              v_seg_start, v_seg_end
            )
            ON CONFLICT DO NOTHING;
          END IF;

          v_seg_start := GREATEST(v_abs_end, NEW.heure_debut);
          v_seg_end := NEW.heure_fin;
          IF v_seg_start < v_seg_end AND (v_seg_end - v_seg_start) >= INTERVAL '30 minutes' THEN
            INSERT INTO public.besoin_effectif (
              date, type, medecin_id, site_id,
              heure_debut, heure_fin
            ) VALUES (
              v_current_date, 'medecin', NEW.medecin_id, NEW.site_id,
              v_seg_start, v_seg_end
            )
            ON CONFLICT DO NOTHING;
          END IF;
        END IF;
      END IF;
    END IF;
    
    v_current_date := v_current_date + INTERVAL '7 days';
  END LOOP;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 7. Mise à jour de handle_horaire_medecin_update
CREATE OR REPLACE FUNCTION public.handle_horaire_medecin_update()
RETURNS TRIGGER AS $$
DECLARE
  v_current_date DATE;
  v_old_start DATE;
  v_old_end DATE;
  v_new_start DATE;
  v_new_end DATE;
BEGIN
  v_old_start := COALESCE(OLD.date_debut, CURRENT_DATE);
  v_old_end := COALESCE(OLD.date_fin, CURRENT_DATE + INTERVAL '52 weeks');
  v_new_start := COALESCE(NEW.date_debut, CURRENT_DATE);
  v_new_end := COALESCE(NEW.date_fin, CURRENT_DATE + INTERVAL '52 weeks');
  
  -- Ne pas régénérer le passé
  IF v_old_start < CURRENT_DATE THEN
    v_old_start := CURRENT_DATE;
  END IF;
  IF v_new_start < CURRENT_DATE THEN
    v_new_start := CURRENT_DATE;
  END IF;
  
  -- Supprimer les entrées qui ne sont plus dans la nouvelle plage
  IF v_new_start > v_old_start THEN
    DELETE FROM public.besoin_effectif
    WHERE medecin_id = OLD.medecin_id
      AND date >= v_old_start
      AND date < v_new_start
      AND type = 'medecin';
  END IF;
  
  IF v_new_end < v_old_end THEN
    DELETE FROM public.besoin_effectif
    WHERE medecin_id = OLD.medecin_id
      AND date > v_new_end
      AND date <= v_old_end
      AND type = 'medecin';
  END IF;
  
  -- Supprimer toutes les anciennes entrées pour ce jour de semaine dans la nouvelle plage
  v_current_date := v_new_start;
  WHILE EXTRACT(ISODOW FROM v_current_date) != OLD.jour_semaine LOOP
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
  
  WHILE v_current_date <= v_new_end LOOP
    DELETE FROM public.besoin_effectif
    WHERE medecin_id = OLD.medecin_id
      AND date = v_current_date
      AND type = 'medecin';
    v_current_date := v_current_date + INTERVAL '7 days';
  END LOOP;
  
  -- Régénérer avec la nouvelle logique
  PERFORM public.handle_horaire_medecin_insert_logic(NEW);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 8. Mise à jour de handle_horaire_medecin_insert_logic
CREATE OR REPLACE FUNCTION public.handle_horaire_medecin_insert_logic(p_horaire RECORD)
RETURNS VOID AS $$
DECLARE
  v_current_date DATE;
  v_start_date DATE;
  v_end_date DATE;
  v_semaines_diff INTEGER;
  v_should_work BOOLEAN;
  v_abs_full INTEGER;
  v_abs_start TIME;
  v_abs_end TIME;
  v_seg_start TIME;
  v_seg_end TIME;
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
    v_semaines_diff := FLOOR((v_current_date - p_horaire.alternance_semaine_reference) / 7);
    
    v_should_work := CASE p_horaire.alternance_type
      WHEN 'hebdomadaire' THEN true
      WHEN 'une_sur_deux' THEN (v_semaines_diff % 2 = 0)
      WHEN 'une_sur_trois' THEN (v_semaines_diff % 3 = 0)
      WHEN 'une_sur_quatre' THEN (v_semaines_diff % 4 = 0)
      ELSE true
    END;
    
    IF v_should_work THEN
      SELECT COUNT(*) INTO v_abs_full
      FROM public.absences
      WHERE medecin_id = p_horaire.medecin_id
        AND v_current_date BETWEEN date_debut AND date_fin
        AND statut IN ('approuve', 'en_attente')
        AND heure_debut IS NULL AND heure_fin IS NULL;
      
      IF v_abs_full = 0 THEN
        SELECT MIN(heure_debut), MAX(heure_fin)
        INTO v_abs_start, v_abs_end
        FROM public.absences
        WHERE medecin_id = p_horaire.medecin_id
          AND v_current_date BETWEEN date_debut AND date_fin
          AND statut IN ('approuve', 'en_attente')
          AND heure_debut IS NOT NULL AND heure_fin IS NOT NULL;

        IF v_abs_start IS NULL OR v_abs_end IS NULL THEN
          INSERT INTO public.besoin_effectif (
            date, type, medecin_id, site_id,
            heure_debut, heure_fin
          ) VALUES (
            v_current_date, 'medecin', p_horaire.medecin_id, p_horaire.site_id,
            p_horaire.heure_debut, p_horaire.heure_fin
          )
          ON CONFLICT DO NOTHING;
        ELSE
          v_seg_start := p_horaire.heure_debut;
          v_seg_end := LEAST(v_abs_start, p_horaire.heure_fin);
          IF v_seg_start < v_seg_end AND (v_seg_end - v_seg_start) >= INTERVAL '30 minutes' THEN
            INSERT INTO public.besoin_effectif (
              date, type, medecin_id, site_id,
              heure_debut, heure_fin
            ) VALUES (
              v_current_date, 'medecin', p_horaire.medecin_id, p_horaire.site_id,
              v_seg_start, v_seg_end
            )
            ON CONFLICT DO NOTHING;
          END IF;

          v_seg_start := GREATEST(v_abs_end, p_horaire.heure_debut);
          v_seg_end := p_horaire.heure_fin;
          IF v_seg_start < v_seg_end AND (v_seg_end - v_seg_start) >= INTERVAL '30 minutes' THEN
            INSERT INTO public.besoin_effectif (
              date, type, medecin_id, site_id,
              heure_debut, heure_fin
            ) VALUES (
              v_current_date, 'medecin', p_horaire.medecin_id, p_horaire.site_id,
              v_seg_start, v_seg_end
            )
            ON CONFLICT DO NOTHING;
          END IF;
        END IF;
      END IF;
    END IF;
    
    v_current_date := v_current_date + INTERVAL '7 days';
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 9. Mise à jour de handle_horaire_secretaire_insert
CREATE OR REPLACE FUNCTION public.handle_horaire_secretaire_insert()
RETURNS TRIGGER AS $$
DECLARE
  v_current_date DATE;
  v_start_date DATE;
  v_end_date DATE;
  v_abs_full INTEGER;
  v_abs_start TIME;
  v_abs_end TIME;
  v_seg_start TIME;
  v_seg_end TIME;
BEGIN
  v_start_date := COALESCE(NEW.date_debut, CURRENT_DATE);
  v_end_date := COALESCE(NEW.date_fin, CURRENT_DATE + INTERVAL '52 weeks');
  
  IF v_start_date < CURRENT_DATE THEN
    v_start_date := CURRENT_DATE;
  END IF;
  
  v_current_date := v_start_date;
  
  WHILE EXTRACT(ISODOW FROM v_current_date) != NEW.jour_semaine LOOP
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
  
  WHILE v_current_date <= v_end_date LOOP
    SELECT COUNT(*) INTO v_abs_full
    FROM public.absences
    WHERE secretaire_id = NEW.secretaire_id
      AND v_current_date BETWEEN date_debut AND date_fin
      AND statut IN ('approuve', 'en_attente')
      AND heure_debut IS NULL AND heure_fin IS NULL;
    
    IF v_abs_full = 0 THEN
      SELECT MIN(heure_debut), MAX(heure_fin)
      INTO v_abs_start, v_abs_end
      FROM public.absences
      WHERE secretaire_id = NEW.secretaire_id
        AND v_current_date BETWEEN date_debut AND date_fin
        AND statut IN ('approuve', 'en_attente')
        AND heure_debut IS NOT NULL AND heure_fin IS NOT NULL;

      IF v_abs_start IS NULL OR v_abs_end IS NULL THEN
        INSERT INTO public.capacite_effective (
          date, secretaire_id, heure_debut, heure_fin
        ) VALUES (
          v_current_date, NEW.secretaire_id,
          NEW.heure_debut, NEW.heure_fin
        )
        ON CONFLICT DO NOTHING;
      ELSE
        v_seg_start := NEW.heure_debut;
        v_seg_end := LEAST(v_abs_start, NEW.heure_fin);
        IF v_seg_start < v_seg_end AND (v_seg_end - v_seg_start) >= INTERVAL '30 minutes' THEN
          INSERT INTO public.capacite_effective (
            date, secretaire_id, heure_debut, heure_fin
          ) VALUES (
            v_current_date, NEW.secretaire_id,
            v_seg_start, v_seg_end
          )
          ON CONFLICT DO NOTHING;
        END IF;

        v_seg_start := GREATEST(v_abs_end, NEW.heure_debut);
        v_seg_end := NEW.heure_fin;
        IF v_seg_start < v_seg_end AND (v_seg_end - v_seg_start) >= INTERVAL '30 minutes' THEN
          INSERT INTO public.capacite_effective (
            date, secretaire_id, heure_debut, heure_fin
          ) VALUES (
            v_current_date, NEW.secretaire_id,
            v_seg_start, v_seg_end
          )
          ON CONFLICT DO NOTHING;
        END IF;
      END IF;
    END IF;
    
    v_current_date := v_current_date + INTERVAL '7 days';
  END LOOP;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 10. Mise à jour de handle_horaire_secretaire_update
CREATE OR REPLACE FUNCTION public.handle_horaire_secretaire_update()
RETURNS TRIGGER AS $$
DECLARE
  v_current_date DATE;
  v_old_start DATE;
  v_old_end DATE;
  v_new_start DATE;
  v_new_end DATE;
BEGIN
  v_old_start := COALESCE(OLD.date_debut, CURRENT_DATE);
  v_old_end := COALESCE(OLD.date_fin, CURRENT_DATE + INTERVAL '52 weeks');
  v_new_start := COALESCE(NEW.date_debut, CURRENT_DATE);
  v_new_end := COALESCE(NEW.date_fin, CURRENT_DATE + INTERVAL '52 weeks');
  
  IF v_old_start < CURRENT_DATE THEN
    v_old_start := CURRENT_DATE;
  END IF;
  IF v_new_start < CURRENT_DATE THEN
    v_new_start := CURRENT_DATE;
  END IF;
  
  IF v_new_start > v_old_start THEN
    DELETE FROM public.capacite_effective
    WHERE secretaire_id = OLD.secretaire_id
      AND date >= v_old_start
      AND date < v_new_start;
  END IF;
  
  IF v_new_end < v_old_end THEN
    DELETE FROM public.capacite_effective
    WHERE secretaire_id = OLD.secretaire_id
      AND date > v_new_end
      AND date <= v_old_end;
  END IF;
  
  v_current_date := v_new_start;
  WHILE EXTRACT(ISODOW FROM v_current_date) != OLD.jour_semaine LOOP
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
  
  WHILE v_current_date <= v_new_end LOOP
    DELETE FROM public.capacite_effective
    WHERE secretaire_id = OLD.secretaire_id
      AND date = v_current_date;
    v_current_date := v_current_date + INTERVAL '7 days';
  END LOOP;
  
  PERFORM public.handle_horaire_secretaire_insert_logic(NEW);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 11. Mise à jour de handle_horaire_secretaire_insert_logic
CREATE OR REPLACE FUNCTION public.handle_horaire_secretaire_insert_logic(p_horaire RECORD)
RETURNS VOID AS $$
DECLARE
  v_current_date DATE;
  v_start_date DATE;
  v_end_date DATE;
  v_abs_full INTEGER;
  v_abs_start TIME;
  v_abs_end TIME;
  v_seg_start TIME;
  v_seg_end TIME;
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
    SELECT COUNT(*) INTO v_abs_full
    FROM public.absences
    WHERE secretaire_id = p_horaire.secretaire_id
      AND v_current_date BETWEEN date_debut AND date_fin
      AND statut IN ('approuve', 'en_attente')
      AND heure_debut IS NULL AND heure_fin IS NULL;
    
    IF v_abs_full = 0 THEN
      SELECT MIN(heure_debut), MAX(heure_fin)
      INTO v_abs_start, v_abs_end
      FROM public.absences
      WHERE secretaire_id = p_horaire.secretaire_id
        AND v_current_date BETWEEN date_debut AND date_fin
        AND statut IN ('approuve', 'en_attente')
        AND heure_debut IS NOT NULL AND heure_fin IS NOT NULL;

      IF v_abs_start IS NULL OR v_abs_end IS NULL THEN
        INSERT INTO public.capacite_effective (
          date, secretaire_id, heure_debut, heure_fin
        ) VALUES (
          v_current_date, p_horaire.secretaire_id,
          p_horaire.heure_debut, p_horaire.heure_fin
        )
        ON CONFLICT DO NOTHING;
      ELSE
        v_seg_start := p_horaire.heure_debut;
        v_seg_end := LEAST(v_abs_start, p_horaire.heure_fin);
        IF v_seg_start < v_seg_end AND (v_seg_end - v_seg_start) >= INTERVAL '30 minutes' THEN
          INSERT INTO public.capacite_effective (
            date, secretaire_id, heure_debut, heure_fin
          ) VALUES (
            v_current_date, p_horaire.secretaire_id,
            v_seg_start, v_seg_end
          )
          ON CONFLICT DO NOTHING;
        END IF;

        v_seg_start := GREATEST(v_abs_end, p_horaire.heure_debut);
        v_seg_end := p_horaire.heure_fin;
        IF v_seg_start < v_seg_end AND (v_seg_end - v_seg_start) >= INTERVAL '30 minutes' THEN
          INSERT INTO public.capacite_effective (
            date, secretaire_id, heure_debut, heure_fin
          ) VALUES (
            v_current_date, p_horaire.secretaire_id,
            v_seg_start, v_seg_end
          )
          ON CONFLICT DO NOTHING;
        END IF;
      END IF;
    END IF;
    
    v_current_date := v_current_date + INTERVAL '7 days';
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 12. Mise à jour du cron job weekly_planning_maintenance
CREATE OR REPLACE FUNCTION public.weekly_planning_maintenance()
RETURNS VOID AS $$
DECLARE
  v_delete_week_start DATE := CURRENT_DATE - INTERVAL '52 weeks';
  v_delete_week_end DATE := v_delete_week_start + INTERVAL '6 days';
  v_new_week_start DATE := CURRENT_DATE + INTERVAL '52 weeks';
  v_new_week_end DATE := v_new_week_start + INTERVAL '6 days';
  v_current_date DATE;
  v_jour_semaine INTEGER;
  v_medecin RECORD;
  v_horaire RECORD;
  v_secretaire RECORD;
  v_abs_full INTEGER;
  v_abs_start TIME;
  v_abs_end TIME;
  v_semaines_diff INTEGER;
  v_should_work BOOLEAN;
  v_seg_start TIME;
  v_seg_end TIME;
  v_bloc RECORD;
  v_bloc_site_id UUID;
BEGIN
  SELECT id INTO v_bloc_site_id FROM public.sites WHERE nom = 'Clinique La Vallée - Bloc opératoire' LIMIT 1;

  DELETE FROM public.besoin_effectif 
  WHERE date >= v_delete_week_start AND date <= v_delete_week_end;
  
  DELETE FROM public.capacite_effective 
  WHERE date >= v_delete_week_start AND date <= v_delete_week_end;

  v_current_date := v_new_week_start;
  
  WHILE v_current_date <= v_new_week_end LOOP
    v_jour_semaine := EXTRACT(ISODOW FROM v_current_date);
    
    FOR v_medecin IN
      SELECT id FROM public.medecins WHERE actif = true
    LOOP
      FOR v_horaire IN
        SELECT * FROM public.horaires_base_medecins
        WHERE medecin_id = v_medecin.id
          AND jour_semaine = v_jour_semaine
          AND actif = true
          AND (date_debut IS NULL OR date_debut <= v_current_date)
          AND (date_fin IS NULL OR date_fin >= v_current_date)
      LOOP
        v_semaines_diff := FLOOR((v_current_date - v_horaire.alternance_semaine_reference) / 7);
        
        v_should_work := CASE v_horaire.alternance_type
          WHEN 'hebdomadaire' THEN true
          WHEN 'une_sur_deux' THEN (v_semaines_diff % 2 = 0)
          WHEN 'une_sur_trois' THEN (v_semaines_diff % 3 = 0)
          WHEN 'une_sur_quatre' THEN (v_semaines_diff % 4 = 0)
          ELSE true
        END;
        
        IF v_should_work THEN
          SELECT COUNT(*) INTO v_abs_full
          FROM public.absences
          WHERE medecin_id = v_medecin.id
            AND v_current_date BETWEEN date_debut AND date_fin
            AND statut IN ('approuve', 'en_attente')
            AND heure_debut IS NULL AND heure_fin IS NULL;
          
          IF v_abs_full = 0 THEN
            SELECT MIN(heure_debut), MAX(heure_fin)
              INTO v_abs_start, v_abs_end
            FROM public.absences
            WHERE medecin_id = v_medecin.id
              AND v_current_date BETWEEN date_debut AND date_fin
              AND statut IN ('approuve', 'en_attente')
              AND heure_debut IS NOT NULL AND heure_fin IS NOT NULL;

            IF v_abs_start IS NULL OR v_abs_end IS NULL THEN
              INSERT INTO public.besoin_effectif (
                date, type, medecin_id, site_id,
                heure_debut, heure_fin
              ) VALUES (
                v_current_date, 'medecin', v_medecin.id, v_horaire.site_id,
                v_horaire.heure_debut, v_horaire.heure_fin
              )
              ON CONFLICT DO NOTHING;
            ELSE
              v_seg_start := v_horaire.heure_debut;
              v_seg_end := LEAST(v_abs_start, v_horaire.heure_fin);
              IF v_seg_start < v_seg_end THEN
                INSERT INTO public.besoin_effectif (
                  date, type, medecin_id, site_id,
                  heure_debut, heure_fin
                ) VALUES (
                  v_current_date, 'medecin', v_medecin.id, v_horaire.site_id,
                  v_seg_start, v_seg_end
                )
                ON CONFLICT DO NOTHING;
              END IF;

              v_seg_start := GREATEST(v_abs_end, v_horaire.heure_debut);
              v_seg_end := v_horaire.heure_fin;
              IF v_seg_start < v_seg_end THEN
                INSERT INTO public.besoin_effectif (
                  date, type, medecin_id, site_id,
                  heure_debut, heure_fin
                ) VALUES (
                  v_current_date, 'medecin', v_medecin.id, v_horaire.site_id,
                  v_seg_start, v_seg_end
                )
                ON CONFLICT DO NOTHING;
              END IF;
            END IF;
          END IF;
        END IF;
      END LOOP;
    END LOOP;
    
    FOR v_bloc IN
      SELECT * FROM public.bloc_operatoire_besoins
      WHERE date = v_current_date AND actif = true
    LOOP
      INSERT INTO public.besoin_effectif (
        date, type, bloc_operatoire_besoin_id, site_id,
        heure_debut, heure_fin
      ) VALUES (
        v_bloc.date, 'bloc_operatoire', v_bloc.id, v_bloc_site_id,
        v_bloc.heure_debut, v_bloc.heure_fin
      )
      ON CONFLICT DO NOTHING;
    END LOOP;
    
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;

  v_current_date := v_new_week_start;
  
  WHILE v_current_date <= v_new_week_end LOOP
    v_jour_semaine := EXTRACT(ISODOW FROM v_current_date);
    
    FOR v_secretaire IN
      SELECT id FROM public.secretaires WHERE actif = true
    LOOP
      FOR v_horaire IN
        SELECT * FROM public.horaires_base_secretaires
        WHERE secretaire_id = v_secretaire.id
          AND jour_semaine = v_jour_semaine
          AND actif = true
          AND (date_debut IS NULL OR date_debut <= v_current_date)
          AND (date_fin IS NULL OR date_fin >= v_current_date)
      LOOP
        SELECT COUNT(*) INTO v_abs_full
        FROM public.absences
        WHERE secretaire_id = v_secretaire.id
          AND v_current_date BETWEEN date_debut AND date_fin
          AND statut IN ('approuve', 'en_attente')
          AND heure_debut IS NULL AND heure_fin IS NULL;
        
        IF v_abs_full = 0 THEN
          SELECT MIN(heure_debut), MAX(heure_fin)
            INTO v_abs_start, v_abs_end
          FROM public.absences
          WHERE secretaire_id = v_secretaire.id
            AND v_current_date BETWEEN date_debut AND date_fin
            AND statut IN ('approuve', 'en_attente')
            AND heure_debut IS NOT NULL AND heure_fin IS NOT NULL;

          IF v_abs_start IS NULL OR v_abs_end IS NULL THEN
            INSERT INTO public.capacite_effective (
              date, secretaire_id, heure_debut, heure_fin
            ) VALUES (
              v_current_date, v_secretaire.id,
              v_horaire.heure_debut, v_horaire.heure_fin
            )
            ON CONFLICT DO NOTHING;
          ELSE
            v_seg_start := v_horaire.heure_debut;
            v_seg_end := LEAST(v_abs_start, v_horaire.heure_fin);
            IF v_seg_start < v_seg_end THEN
              INSERT INTO public.capacite_effective (
                date, secretaire_id, heure_debut, heure_fin
              ) VALUES (
                v_current_date, v_secretaire.id,
                v_seg_start, v_seg_end
              )
              ON CONFLICT DO NOTHING;
            END IF;

            v_seg_start := GREATEST(v_abs_end, v_horaire.heure_debut);
            v_seg_end := v_horaire.heure_fin;
            IF v_seg_start < v_seg_end THEN
              INSERT INTO public.capacite_effective (
                date, secretaire_id, heure_debut, heure_fin
              ) VALUES (
                v_current_date, v_secretaire.id,
                v_seg_start, v_seg_end
              )
              ON CONFLICT DO NOTHING;
            END IF;
          END IF;
        END IF;
      END LOOP;
    END LOOP;
    
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
  
  RAISE NOTICE 'Weekly planning maintenance completed: deleted week % and generated week %', 
    v_delete_week_start, v_new_week_start;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;