-- 1) Mettre à jour la logique d'insertion des horaires base secrétaires pour
--    (a) démarrer au plus tôt aujourd'hui, (b) sauter les jours déjà occupés,
--    (c) ne pas planter en cas de conflit, (d) conserver la logique jours fériés/absences/alternance
CREATE OR REPLACE FUNCTION public.handle_horaire_secretaire_insert_logic(p_horaire record)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_current_date DATE;
  v_start_date DATE;
  v_end_date DATE;
  v_abs_full INTEGER;
  v_abs_period BOOLEAN;
  v_is_holiday BOOLEAN;
  v_should_work BOOLEAN;
  v_site_id uuid;
  v_semaine_iso INTEGER;
  v_exists BOOLEAN;
BEGIN
  v_start_date := COALESCE(p_horaire.date_debut, CURRENT_DATE);
  v_end_date := COALESCE(p_horaire.date_fin, CURRENT_DATE + INTERVAL '52 weeks');

  IF v_start_date < CURRENT_DATE THEN
    v_start_date := CURRENT_DATE;
  END IF;

  v_current_date := v_start_date;

  -- Aller au prochain jour correspondant au jour_semaine
  WHILE EXTRACT(ISODOW FROM v_current_date) != p_horaire.jour_semaine LOOP
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;

  WHILE v_current_date <= v_end_date LOOP
    -- Jours fériés actifs
    SELECT EXISTS(
      SELECT 1 FROM public.jours_feries
      WHERE date = v_current_date AND actif = true
    ) INTO v_is_holiday;

    v_semaine_iso := EXTRACT(WEEK FROM v_current_date)::integer;

    v_should_work := CASE COALESCE(p_horaire.alternance_type, 'hebdomadaire'::type_alternance)
      WHEN 'hebdomadaire' THEN true
      WHEN 'une_sur_deux' THEN (v_semaine_iso % 2 = COALESCE(p_horaire.alternance_semaine_modulo, 0))
      WHEN 'une_sur_trois' THEN (v_semaine_iso % 3 = COALESCE(p_horaire.alternance_semaine_modulo, 0))
      WHEN 'une_sur_quatre' THEN (v_semaine_iso % 4 = COALESCE(p_horaire.alternance_semaine_modulo, 0))
      WHEN 'trois_sur_quatre' THEN (v_semaine_iso % 4 != COALESCE(p_horaire.alternance_semaine_modulo, 0))
      ELSE true
    END;

    IF v_should_work AND NOT v_is_holiday THEN
      -- Absence journée complète
      SELECT COUNT(*) INTO v_abs_full
      FROM public.absences
      WHERE secretaire_id = p_horaire.secretaire_id
        AND v_current_date BETWEEN date_debut AND date_fin
        AND statut IN ('approuve', 'en_attente')
        AND demi_journee = 'toute_journee';

      IF v_abs_full = 0 THEN
        -- Absence sur la période spécifique
        SELECT EXISTS(
          SELECT 1 FROM public.absences
          WHERE secretaire_id = p_horaire.secretaire_id
            AND v_current_date BETWEEN date_debut AND date_fin
            AND statut IN ('approuve', 'en_attente')
            AND demi_journee = p_horaire.demi_journee
        ) INTO v_abs_period;

        IF NOT v_abs_period THEN
          v_site_id := COALESCE(p_horaire.site_id, '00000000-0000-0000-0000-000000000001'::uuid);

          IF p_horaire.demi_journee = 'toute_journee' THEN
            -- Matin: sauter si déjà présent
            SELECT EXISTS(
              SELECT 1 FROM public.capacite_effective
              WHERE date = v_current_date
                AND secretaire_id = p_horaire.secretaire_id
                AND demi_journee = 'matin'::demi_journee
            ) INTO v_exists;

            IF NOT v_exists THEN
              INSERT INTO public.capacite_effective (
                date, secretaire_id, demi_journee, site_id, horaire_base_secretaire_id
              ) VALUES (
                v_current_date, p_horaire.secretaire_id, 'matin'::demi_journee, v_site_id, p_horaire.id
              ) ON CONFLICT DO NOTHING;
            END IF;

            -- Après-midi: sauter si déjà présent
            SELECT EXISTS(
              SELECT 1 FROM public.capacite_effective
              WHERE date = v_current_date
                AND secretaire_id = p_horaire.secretaire_id
                AND demi_journee = 'apres_midi'::demi_journee
            ) INTO v_exists;

            IF NOT v_exists THEN
              INSERT INTO public.capacite_effective (
                date, secretaire_id, demi_journee, site_id, horaire_base_secretaire_id
              ) VALUES (
                v_current_date, p_horaire.secretaire_id, 'apres_midi'::demi_journee, v_site_id, p_horaire.id
              ) ON CONFLICT DO NOTHING;
            END IF;
          ELSE
            -- Période unique
            SELECT EXISTS(
              SELECT 1 FROM public.capacite_effective
              WHERE date = v_current_date
                AND secretaire_id = p_horaire.secretaire_id
                AND demi_journee = p_horaire.demi_journee
            ) INTO v_exists;

            IF NOT v_exists THEN
              INSERT INTO public.capacite_effective (
                date, secretaire_id, demi_journee, site_id, horaire_base_secretaire_id
              ) VALUES (
                v_current_date, p_horaire.secretaire_id, p_horaire.demi_journee, v_site_id, p_horaire.id
              ) ON CONFLICT DO NOTHING;
            END IF;
          END IF;
        END IF;
      END IF;
    END IF;

    v_current_date := v_current_date + INTERVAL '7 days';
  END LOOP;
END;
$$;

-- 2) Déclencheur UPDATE pour les horaires base secrétaires: supprimer le futur et régénérer
CREATE OR REPLACE FUNCTION public.handle_horaire_secretaire_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.capacite_effective
  WHERE horaire_base_secretaire_id = OLD.id
    AND date >= CURRENT_DATE;

  PERFORM public.handle_horaire_secretaire_insert_logic(NEW);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_horaire_secretaire_update ON public.horaires_base_secretaires;
CREATE TRIGGER trg_horaire_secretaire_update
AFTER UPDATE ON public.horaires_base_secretaires
FOR EACH ROW
EXECUTE FUNCTION public.handle_horaire_secretaire_update();

-- 3) Restreindre la suppression au futur uniquement pour les secrétaires
CREATE OR REPLACE FUNCTION public.handle_horaire_secretaire_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.capacite_effective
  WHERE horaire_base_secretaire_id = OLD.id
    AND date >= CURRENT_DATE;
  RETURN OLD;
END;
$$;

-- 4) Logique d'insertion des horaires base médecins (même philosophie que secrétaires)
CREATE OR REPLACE FUNCTION public.handle_horaire_medecin_insert_logic(p_horaire record)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_current_date DATE;
  v_start_date DATE;
  v_end_date DATE;
  v_abs_full INTEGER;
  v_abs_period BOOLEAN;
  v_is_holiday BOOLEAN;
  v_should_work BOOLEAN;
  v_exists BOOLEAN;
  v_semaine_iso INTEGER;
BEGIN
  v_start_date := COALESCE(p_horaire.date_debut, CURRENT_DATE);
  v_end_date := COALESCE(p_horaire.date_fin, CURRENT_DATE + INTERVAL '52 weeks');

  IF v_start_date < CURRENT_DATE THEN
    v_start_date := CURRENT_DATE;
  END IF;

  v_current_date := v_start_date;

  -- Aligner sur le bon jour de semaine
  WHILE EXTRACT(ISODOW FROM v_current_date) != p_horaire.jour_semaine LOOP
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;

  WHILE v_current_date <= v_end_date LOOP
    -- Jours fériés
    SELECT EXISTS(
      SELECT 1 FROM public.jours_feries
      WHERE date = v_current_date AND actif = true
    ) INTO v_is_holiday;

    -- Alternance via la fonction should_doctor_work
    v_semaine_iso := EXTRACT(WEEK FROM v_current_date)::integer;
    v_should_work := public.should_doctor_work(
      COALESCE(p_horaire.alternance_type, 'hebdomadaire'::type_alternance),
      COALESCE(p_horaire.alternance_semaine_modulo, 0),
      v_current_date
    );

    IF v_should_work AND NOT v_is_holiday THEN
      -- Absence journée complète
      SELECT COUNT(*) INTO v_abs_full
      FROM public.absences
      WHERE medecin_id = p_horaire.medecin_id
        AND v_current_date BETWEEN date_debut AND date_fin
        AND statut IN ('approuve', 'en_attente')
        AND demi_journee = 'toute_journee';

      IF v_abs_full = 0 THEN
        IF p_horaire.demi_journee = 'toute_journee' THEN
          -- Matin: sauter si déjà un besoin pour ce médecin à cette date/période
          SELECT EXISTS(
            SELECT 1 FROM public.besoin_effectif
            WHERE date = v_current_date
              AND medecin_id = p_horaire.medecin_id
              AND demi_journee = 'matin'::demi_journee
              AND actif = true
          ) INTO v_exists;

          IF NOT v_exists THEN
            INSERT INTO public.besoin_effectif (
              date, type, medecin_id, site_id, demi_journee, type_intervention_id, horaire_base_medecin_id
            ) VALUES (
              v_current_date, 'medecin', p_horaire.medecin_id, p_horaire.site_id, 'matin'::demi_journee, p_horaire.type_intervention_id, p_horaire.id
            ) ON CONFLICT DO NOTHING;
          END IF;

          -- Après-midi
          SELECT EXISTS(
            SELECT 1 FROM public.besoin_effectif
            WHERE date = v_current_date
              AND medecin_id = p_horaire.medecin_id
              AND demi_journee = 'apres_midi'::demi_journee
              AND actif = true
          ) INTO v_exists;

          IF NOT v_exists THEN
            INSERT INTO public.besoin_effectif (
              date, type, medecin_id, site_id, demi_journee, type_intervention_id, horaire_base_medecin_id
            ) VALUES (
              v_current_date, 'medecin', p_horaire.medecin_id, p_horaire.site_id, 'apres_midi'::demi_journee, p_horaire.type_intervention_id, p_horaire.id
            ) ON CONFLICT DO NOTHING;
          END IF;
        ELSE
          -- Absence demi-journée spécifique ?
          SELECT EXISTS(
            SELECT 1 FROM public.absences
            WHERE medecin_id = p_horaire.medecin_id
              AND v_current_date BETWEEN date_debut AND date_fin
              AND statut IN ('approuve', 'en_attente')
              AND demi_journee = p_horaire.demi_journee
          ) INTO v_abs_period;

          IF NOT v_abs_period THEN
            -- Besoin déjà existant sur ce créneau ?
            SELECT EXISTS(
              SELECT 1 FROM public.besoin_effectif
              WHERE date = v_current_date
                AND medecin_id = p_horaire.medecin_id
                AND demi_journee = p_horaire.demi_journee
                AND actif = true
            ) INTO v_exists;

            IF NOT v_exists THEN
              INSERT INTO public.besoin_effectif (
                date, type, medecin_id, site_id, demi_journee, type_intervention_id, horaire_base_medecin_id
              ) VALUES (
                v_current_date, 'medecin', p_horaire.medecin_id, p_horaire.site_id, p_horaire.demi_journee, p_horaire.type_intervention_id, p_horaire.id
              ) ON CONFLICT DO NOTHING;
            END IF;
          END IF;
        END IF;
      END IF;
    END IF;

    v_current_date := v_current_date + INTERVAL '7 days';
  END LOOP;
END;
$$;

-- 5) Déclencheurs INSERT/UPDATE/SUPPRESS pour les horaires base médecins
CREATE OR REPLACE FUNCTION public.handle_horaire_medecin_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.handle_horaire_medecin_insert_logic(NEW);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_horaire_medecin_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Supprimer le futur seulement pour cet horaire
  DELETE FROM public.besoin_effectif
  WHERE horaire_base_medecin_id = OLD.id
    AND date >= CURRENT_DATE;

  PERFORM public.handle_horaire_medecin_insert_logic(NEW);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_horaire_medecin_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.besoin_effectif
  WHERE horaire_base_medecin_id = OLD.id
    AND date >= CURRENT_DATE;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_horaire_medecin_insert ON public.horaires_base_medecins;
CREATE TRIGGER trg_horaire_medecin_insert
AFTER INSERT ON public.horaires_base_medecins
FOR EACH ROW
EXECUTE FUNCTION public.handle_horaire_medecin_insert();

DROP TRIGGER IF EXISTS trg_horaire_medecin_update ON public.horaires_base_medecins;
CREATE TRIGGER trg_horaire_medecin_update
AFTER UPDATE ON public.horaires_base_medecins
FOR EACH ROW
EXECUTE FUNCTION public.handle_horaire_medecin_update();

DROP TRIGGER IF EXISTS trg_horaire_secretaire_delete ON public.horaires_base_secretaires;
CREATE TRIGGER trg_horaire_secretaire_delete
AFTER DELETE ON public.horaires_base_secretaires
FOR EACH ROW
EXECUTE FUNCTION public.handle_horaire_secretaire_delete();

DROP TRIGGER IF EXISTS trg_horaire_medecin_delete ON public.horaires_base_medecins;
CREATE TRIGGER trg_horaire_medecin_delete
AFTER DELETE ON public.horaires_base_medecins
FOR EACH ROW
EXECUTE FUNCTION public.handle_horaire_medecin_delete();
