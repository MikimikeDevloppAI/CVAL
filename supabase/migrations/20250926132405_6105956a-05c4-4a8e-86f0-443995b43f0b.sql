-- Ajouter des données de base pour tester l'application

-- Insérer des spécialités
INSERT INTO public.specialites (nom, code) VALUES 
  ('Cardiologie', 'CARDIO'),
  ('Pneumologie', 'PNEUMO'),
  ('Neurologie', 'NEURO'),
  ('Orthopédie', 'ORTHO'),
  ('Pédiatrie', 'PEDIAT'),
  ('Radiologie', 'RADIO'),
  ('Chirurgie générale', 'CHIR_GEN'),
  ('Médecine générale', 'MED_GEN')
ON CONFLICT (code) DO NOTHING;

-- Insérer des sites
INSERT INTO public.sites (nom, adresse, capacite_max_medecins) VALUES 
  ('Clinique La Vallée - Site Principal', '123 Avenue de la Santé, 75015 Paris', 15),
  ('Clinique La Vallée - Annexe Nord', '456 Rue de la Médecine, 75018 Paris', 8),
  ('Clinique La Vallée - Centre Sud', '789 Boulevard du Soin, 75013 Paris', 12)
ON CONFLICT DO NOTHING;