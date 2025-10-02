-- Fonction pour vérifier qu'une secrétaire/backup n'est pas assignée deux fois au même créneau le même jour
CREATE OR REPLACE FUNCTION public.check_planning_genere_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_secretaire_id UUID;
  v_overlap_count INTEGER;
  v_existing_site TEXT;
  v_existing_hours TEXT;
BEGIN
  -- Vérifier pour chaque secrétaire dans le tableau secretaires_ids
  IF NEW.secretaires_ids IS NOT NULL THEN
    FOREACH v_secretaire_id IN ARRAY NEW.secretaires_ids
    LOOP
      SELECT COUNT(*), MAX(s.nom || ' (' || pg.heure_debut::text || ' - ' || pg.heure_fin::text || ')')
      INTO v_overlap_count, v_existing_hours
      FROM public.planning_genere pg
      LEFT JOIN public.sites s ON s.id = pg.site_id
      WHERE pg.date = NEW.date
        AND pg.statut != 'annule'
        AND pg.id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
        AND v_secretaire_id = ANY(pg.secretaires_ids)
        AND (NEW.heure_debut, NEW.heure_fin) OVERLAPS (pg.heure_debut, pg.heure_fin);
      
      IF v_overlap_count > 0 THEN
        RAISE EXCEPTION 'Cette secrétaire est déjà assignée à un autre créneau qui chevauche: %. Veuillez d''abord modifier ou supprimer cette assignation.', 
          v_existing_hours;
      END IF;
    END LOOP;
  END IF;

  -- Vérifier pour chaque backup dans le tableau backups_ids
  IF NEW.backups_ids IS NOT NULL THEN
    FOREACH v_secretaire_id IN ARRAY NEW.backups_ids
    LOOP
      SELECT COUNT(*), MAX(s.nom || ' (' || pg.heure_debut::text || ' - ' || pg.heure_fin::text || ')')
      INTO v_overlap_count, v_existing_hours
      FROM public.planning_genere pg
      LEFT JOIN public.sites s ON s.id = pg.site_id
      WHERE pg.date = NEW.date
        AND pg.statut != 'annule'
        AND pg.id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
        AND v_secretaire_id = ANY(pg.backups_ids)
        AND (NEW.heure_debut, NEW.heure_fin) OVERLAPS (pg.heure_debut, pg.heure_fin);
      
      IF v_overlap_count > 0 THEN
        RAISE EXCEPTION 'Ce backup est déjà assigné à un autre créneau qui chevauche: %. Veuillez d''abord modifier ou supprimer cette assignation.', 
          v_existing_hours;
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

-- Créer le trigger
DROP TRIGGER IF EXISTS check_planning_overlap ON public.planning_genere;
CREATE TRIGGER check_planning_overlap
  BEFORE INSERT OR UPDATE ON public.planning_genere
  FOR EACH ROW
  EXECUTE FUNCTION public.check_planning_genere_overlap();