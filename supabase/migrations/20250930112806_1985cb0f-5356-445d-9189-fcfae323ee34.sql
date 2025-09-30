-- Supprimer la colonne site_id de capacite_effective et modifier les fonctions

-- 1. Modifier la fonction generate_capacite_effective pour ne plus utiliser site_id
CREATE OR REPLACE FUNCTION public.generate_capacite_effective()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_start_date DATE := CURRENT_DATE;
  v_end_date DATE := CURRENT_DATE + INTERVAL '5 weeks';
  v_current_date DATE;
  v_jour_semaine INTEGER;
  v_secretaire RECORD;
  v_horaire RECORD;
  v_abs_full INTEGER;
  v_abs_start TIME;
  v_abs_end TIME;
  v_seg_start TIME;
  v_seg_end TIME;
BEGIN
  -- Clean old data
  DELETE FROM public.capacite_effective WHERE date < CURRENT_DATE - INTERVAL '8 weeks';

  v_current_date := v_start_date;
  
  WHILE v_current_date <= v_end_date LOOP
    v_jour_semaine := EXTRACT(ISODOW FROM v_current_date);
    
    FOR v_secretaire IN
      SELECT id, specialites FROM public.secretaires WHERE actif = true
    LOOP
      FOR v_horaire IN
        SELECT * FROM public.horaires_base_secretaires
        WHERE secretaire_id = v_secretaire.id
          AND jour_semaine = v_jour_semaine
          AND actif = true
      LOOP
        -- Check for full-day absence (both heure_debut AND heure_fin must be NULL)
        SELECT COUNT(*) INTO v_abs_full
        FROM public.absences
        WHERE secretaire_id = v_secretaire.id
          AND v_current_date BETWEEN date_debut AND date_fin
          AND statut IN ('approuve', 'en_attente')
          AND heure_debut IS NULL AND heure_fin IS NULL;
        
        IF v_abs_full = 0 THEN
          -- Get partial-day absence window if any (union window min/max)
          SELECT MIN(heure_debut), MAX(heure_fin)
            INTO v_abs_start, v_abs_end
          FROM public.absences
          WHERE secretaire_id = v_secretaire.id
            AND v_current_date BETWEEN date_debut AND date_fin
            AND statut IN ('approuve', 'en_attente')
            AND heure_debut IS NOT NULL AND heure_fin IS NOT NULL;

          IF v_abs_start IS NULL OR v_abs_end IS NULL THEN
            INSERT INTO public.capacite_effective (
              date, secretaire_id, heure_debut, heure_fin, specialites
            ) VALUES (
              v_current_date, v_secretaire.id,
              v_horaire.heure_debut, v_horaire.heure_fin, v_secretaire.specialites
            )
            ON CONFLICT DO NOTHING;
          ELSE
            -- Segment before absence
            v_seg_start := v_horaire.heure_debut;
            v_seg_end := LEAST(v_abs_start, v_horaire.heure_fin);
            IF v_seg_start < v_seg_end THEN
              INSERT INTO public.capacite_effective (
                date, secretaire_id, heure_debut, heure_fin, specialites
              ) VALUES (
                v_current_date, v_secretaire.id,
                v_seg_start, v_seg_end, v_secretaire.specialites
              )
              ON CONFLICT DO NOTHING;
            END IF;

            -- Segment after absence
            v_seg_start := GREATEST(v_abs_end, v_horaire.heure_debut);
            v_seg_end := v_horaire.heure_fin;
            IF v_seg_start < v_seg_end THEN
              INSERT INTO public.capacite_effective (
                date, secretaire_id, heure_debut, heure_fin, specialites
              ) VALUES (
                v_current_date, v_secretaire.id,
                v_seg_start, v_seg_end, v_secretaire.specialites
              )
              ON CONFLICT DO NOTHING;
            END IF;
          END IF;
        END IF;
      END LOOP;
    END LOOP;
    
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
END;
$function$;

-- 2. Modifier la fonction recreate_secretary_capacite pour ne plus utiliser site_id
CREATE OR REPLACE FUNCTION public.recreate_secretary_capacite(p_secretaire_id uuid, p_date_debut date, p_date_fin date)
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
  v_abs_start time;
  v_abs_end time;
  v_seg_start time;
  v_seg_end time;
BEGIN
  -- Get secretary info
  SELECT id, specialites 
  INTO v_secretaire
  FROM public.secretaires 
  WHERE id = p_secretaire_id AND actif = true;
  
  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_current_date := p_date_debut;
  
  WHILE v_current_date <= p_date_fin LOOP
    v_jour_semaine := EXTRACT(ISODOW FROM v_current_date);
    
    FOR v_horaire IN
      SELECT * FROM public.horaires_base_secretaires
      WHERE secretaire_id = p_secretaire_id
        AND jour_semaine = v_jour_semaine
        AND actif = true
    LOOP
      -- Check for full-day absence
      SELECT COUNT(*) INTO v_abs_full
      FROM public.absences
      WHERE secretaire_id = p_secretaire_id
        AND v_current_date BETWEEN date_debut AND date_fin
        AND statut IN ('approuve', 'en_attente')
        AND heure_debut IS NULL AND heure_fin IS NULL;
      
      IF v_abs_full = 0 THEN
        -- Get partial-day absence window
        SELECT MIN(heure_debut), MAX(heure_fin)
        INTO v_abs_start, v_abs_end
        FROM public.absences
        WHERE secretaire_id = p_secretaire_id
          AND v_current_date BETWEEN date_debut AND date_fin
          AND statut IN ('approuve', 'en_attente')
          AND heure_debut IS NOT NULL AND heure_fin IS NOT NULL;

        IF v_abs_start IS NULL OR v_abs_end IS NULL THEN
          -- No absence: insert whole slot
          INSERT INTO public.capacite_effective (
            date, secretaire_id, heure_debut, heure_fin, specialites
          ) VALUES (
            v_current_date, v_secretaire.id,
            v_horaire.heure_debut, v_horaire.heure_fin, v_secretaire.specialites
          )
          ON CONFLICT DO NOTHING;
        ELSE
          -- Segment before absence
          v_seg_start := v_horaire.heure_debut;
          v_seg_end := LEAST(v_abs_start, v_horaire.heure_fin);
          IF v_seg_start < v_seg_end AND (v_seg_end - v_seg_start) >= INTERVAL '30 minutes' THEN
            INSERT INTO public.capacite_effective (
              date, secretaire_id, heure_debut, heure_fin, specialites
            ) VALUES (
              v_current_date, v_secretaire.id,
              v_seg_start, v_seg_end, v_secretaire.specialites
            )
            ON CONFLICT DO NOTHING;
          END IF;

          -- Segment after absence
          v_seg_start := GREATEST(v_abs_end, v_horaire.heure_debut);
          v_seg_end := v_horaire.heure_fin;
          IF v_seg_start < v_seg_end AND (v_seg_end - v_seg_start) >= INTERVAL '30 minutes' THEN
            INSERT INTO public.capacite_effective (
              date, secretaire_id, heure_debut, heure_fin, specialites
            ) VALUES (
              v_current_date, v_secretaire.id,
              v_seg_start, v_seg_end, v_secretaire.specialites
            )
            ON CONFLICT DO NOTHING;
          END IF;
        END IF;
      END IF;
    END LOOP;
    
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
END;
$function$;

-- 3. Modifier la fonction check_capacite_effective_overlap pour ne plus utiliser site_id
CREATE OR REPLACE FUNCTION public.check_capacite_effective_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_overlap_count INTEGER;
  v_existing_hours TEXT;
BEGIN
  -- Chercher les chevauchements pour cette secrétaire ce jour-là
  SELECT COUNT(*),
         MAX(ce.heure_debut::text || ' - ' || ce.heure_fin::text)
  INTO v_overlap_count, v_existing_hours
  FROM public.capacite_effective ce
  WHERE ce.secretaire_id = NEW.secretaire_id
    AND ce.date = NEW.date
    AND ce.actif = true
    AND ce.id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND (
      -- Vérifier le chevauchement des horaires
      (NEW.heure_debut, NEW.heure_fin) OVERLAPS (ce.heure_debut, ce.heure_fin)
    );
  
  IF v_overlap_count > 0 THEN
    RAISE EXCEPTION 'Cette secrétaire est déjà attribuée pour les horaires %. Veuillez d''abord supprimer cette ligne pour la réattribuer.', 
      v_existing_hours;
  END IF;
  
  RETURN NEW;
END;
$function$;

-- 4. Désactiver temporairement le trigger
ALTER TABLE public.capacite_effective DISABLE TRIGGER trigger_check_capacite_effective_overlap;

-- 5. Supprimer la colonne site_id
ALTER TABLE public.capacite_effective DROP COLUMN IF EXISTS site_id;

-- 6. Régénérer toutes les capacités effectives
DELETE FROM public.capacite_effective;
SELECT public.generate_capacite_effective();

-- 7. Réactiver le trigger
ALTER TABLE public.capacite_effective ENABLE TRIGGER trigger_check_capacite_effective_overlap;