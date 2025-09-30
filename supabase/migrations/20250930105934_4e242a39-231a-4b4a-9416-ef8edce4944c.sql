-- Mettre à jour tous les horaires de base des médecins
-- Pour qu'ils commencent à 07:30 et finissent à 17:30
UPDATE public.horaires_base_medecins
SET 
  heure_debut = '07:30:00'::time,
  heure_fin = '17:30:00'::time,
  updated_at = NOW()
WHERE actif = true;