-- Refonte de la table planning_genere pour avoir une ligne par (site, date, periode)

-- 1. Supprimer le trigger qui dépend de is_1r/is_2f
DROP TRIGGER IF EXISTS trigger_sync_assignations_1r_2f ON public.planning_genere;

-- 2. Supprimer les anciennes colonnes individuelles avec CASCADE
ALTER TABLE public.planning_genere 
  DROP COLUMN IF EXISTS secretaire_id CASCADE,
  DROP COLUMN IF EXISTS backup_id CASCADE,
  DROP COLUMN IF EXISTS medecin_id CASCADE,
  DROP COLUMN IF EXISTS is_1r CASCADE,
  DROP COLUMN IF EXISTS is_2f CASCADE;

-- 3. Ajouter les nouvelles colonnes array et responsables 1R/2F
ALTER TABLE public.planning_genere
  ADD COLUMN IF NOT EXISTS secretaires_ids UUID[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS backups_ids UUID[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS medecins_ids UUID[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS responsable_1r_id UUID,
  ADD COLUMN IF NOT EXISTS responsable_2f_id UUID;

-- 4. Créer un index pour améliorer les performances
CREATE INDEX IF NOT EXISTS idx_planning_genere_site_date_periode 
  ON public.planning_genere(site_id, date, type) 
  WHERE site_id IS NOT NULL;

-- 5. Créer un nouveau trigger pour synchroniser l'historique 1R/2F avec la nouvelle structure
CREATE OR REPLACE FUNCTION public.sync_assignations_1r_2f_new()
RETURNS TRIGGER AS $$
BEGIN
  -- Supprimer les anciennes entrées pour ce site/date
  DELETE FROM public.assignations_1r_2f_historique
  WHERE date = NEW.date
    AND site_id = NEW.site_id;
  
  -- Insérer 1R si un responsable est défini
  IF NEW.responsable_1r_id IS NOT NULL THEN
    INSERT INTO public.assignations_1r_2f_historique (
      secretaire_id, backup_id, date, type_assignation, site_id
    )
    SELECT 
      CASE WHEN s.id IS NOT NULL THEN s.id ELSE NULL END,
      CASE WHEN b.id IS NOT NULL THEN b.id ELSE NULL END,
      NEW.date,
      '1r',
      NEW.site_id
    FROM (SELECT NEW.responsable_1r_id as id) AS resp
    LEFT JOIN public.secretaires s ON s.id = resp.id
    LEFT JOIN public.backup b ON b.id = resp.id;
  END IF;
  
  -- Insérer 2F si un responsable est défini
  IF NEW.responsable_2f_id IS NOT NULL THEN
    INSERT INTO public.assignations_1r_2f_historique (
      secretaire_id, backup_id, date, type_assignation, site_id
    )
    SELECT 
      CASE WHEN s.id IS NOT NULL THEN s.id ELSE NULL END,
      CASE WHEN b.id IS NOT NULL THEN b.id ELSE NULL END,
      NEW.date,
      '2f',
      NEW.site_id
    FROM (SELECT NEW.responsable_2f_id as id) AS resp
    LEFT JOIN public.secretaires s ON s.id = resp.id
    LEFT JOIN public.backup b ON b.id = resp.id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trigger_sync_assignations_1r_2f_new
  AFTER INSERT OR UPDATE ON public.planning_genere
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_assignations_1r_2f_new();