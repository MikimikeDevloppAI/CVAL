-- Supprimer tous les besoins effectifs existants
DELETE FROM besoin_effectif WHERE type = 'medecin';

-- Recréer la fonction de génération des besoins effectifs pour les médecins
-- en enlevant le ON CONFLICT DO NOTHING qui masquait les problèmes
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
  v_should_work BOOLEAN;
  v_abs_full INTEGER;
  v_has_partial_absence BOOLEAN;
BEGIN
  v_start_date := COALESCE(p_horaire.date_debut, CURRENT_DATE);
  v_end_date := COALESCE(p_horaire.date_fin, CURRENT_DATE + INTERVAL '52 weeks');
  
  IF v_start_date < CURRENT_DATE THEN
    v_start_date := CURRENT_DATE;
  END IF;
  
  v_current_date := v_start_date;
  
  -- Trouver le premier jour qui correspond au jour de la semaine
  WHILE EXTRACT(ISODOW FROM v_current_date) != p_horaire.jour_semaine LOOP
    v_current_date := v_current_date + INTERVAL '1 day';
  END LOOP;
  
  WHILE v_current_date <= v_end_date LOOP
    -- Vérifier si le médecin doit travailler ce jour selon l'alternance
    v_should_work := public.should_doctor_work(
      p_horaire.alternance_type,
      p_horaire.alternance_semaine_modulo,
      v_current_date
    );
    
    IF v_should_work THEN
      -- Vérifier s'il y a une absence complète ce jour-là
      SELECT COUNT(*) INTO v_abs_full
      FROM public.absences
      WHERE medecin_id = p_horaire.medecin_id
        AND v_current_date BETWEEN date_debut AND date_fin
        AND statut IN ('approuve', 'en_attente')
        AND heure_debut IS NULL AND heure_fin IS NULL;
      
      IF v_abs_full = 0 THEN
        -- Vérifier s'il y a une absence partielle
        SELECT EXISTS(
          SELECT 1 FROM public.absences
          WHERE medecin_id = p_horaire.medecin_id
            AND v_current_date BETWEEN date_debut AND date_fin
            AND statut IN ('approuve', 'en_attente')
            AND heure_debut IS NOT NULL AND heure_fin IS NOT NULL
        ) INTO v_has_partial_absence;

        IF NOT v_has_partial_absence THEN
          -- Insérer le besoin effectif SANS ON CONFLICT
          -- Cela permettra de détecter les vrais conflits
          INSERT INTO public.besoin_effectif (
            date, type, medecin_id, site_id, demi_journee
          ) VALUES (
            v_current_date, 'medecin', p_horaire.medecin_id, p_horaire.site_id, p_horaire.demi_journee
          );
        END IF;
      END IF;
    END IF;
    
    v_current_date := v_current_date + INTERVAL '7 days';
  END LOOP;
END;
$function$;

-- Régénérer tous les besoins effectifs pour tous les médecins actifs
DO $$
DECLARE
  v_horaire RECORD;
BEGIN
  FOR v_horaire IN
    SELECT * FROM public.horaires_base_medecins
    WHERE actif = true
    ORDER BY medecin_id, jour_semaine, demi_journee
  LOOP
    PERFORM public.handle_horaire_medecin_insert_logic(v_horaire);
  END LOOP;
END $$;