-- Créer des horaires de base pour tous les médecins sans horaires
-- Lundi à Vendredi, 08:00 - 18:00, sur un site correspondant à leur spécialité

-- Ophtalmologie - Dimiter Bertschinger (Centre Esplanade)
INSERT INTO public.horaires_base_medecins (medecin_id, jour_semaine, heure_debut, heure_fin, site_id, alternance_type, alternance_semaine_reference, actif)
SELECT 
  '105863da-7f7c-400e-bfb3-6af530b208f6'::uuid,
  jour,
  '08:00:00'::time,
  '18:00:00'::time,
  '043899a1-a232-4c4b-9d7d-0eb44dad00ad'::uuid,
  'hebdomadaire'::type_alternance,
  CURRENT_DATE,
  true
FROM generate_series(1, 5) as jour;

-- Rhumatologie - Rui De Melo
INSERT INTO public.horaires_base_medecins (medecin_id, jour_semaine, heure_debut, heure_fin, site_id, alternance_type, alternance_semaine_reference, actif)
SELECT 
  '7628a2e3-7196-4a88-8b28-14de2aee47c3'::uuid,
  jour,
  '08:00:00'::time,
  '18:00:00'::time,
  '0e1b316e-eb75-48f9-9e52-bed9a4ca0e9d'::uuid,
  'hebdomadaire'::type_alternance,
  CURRENT_DATE,
  true
FROM generate_series(1, 5) as jour;

-- Angiologie - Michèle Depairon
INSERT INTO public.horaires_base_medecins (medecin_id, jour_semaine, heure_debut, heure_fin, site_id, alternance_type, alternance_semaine_reference, actif)
SELECT 
  '1f84c9cc-619b-49b7-a1bc-5e69263cd5a6'::uuid,
  jour,
  '08:00:00'::time,
  '18:00:00'::time,
  'c3bd1381-e957-4f7e-8b49-5c848133181c'::uuid,
  'hebdomadaire'::type_alternance,
  CURRENT_DATE,
  true
FROM generate_series(1, 5) as jour;

-- Gastroentérologie - Florian Froehlich
INSERT INTO public.horaires_base_medecins (medecin_id, jour_semaine, heure_debut, heure_fin, site_id, alternance_type, alternance_semaine_reference, actif)
SELECT 
  '19ed6f3f-d738-4ef7-9b2f-9f8b6615b683'::uuid,
  jour,
  '08:00:00'::time,
  '18:00:00'::time,
  '7723c334-d06c-413d-96f0-be281d76520d'::uuid,
  'hebdomadaire'::type_alternance,
  CURRENT_DATE,
  true
FROM generate_series(1, 5) as jour;

-- Ophtalmologie - Paul Jacquier (Clinique La Vallée)
INSERT INTO public.horaires_base_medecins (medecin_id, jour_semaine, heure_debut, heure_fin, site_id, alternance_type, alternance_semaine_reference, actif)
SELECT 
  '121dc7d9-99dc-46bd-9b6c-d240ac6dc6c8'::uuid,
  jour,
  '08:00:00'::time,
  '18:00:00'::time,
  '7c8abe96-0a6b-44eb-857f-ad69036ebc88'::uuid,
  'hebdomadaire'::type_alternance,
  CURRENT_DATE,
  true
FROM generate_series(1, 5) as jour;

-- Ophtalmologie - Soydan Kurun (Centre Esplanade)
INSERT INTO public.horaires_base_medecins (medecin_id, jour_semaine, heure_debut, heure_fin, site_id, alternance_type, alternance_semaine_reference, actif)
SELECT 
  '4b147934-ce54-4444-8741-b46ee6fc5d46'::uuid,
  jour,
  '08:00:00'::time,
  '18:00:00'::time,
  '043899a1-a232-4c4b-9d7d-0eb44dad00ad'::uuid,
  'hebdomadaire'::type_alternance,
  CURRENT_DATE,
  true
FROM generate_series(1, 5) as jour;

-- ORL - Lluis Ezra Nisa
INSERT INTO public.horaires_base_medecins (medecin_id, jour_semaine, heure_debut, heure_fin, site_id, alternance_type, alternance_semaine_reference, actif)
SELECT 
  '0a384f2b-c537-45ba-8873-578f7d99362e'::uuid,
  jour,
  '08:00:00'::time,
  '18:00:00'::time,
  'cb84cedb-d355-48ce-bd00-fff1660f9d03'::uuid,
  'hebdomadaire'::type_alternance,
  CURRENT_DATE,
  true
FROM generate_series(1, 5) as jour;

-- Ophtalmologie - Vasilios Papastefanou (Clinique La Vallée)
INSERT INTO public.horaires_base_medecins (medecin_id, jour_semaine, heure_debut, heure_fin, site_id, alternance_type, alternance_semaine_reference, actif)
SELECT 
  'e779dc79-fa01-4b55-982f-79f9dfa6dc55'::uuid,
  jour,
  '08:00:00'::time,
  '18:00:00'::time,
  '7c8abe96-0a6b-44eb-857f-ad69036ebc88'::uuid,
  'hebdomadaire'::type_alternance,
  CURRENT_DATE,
  true
FROM generate_series(1, 5) as jour;

-- Ophtalmologie - Bertrand Pilly (Centre Esplanade)
INSERT INTO public.horaires_base_medecins (medecin_id, jour_semaine, heure_debut, heure_fin, site_id, alternance_type, alternance_semaine_reference, actif)
SELECT 
  '69989652-1ae3-47d8-be70-5272e6212507'::uuid,
  jour,
  '08:00:00'::time,
  '18:00:00'::time,
  '043899a1-a232-4c4b-9d7d-0eb44dad00ad'::uuid,
  'hebdomadaire'::type_alternance,
  CURRENT_DATE,
  true
FROM generate_series(1, 5) as jour;

-- Gastroentérologie - Dimitrios Polyzois
INSERT INTO public.horaires_base_medecins (medecin_id, jour_semaine, heure_debut, heure_fin, site_id, alternance_type, alternance_semaine_reference, actif)
SELECT 
  'ad510eda-f310-4004-b37a-a88210037304'::uuid,
  jour,
  '08:00:00'::time,
  '18:00:00'::time,
  '7723c334-d06c-413d-96f0-be281d76520d'::uuid,
  'hebdomadaire'::type_alternance,
  CURRENT_DATE,
  true
FROM generate_series(1, 5) as jour;

-- Gynécologie - Bogdan Popescu
INSERT INTO public.horaires_base_medecins (medecin_id, jour_semaine, heure_debut, heure_fin, site_id, alternance_type, alternance_semaine_reference, actif)
SELECT 
  'fb945632-dcfc-499c-ae99-c67ad1b5cbb5'::uuid,
  jour,
  '08:00:00'::time,
  '18:00:00'::time,
  '2cea24fc-8f81-49ab-b5f1-c5950f4e867c'::uuid,
  'hebdomadaire'::type_alternance,
  CURRENT_DATE,
  true
FROM generate_series(1, 5) as jour;

-- ORL - Chiara Rosato
INSERT INTO public.horaires_base_medecins (medecin_id, jour_semaine, heure_debut, heure_fin, site_id, alternance_type, alternance_semaine_reference, actif)
SELECT 
  '8e1f9c4d-95f5-4eb6-81a4-1e497438d980'::uuid,
  jour,
  '08:00:00'::time,
  '18:00:00'::time,
  'cb84cedb-d355-48ce-bd00-fff1660f9d03'::uuid,
  'hebdomadaire'::type_alternance,
  CURRENT_DATE,
  true
FROM generate_series(1, 5) as jour;

-- Ophtalmologie - Claude Schwarz (Clinique La Vallée)
INSERT INTO public.horaires_base_medecins (medecin_id, jour_semaine, heure_debut, heure_fin, site_id, alternance_type, alternance_semaine_reference, actif)
SELECT 
  '818d4d6a-52d0-4143-86b9-01012b7c7ba6'::uuid,
  jour,
  '08:00:00'::time,
  '18:00:00'::time,
  '7c8abe96-0a6b-44eb-857f-ad69036ebc88'::uuid,
  'hebdomadaire'::type_alternance,
  CURRENT_DATE,
  true
FROM generate_series(1, 5) as jour;

-- Ophtalmologie - Massimo Vento (Centre Esplanade)
INSERT INTO public.horaires_base_medecins (medecin_id, jour_semaine, heure_debut, heure_fin, site_id, alternance_type, alternance_semaine_reference, actif)
SELECT 
  '1612a340-0d79-4fb3-85e9-e5f8b0f4481d'::uuid,
  jour,
  '08:00:00'::time,
  '18:00:00'::time,
  '043899a1-a232-4c4b-9d7d-0eb44dad00ad'::uuid,
  'hebdomadaire'::type_alternance,
  CURRENT_DATE,
  true
FROM generate_series(1, 5) as jour;

-- Gastroentérologie - Serge Zeeh
INSERT INTO public.horaires_base_medecins (medecin_id, jour_semaine, heure_debut, heure_fin, site_id, alternance_type, alternance_semaine_reference, actif)
SELECT 
  'd85b590c-6c5a-4184-aaca-4d89ccefaf78'::uuid,
  jour,
  '08:00:00'::time,
  '18:00:00'::time,
  '7723c334-d06c-413d-96f0-be281d76520d'::uuid,
  'hebdomadaire'::type_alternance,
  CURRENT_DATE,
  true
FROM generate_series(1, 5) as jour;