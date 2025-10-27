-- Migration: Ajout des références aux horaires de base et passage aux semaines ISO (Version optimisée)

-- ============================================================================
-- PARTIE 1: Ajout des colonnes de référence aux horaires de base
-- ============================================================================

ALTER TABLE public.capacite_effective 
ADD COLUMN IF NOT EXISTS horaire_base_secretaire_id UUID NULL 
REFERENCES public.horaires_base_secretaires(id) ON DELETE CASCADE;

ALTER TABLE public.besoin_effectif 
ADD COLUMN IF NOT EXISTS horaire_base_medecin_id UUID NULL 
REFERENCES public.horaires_base_medecins(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_capacite_effective_horaire_base 
ON public.capacite_effective(horaire_base_secretaire_id) 
WHERE horaire_base_secretaire_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_besoin_effectif_horaire_base 
ON public.besoin_effectif(horaire_base_medecin_id) 
WHERE horaire_base_medecin_id IS NOT NULL;

-- ============================================================================
-- PARTIE 2: Mise à jour des fonctions SQL avec semaines ISO et références horaires
-- ============================================================================

CREATE OR REPLACE FUNCTION public.should_doctor_work(
  p_alternance_type type_alternance, 
  p_alternance_modulo integer, 
  p_target_date date
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  v_week_number integer;
BEGIN
  v_week_number := EXTRACT(WEEK FROM p_target_date)::integer;
  
  RETURN CASE p_alternance_type
    WHEN 'hebdomadaire' THEN true
    WHEN 'une_sur_deux' THEN (v_week_number % 2 = p_alternance_modulo)
    WHEN 'une_sur_trois' THEN (v_week_number % 3 = p_alternance_modulo)
    WHEN 'une_sur_quatre' THEN (v_week_number % 4 = p_alternance_modulo)
    WHEN 'trois_sur_quatre' THEN (v_week_number % 4 != p_alternance_modulo)
    ELSE true
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_horaire_secretaire_insert_logic(p_horaire record)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
      SELECT COUNT(*) INTO v_abs_full
      FROM public.absences
      WHERE secretaire_id = p_horaire.secretaire_id
        AND v_current_date BETWEEN date_debut AND date_fin
        AND statut IN ('approuve', 'en_attente')
        AND demi_journee = 'toute_journee';
      
      IF v_abs_full = 0 THEN
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
            INSERT INTO public.capacite_effective (
              date, secretaire_id, demi_journee, site_id, horaire_base_secretaire_id
            ) VALUES (
              v_current_date, p_horaire.secretaire_id, 'matin'::demi_journee, v_site_id, p_horaire.id
            ) ON CONFLICT DO NOTHING;
            
            INSERT INTO public.capacite_effective (
              date, secretaire_id, demi_journee, site_id, horaire_base_secretaire_id
            ) VALUES (
              v_current_date, p_horaire.secretaire_id, 'apres_midi'::demi_journee, v_site_id, p_horaire.id
            ) ON CONFLICT DO NOTHING;
          ELSE
            INSERT INTO public.capacite_effective (
              date, secretaire_id, demi_journee, site_id, horaire_base_secretaire_id
            ) VALUES (
              v_current_date, p_horaire.secretaire_id, p_horaire.demi_journee, v_site_id, p_horaire.id
            ) ON CONFLICT DO NOTHING;
          END IF;
        END IF;
      END IF;
    END IF;
    
    v_current_date := v_current_date + INTERVAL '7 days';
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_horaire_secretaire_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.capacite_effective WHERE horaire_base_secretaire_id = OLD.id;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_horaire_secretaire_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.actif = true AND NEW.actif = false THEN
    DELETE FROM public.capacite_effective WHERE horaire_base_secretaire_id = OLD.id;
    RETURN NEW;
  END IF;
  
  DELETE FROM public.capacite_effective WHERE horaire_base_secretaire_id = OLD.id;
  
  IF NEW.actif = true THEN
    PERFORM public.handle_horaire_secretaire_insert_logic(NEW);
  END IF;
  
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS on_horaire_secretaire_update ON public.horaires_base_secretaires;
CREATE TRIGGER on_horaire_secretaire_update
  AFTER UPDATE ON public.horaires_base_secretaires
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_horaire_secretaire_update();

CREATE OR REPLACE FUNCTION public.handle_horaire_medecin_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.besoin_effectif WHERE horaire_base_medecin_id = OLD.id;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_horaire_medecin_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.actif = true AND NEW.actif = false THEN
    DELETE FROM public.besoin_effectif WHERE horaire_base_medecin_id = OLD.id;
    RETURN NEW;
  END IF;
  
  DELETE FROM public.besoin_effectif WHERE horaire_base_medecin_id = OLD.id;
  
  IF NEW.actif = true THEN
    PERFORM public.handle_horaire_medecin_insert_logic(NEW);
  END IF;
  
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS on_horaire_medecin_update ON public.horaires_base_medecins;
CREATE TRIGGER on_horaire_medecin_update
  AFTER UPDATE ON public.horaires_base_medecins
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_horaire_medecin_update();

CREATE OR REPLACE FUNCTION public.handle_horaire_medecin_insert_logic(p_horaire record)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_current_date DATE;
  v_start_date DATE;
  v_end_date DATE;
  v_abs_full INTEGER;
  v_abs_period BOOLEAN;
  v_is_holiday BOOLEAN;
  v_should_work BOOLEAN;
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
        AND demi_journee = 'toute_journee';
      
      IF v_abs_full = 0 THEN
        SELECT EXISTS(
          SELECT 1 FROM public.absences
          WHERE medecin_id = p_horaire.medecin_id
            AND v_current_date BETWEEN date_debut AND date_fin
            AND statut IN ('approuve', 'en_attente')
            AND demi_journee = p_horaire.demi_journee
        ) INTO v_abs_period;

        IF NOT v_abs_period THEN
          IF p_horaire.demi_journee = 'toute_journee' THEN
            INSERT INTO public.besoin_effectif (
              date, type, medecin_id, site_id, demi_journee, type_intervention_id, horaire_base_medecin_id
            ) VALUES (
              v_current_date, 'medecin', p_horaire.medecin_id, p_horaire.site_id, 'matin'::demi_journee, p_horaire.type_intervention_id, p_horaire.id
            ) ON CONFLICT DO NOTHING;
            
            INSERT INTO public.besoin_effectif (
              date, type, medecin_id, site_id, demi_journee, type_intervention_id, horaire_base_medecin_id
            ) VALUES (
              v_current_date, 'medecin', p_horaire.medecin_id, p_horaire.site_id, 'apres_midi'::demi_journee, p_horaire.type_intervention_id, p_horaire.id
            ) ON CONFLICT DO NOTHING;
          ELSE
            INSERT INTO public.besoin_effectif (
              date, type, medecin_id, site_id, demi_journee, type_intervention_id, horaire_base_medecin_id
            ) VALUES (
              v_current_date, 'medecin', p_horaire.medecin_id, p_horaire.site_id, p_horaire.demi_journee, p_horaire.type_intervention_id, p_horaire.id
            ) ON CONFLICT DO NOTHING;
          END IF;
        END IF;
      END IF;
    END IF;
    
    v_current_date := v_current_date + INTERVAL '7 days';
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_horaire_medecin_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.handle_horaire_medecin_insert_logic(NEW);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS on_horaire_medecin_insert ON public.horaires_base_medecins;
CREATE TRIGGER on_horaire_medecin_insert
  AFTER INSERT ON public.horaires_base_medecins
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_horaire_medecin_insert();

CREATE OR REPLACE FUNCTION public.recreate_secretary_capacite(
  p_secretaire_id uuid, 
  p_date_debut date, 
  p_date_fin date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_current_date date;
  v_jour_semaine integer;
  v_secretaire RECORD;
  v_horaire RECORD;
  v_abs_full integer;
  v_abs_period boolean;
  v_max_date date;
  v_is_holiday boolean;
  v_should_work boolean;
  v_site_id uuid;
  v_semaine_iso INTEGER;
BEGIN
  SELECT COALESCE(MAX(date), (CURRENT_DATE + INTERVAL '52 weeks')::date) 
  INTO v_max_date 
  FROM public.capacite_effective;
  
  p_date_fin := v_max_date;
  
  SELECT id 
  INTO v_secretaire
  FROM public.secretaires 
  WHERE id = p_secretaire_id AND actif = true;
  
  IF NOT FOUND THEN
    RETURN;
  END IF;

  DELETE FROM public.capacite_effective
  WHERE secretaire_id = p_secretaire_id 
    AND date >= p_date_debut 
    AND date <= p_date_fin
    AND horaire_base_secretaire_id IS NOT NULL;

  v_current_date := p_date_debut;
  
  WHILE v_current_date <= p_date_fin LOOP
    v_jour_semaine := EXTRACT(ISODOW FROM v_current_date);
    
    SELECT EXISTS(
      SELECT 1 FROM public.jours_feries
      WHERE date = v_current_date AND actif = true
    ) INTO v_is_holiday;
    
    IF NOT v_is_holiday THEN
      FOR v_horaire IN
        SELECT * FROM public.horaires_base_secretaires
        WHERE secretaire_id = p_secretaire_id
          AND jour_semaine = v_jour_semaine
          AND actif = true
          AND (date_debut IS NULL OR v_current_date >= date_debut)
          AND (date_fin IS NULL OR v_current_date <= date_fin)
      LOOP
        v_semaine_iso := EXTRACT(WEEK FROM v_current_date)::integer;
        
        v_should_work := CASE COALESCE(v_horaire.alternance_type, 'hebdomadaire'::type_alternance)
          WHEN 'hebdomadaire' THEN true
          WHEN 'une_sur_deux' THEN (v_semaine_iso % 2 = COALESCE(v_horaire.alternance_semaine_modulo, 0))
          WHEN 'une_sur_trois' THEN (v_semaine_iso % 3 = COALESCE(v_horaire.alternance_semaine_modulo, 0))
          WHEN 'une_sur_quatre' THEN (v_semaine_iso % 4 = COALESCE(v_horaire.alternance_semaine_modulo, 0))
          WHEN 'trois_sur_quatre' THEN (v_semaine_iso % 4 != COALESCE(v_horaire.alternance_semaine_modulo, 0))
          ELSE true
        END;
        
        IF v_should_work THEN
          SELECT COUNT(*) INTO v_abs_full
          FROM public.absences
          WHERE secretaire_id = p_secretaire_id
            AND v_current_date BETWEEN date_debut AND date_fin
            AND statut IN ('approuve', 'en_attente')
            AND demi_journee = 'toute_journee';
          
          IF v_abs_full = 0 THEN
            SELECT EXISTS(
              SELECT 1 FROM public.absences
              WHERE secretaire_id = p_secretaire_id
                AND v_current_date BETWEEN date_debut AND date_fin
                AND statut IN ('approuve', 'en_attente')
                AND demi_journee = v_horaire.demi_journee
            ) INTO v_abs_period;

            IF NOT v_abs_period THEN
              v_site_id := COALESCE(v_horaire.site_id, '00000000-0000-0000-0000-000000000001'::uuid);
              
              IF v_horaire.demi_journee = 'toute_journee' THEN
                INSERT INTO public.capacite_effective (
                  date, secretaire_id, demi_journee, site_id, horaire_base_secretaire_id
                ) VALUES (
                  v_current_date, v_secretaire.id, 'matin'::demi_journee, v_site_id, v_horaire.id
                ) ON CONFLICT DO NOTHING;
                
                INSERT INTO public.capacite_effective (
                  date, secretaire_id, demi_journee, site_id, horaire_base_secretaire_id
                ) VALUES (
                  v_current_date, v_secretaire.id, 'apres_midi'::demi_journee, v_site_id, v_horaire.id
                ) ON CONFLICT DO NOTHING;
              ELSE
                INSERT INTO public.capacite_effective (
                  date, secretaire_id, demi_journee, site_id, horaire_base_secretaire_id
                ) VALUES (
                  v_current_date, v_secretaire.id, v_horaire.demi_journee, v_site_id, v_horaire.id
                ) ON CONFLICT DO NOTHING;
              END IF;
            END IF;
          END IF;
        END IF;
      END LOOP;
    END IF;
    
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.recreate_doctor_besoin(
  p_medecin_id uuid, 
  p_date_debut date, 
  p_date_fin date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_current_date date;
  v_jour_semaine integer;
  v_medecin RECORD;
  v_horaire RECORD;
  v_abs_full integer;
  v_abs_period boolean;
  v_max_date date;
  v_is_holiday boolean;
  v_should_work boolean;
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
    AND date <= p_date_fin
    AND horaire_base_medecin_id IS NOT NULL;

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
          AND (date_debut IS NULL OR v_current_date >= date_debut)
          AND (date_fin IS NULL OR v_current_date <= date_fin)
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
            AND demi_journee = 'toute_journee';
          
          IF v_abs_full = 0 THEN
            SELECT EXISTS(
              SELECT 1 FROM public.absences
              WHERE medecin_id = p_medecin_id
                AND v_current_date BETWEEN date_debut AND date_fin
                AND statut IN ('approuve', 'en_attente')
                AND demi_journee = v_horaire.demi_journee
            ) INTO v_abs_period;

            IF NOT v_abs_period THEN
              IF v_horaire.demi_journee = 'toute_journee' THEN
                INSERT INTO public.besoin_effectif (
                  date, type, medecin_id, site_id, demi_journee, type_intervention_id, horaire_base_medecin_id
                ) VALUES (
                  v_current_date, 'medecin', v_medecin.id, v_horaire.site_id, 'matin'::demi_journee, v_horaire.type_intervention_id, v_horaire.id
                ) ON CONFLICT DO NOTHING;
                
                INSERT INTO public.besoin_effectif (
                  date, type, medecin_id, site_id, demi_journee, type_intervention_id, horaire_base_medecin_id
                ) VALUES (
                  v_current_date, 'medecin', v_medecin.id, v_horaire.site_id, 'apres_midi'::demi_journee, v_horaire.type_intervention_id, v_horaire.id
                ) ON CONFLICT DO NOTHING;
              ELSE
                INSERT INTO public.besoin_effectif (
                  date, type, medecin_id, site_id, demi_journee, type_intervention_id, horaire_base_medecin_id
                ) VALUES (
                  v_current_date, 'medecin', v_medecin.id, v_horaire.site_id, v_horaire.demi_journee, v_horaire.type_intervention_id, v_horaire.id
                ) ON CONFLICT DO NOTHING;
              END IF;
            END IF;
          END IF;
        END IF;
      END LOOP;
    END IF;
    
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
END;
$function$;