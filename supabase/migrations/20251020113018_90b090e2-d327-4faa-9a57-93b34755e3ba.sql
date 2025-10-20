-- 1. Ajouter la colonne besoin_effectif_id dans planning_genere_bloc_operatoire
ALTER TABLE planning_genere_bloc_operatoire
ADD COLUMN besoin_effectif_id UUID REFERENCES besoin_effectif(id) ON DELETE CASCADE;

-- 2. Créer un index pour les performances
CREATE INDEX idx_planning_genere_bloc_besoin ON planning_genere_bloc_operatoire(besoin_effectif_id);

-- 3. Supprimer tous les planning_genere_bloc_operatoire existants (base propre)
DELETE FROM planning_genere_bloc_operatoire;

-- 4. Créer la fonction de nettoyage des capacités lors de la suppression d'un besoin
CREATE OR REPLACE FUNCTION public.cleanup_capacite_on_besoin_delete()
RETURNS TRIGGER AS $$
BEGIN
  -- Réinitialiser les capacités liées à ce planning
  UPDATE public.capacite_effective
  SET 
    planning_genere_bloc_operatoire_id = NULL,
    besoin_operation_id = NULL,
    site_id = '00000000-0000-0000-0000-000000000001'::uuid
  WHERE planning_genere_bloc_operatoire_id IN (
    SELECT id FROM public.planning_genere_bloc_operatoire
    WHERE besoin_effectif_id = OLD.id
  );
  
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 5. Créer le trigger AVANT DELETE sur besoin_effectif
DROP TRIGGER IF EXISTS cleanup_capacite_before_besoin_delete ON public.besoin_effectif;
CREATE TRIGGER cleanup_capacite_before_besoin_delete
BEFORE DELETE ON public.besoin_effectif
FOR EACH ROW
EXECUTE FUNCTION public.cleanup_capacite_on_besoin_delete();

-- 6. Modifier le trigger INSERT pour lier besoin_effectif_id
CREATE OR REPLACE FUNCTION public.handle_besoin_bloc_insert()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.type_intervention_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.planning_genere_bloc_operatoire (
    date,
    periode,
    type_intervention_id,
    medecin_id,
    salle_assignee,
    statut,
    besoin_effectif_id
  ) VALUES (
    NEW.date,
    NEW.demi_journee,
    NEW.type_intervention_id,
    NEW.medecin_id,
    NULL::uuid,
    'planifie'::statut_planning,
    NEW.id
  )
  ON CONFLICT (date, periode, type_intervention_id, medecin_id) DO UPDATE
  SET besoin_effectif_id = NEW.id;

  PERFORM public.reassign_all_rooms_for_slot(NEW.date, NEW.demi_journee);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 7. Modifier le trigger UPDATE pour maintenir la cohérence
CREATE OR REPLACE FUNCTION public.handle_besoin_bloc_update()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.type_intervention_id IS NOT NULL THEN
    IF NEW.type_intervention_id IS NULL THEN
      DELETE FROM public.planning_genere_bloc_operatoire
      WHERE besoin_effectif_id = OLD.id;
      
      PERFORM public.reassign_all_rooms_for_slot(OLD.date, OLD.demi_journee);
      RETURN NEW;
    END IF;

    IF (OLD.date != NEW.date OR 
        OLD.demi_journee != NEW.demi_journee OR 
        OLD.type_intervention_id != NEW.type_intervention_id OR
        OLD.medecin_id != NEW.medecin_id) THEN
      
      DELETE FROM public.planning_genere_bloc_operatoire
      WHERE besoin_effectif_id = OLD.id;

      INSERT INTO public.planning_genere_bloc_operatoire (
        date,
        periode,
        type_intervention_id,
        medecin_id,
        salle_assignee,
        statut,
        besoin_effectif_id
      ) VALUES (
        NEW.date,
        NEW.demi_journee,
        NEW.type_intervention_id,
        NEW.medecin_id,
        NULL::uuid,
        'planifie'::statut_planning,
        NEW.id
      )
      ON CONFLICT (date, periode, type_intervention_id, medecin_id) DO UPDATE
      SET besoin_effectif_id = NEW.id;

      PERFORM public.reassign_all_rooms_for_slot(OLD.date, OLD.demi_journee);
      PERFORM public.reassign_all_rooms_for_slot(NEW.date, NEW.demi_journee);
    END IF;
  ELSIF NEW.type_intervention_id IS NOT NULL THEN
    INSERT INTO public.planning_genere_bloc_operatoire (
      date,
      periode,
      type_intervention_id,
      medecin_id,
      salle_assignee,
      statut,
      besoin_effectif_id
    ) VALUES (
      NEW.date,
      NEW.demi_journee,
      NEW.type_intervention_id,
      NEW.medecin_id,
      NULL::uuid,
      'planifie'::statut_planning,
      NEW.id
    )
    ON CONFLICT (date, periode, type_intervention_id, medecin_id) DO UPDATE
    SET besoin_effectif_id = NEW.id;

    PERFORM public.reassign_all_rooms_for_slot(NEW.date, NEW.demi_journee);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 8. Modifier le trigger DELETE pour utiliser le lien
CREATE OR REPLACE FUNCTION public.handle_besoin_bloc_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.type_intervention_id IS NULL THEN
    RETURN OLD;
  END IF;

  DELETE FROM public.planning_genere_bloc_operatoire
  WHERE besoin_effectif_id = OLD.id;

  PERFORM public.reassign_all_rooms_for_slot(OLD.date, OLD.demi_journee);

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 9. Régénérer tous les planning_genere_bloc_operatoire à partir des besoin_effectif existants
INSERT INTO public.planning_genere_bloc_operatoire (
  date,
  periode,
  type_intervention_id,
  medecin_id,
  salle_assignee,
  statut,
  besoin_effectif_id
)
SELECT 
  be.date,
  be.demi_journee,
  be.type_intervention_id,
  be.medecin_id,
  NULL::uuid,
  'planifie'::statut_planning,
  be.id
FROM public.besoin_effectif be
WHERE be.type_intervention_id IS NOT NULL
ON CONFLICT (date, periode, type_intervention_id, medecin_id) DO UPDATE
SET besoin_effectif_id = EXCLUDED.besoin_effectif_id;

-- 10. Réassigner toutes les salles pour tous les créneaux générés
DO $$
DECLARE
  v_date date;
  v_periode demi_journee;
BEGIN
  FOR v_date, v_periode IN 
    SELECT DISTINCT date, periode 
    FROM public.planning_genere_bloc_operatoire
  LOOP
    PERFORM public.reassign_all_rooms_for_slot(v_date, v_periode);
  END LOOP;
END $$;