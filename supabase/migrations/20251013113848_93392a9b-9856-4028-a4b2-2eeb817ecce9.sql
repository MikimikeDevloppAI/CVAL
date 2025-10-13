-- Ajouter la colonne periode aux tables de planning généré
ALTER TABLE public.planning_genere_bloc_operatoire
ADD COLUMN periode demi_journee;

ALTER TABLE public.planning_genere_site
ADD COLUMN periode demi_journee;

-- Rendre les heures nullable
ALTER TABLE public.planning_genere_bloc_operatoire
ALTER COLUMN heure_debut DROP NOT NULL,
ALTER COLUMN heure_fin DROP NOT NULL;

ALTER TABLE public.planning_genere_site
ALTER COLUMN heure_debut DROP NOT NULL,
ALTER COLUMN heure_fin DROP NOT NULL;

-- Mettre à jour les données existantes (optionnel, pour la compatibilité)
UPDATE public.planning_genere_bloc_operatoire
SET periode = CASE
  WHEN heure_debut < '13:00:00'::time THEN 'matin'::demi_journee
  ELSE 'apres_midi'::demi_journee
END
WHERE periode IS NULL;

UPDATE public.planning_genere_site
SET periode = CASE
  WHEN heure_debut < '13:00:00'::time THEN 'matin'::demi_journee
  ELSE 'apres_midi'::demi_journee
END
WHERE periode IS NULL;

-- Rendre la colonne periode NOT NULL après avoir mis à jour les données
ALTER TABLE public.planning_genere_bloc_operatoire
ALTER COLUMN periode SET NOT NULL;

ALTER TABLE public.planning_genere_site
ALTER COLUMN periode SET NOT NULL;