-- Créer la table d'historique des assignations 1R/2F
CREATE TABLE IF NOT EXISTS public.assignations_1r_2f_historique (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  secretaire_id UUID REFERENCES public.secretaires(id) ON DELETE CASCADE,
  backup_id UUID REFERENCES public.backup(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  type_assignation TEXT NOT NULL CHECK (type_assignation IN ('1r', '2f')),
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Contrainte : soit secretaire_id soit backup_id doit être renseigné
  CONSTRAINT check_either_secretaire_or_backup CHECK (
    (secretaire_id IS NOT NULL AND backup_id IS NULL) OR
    (secretaire_id IS NULL AND backup_id IS NOT NULL)
  )
);

-- Index pour optimiser les requêtes historiques
CREATE INDEX idx_assignations_1r_2f_date ON public.assignations_1r_2f_historique(date);
CREATE INDEX idx_assignations_1r_2f_secretaire ON public.assignations_1r_2f_historique(secretaire_id);
CREATE INDEX idx_assignations_1r_2f_backup ON public.assignations_1r_2f_historique(backup_id);
CREATE INDEX idx_assignations_1r_2f_site ON public.assignations_1r_2f_historique(site_id);

-- Ajouter les colonnes is_1r et is_2f à planning_genere
ALTER TABLE public.planning_genere 
ADD COLUMN IF NOT EXISTS is_1r BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS is_2f BOOLEAN DEFAULT false;

-- Enable RLS
ALTER TABLE public.assignations_1r_2f_historique ENABLE ROW LEVEL SECURITY;

-- Politiques RLS pour assignations_1r_2f_historique
CREATE POLICY "Admins can manage assignations 1r/2f historique"
  ON public.assignations_1r_2f_historique
  FOR ALL
  USING (public.is_admin());

CREATE POLICY "Users can view assignations 1r/2f historique"
  ON public.assignations_1r_2f_historique
  FOR SELECT
  USING (true);

-- Trigger pour alimenter automatiquement l'historique depuis planning_genere
CREATE OR REPLACE FUNCTION public.sync_assignations_1r_2f_historique()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Supprimer les anciennes entrées pour cette personne à cette date
  DELETE FROM public.assignations_1r_2f_historique
  WHERE date = NEW.date
    AND site_id = NEW.site_id
    AND (
      (NEW.secretaire_id IS NOT NULL AND secretaire_id = NEW.secretaire_id) OR
      (NEW.backup_id IS NOT NULL AND backup_id = NEW.backup_id)
    );
  
  -- Insérer 1R si applicable
  IF NEW.is_1r = true THEN
    INSERT INTO public.assignations_1r_2f_historique (
      secretaire_id, backup_id, date, type_assignation, site_id
    ) VALUES (
      NEW.secretaire_id, NEW.backup_id, NEW.date, '1r', NEW.site_id
    );
  END IF;
  
  -- Insérer 2F si applicable
  IF NEW.is_2f = true THEN
    INSERT INTO public.assignations_1r_2f_historique (
      secretaire_id, backup_id, date, type_assignation, site_id
    ) VALUES (
      NEW.secretaire_id, NEW.backup_id, NEW.date, '2f', NEW.site_id
    );
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_sync_assignations_1r_2f
  AFTER INSERT OR UPDATE ON public.planning_genere
  FOR EACH ROW
  WHEN (NEW.is_1r = true OR NEW.is_2f = true)
  EXECUTE FUNCTION public.sync_assignations_1r_2f_historique();

-- Nettoyer l'historique au-delà de 4 semaines automatiquement
CREATE OR REPLACE FUNCTION public.cleanup_old_assignations_1r_2f()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.assignations_1r_2f_historique
  WHERE date < CURRENT_DATE - INTERVAL '4 weeks';
END;
$$;