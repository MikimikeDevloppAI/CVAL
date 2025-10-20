-- Fonction pour splitter "toute_journee" en "matin" + "apres_midi" pour capacite_effective
CREATE OR REPLACE FUNCTION public.split_toute_journee_capacite()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.demi_journee = 'toute_journee' THEN
    -- Insérer le créneau matin
    INSERT INTO public.capacite_effective (
      date, secretaire_id, demi_journee, site_id, actif
    ) VALUES (
      NEW.date, NEW.secretaire_id, 'matin'::demi_journee, NEW.site_id, NEW.actif
    ) ON CONFLICT DO NOTHING;
    
    -- Insérer le créneau après-midi
    INSERT INTO public.capacite_effective (
      date, secretaire_id, demi_journee, site_id, actif
    ) VALUES (
      NEW.date, NEW.secretaire_id, 'apres_midi'::demi_journee, NEW.site_id, NEW.actif
    ) ON CONFLICT DO NOTHING;
    
    -- Bloquer l'insertion de la ligne "toute_journee"
    RETURN NULL;
  END IF;
  
  -- Si ce n'est pas "toute_journee", laisser passer normalement
  RETURN NEW;
END;
$$;

-- Fonction pour splitter "toute_journee" en "matin" + "apres_midi" pour besoin_effectif
CREATE OR REPLACE FUNCTION public.split_toute_journee_besoin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.demi_journee = 'toute_journee' THEN
    -- Insérer le créneau matin
    INSERT INTO public.besoin_effectif (
      date, type, medecin_id, site_id, demi_journee, 
      type_intervention_id, actif
    ) VALUES (
      NEW.date, NEW.type, NEW.medecin_id, NEW.site_id, 'matin'::demi_journee,
      NEW.type_intervention_id, NEW.actif
    ) ON CONFLICT DO NOTHING;
    
    -- Insérer le créneau après-midi
    INSERT INTO public.besoin_effectif (
      date, type, medecin_id, site_id, demi_journee,
      type_intervention_id, actif
    ) VALUES (
      NEW.date, NEW.type, NEW.medecin_id, NEW.site_id, 'apres_midi'::demi_journee,
      NEW.type_intervention_id, NEW.actif
    ) ON CONFLICT DO NOTHING;
    
    -- Bloquer l'insertion de la ligne "toute_journee"
    RETURN NULL;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Créer des tables temporaires pour stocker les données "toute_journee"
CREATE TEMP TABLE temp_capacite AS
SELECT date, secretaire_id, site_id, actif
FROM public.capacite_effective
WHERE demi_journee = 'toute_journee';

CREATE TEMP TABLE temp_besoin AS
SELECT date, type, medecin_id, site_id, type_intervention_id, actif
FROM public.besoin_effectif
WHERE demi_journee = 'toute_journee';

-- Supprimer les lignes "toute_journee" des tables originales
DELETE FROM public.capacite_effective WHERE demi_journee = 'toute_journee';
DELETE FROM public.besoin_effectif WHERE demi_journee = 'toute_journee';

-- Insérer les versions "matin" depuis les tables temporaires
INSERT INTO public.capacite_effective (date, secretaire_id, demi_journee, site_id, actif)
SELECT date, secretaire_id, 'matin'::demi_journee, site_id, actif
FROM temp_capacite
ON CONFLICT DO NOTHING;

INSERT INTO public.besoin_effectif (date, type, medecin_id, site_id, demi_journee, type_intervention_id, actif)
SELECT date, type, medecin_id, site_id, 'matin'::demi_journee, type_intervention_id, actif
FROM temp_besoin
ON CONFLICT DO NOTHING;

-- Insérer les versions "apres_midi" depuis les tables temporaires
INSERT INTO public.capacite_effective (date, secretaire_id, demi_journee, site_id, actif)
SELECT date, secretaire_id, 'apres_midi'::demi_journee, site_id, actif
FROM temp_capacite
ON CONFLICT DO NOTHING;

INSERT INTO public.besoin_effectif (date, type, medecin_id, site_id, demi_journee, type_intervention_id, actif)
SELECT date, type, medecin_id, site_id, 'apres_midi'::demi_journee, type_intervention_id, actif
FROM temp_besoin
ON CONFLICT DO NOTHING;

-- Supprimer les tables temporaires
DROP TABLE temp_capacite;
DROP TABLE temp_besoin;

-- Créer les triggers de split automatique
DROP TRIGGER IF EXISTS trigger_split_toute_journee_capacite ON public.capacite_effective;
CREATE TRIGGER trigger_split_toute_journee_capacite
  BEFORE INSERT OR UPDATE ON public.capacite_effective
  FOR EACH ROW
  EXECUTE FUNCTION public.split_toute_journee_capacite();

DROP TRIGGER IF EXISTS trigger_split_toute_journee_besoin ON public.besoin_effectif;
CREATE TRIGGER trigger_split_toute_journee_besoin
  BEFORE INSERT OR UPDATE ON public.besoin_effectif
  FOR EACH ROW
  EXECUTE FUNCTION public.split_toute_journee_besoin();