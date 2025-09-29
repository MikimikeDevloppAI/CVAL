-- Add new columns to medecins table
ALTER TABLE public.medecins 
ADD COLUMN first_name TEXT,
ADD COLUMN name TEXT,
ADD COLUMN email TEXT,
ADD COLUMN phone_number TEXT;

-- Insert doctors with their specialties
-- First, let's get the specialty IDs we need

-- Insert doctors - ophtalmologie
INSERT INTO public.medecins (first_name, name, specialite_id, email, phone_number)
SELECT 
  'Claude', 'Dr Schwarz', s.id, '', ''
FROM public.specialites s 
WHERE LOWER(s.nom) LIKE '%ophtalmologie%'
LIMIT 1;

INSERT INTO public.medecins (first_name, name, specialite_id, email, phone_number)
SELECT 
  'Bertrand', 'Dr Pilly', s.id, '', ''
FROM public.specialites s 
WHERE LOWER(s.nom) LIKE '%ophtalmologie%'
LIMIT 1;

INSERT INTO public.medecins (first_name, name, specialite_id, email, phone_number)
SELECT 
  'Dimiter', 'Dr Bertschinger', s.id, '', ''
FROM public.specialites s 
WHERE LOWER(s.nom) LIKE '%ophtalmologie%'
LIMIT 1;

INSERT INTO public.medecins (first_name, name, specialite_id, email, phone_number)
SELECT 
  'Massimo', 'Dr Vento', s.id, '', ''
FROM public.specialites s 
WHERE LOWER(s.nom) LIKE '%ophtalmologie%'
LIMIT 1;

INSERT INTO public.medecins (first_name, name, specialite_id, email, phone_number)
SELECT 
  'Paul', 'Dr Jacquier', s.id, '', ''
FROM public.specialites s 
WHERE LOWER(s.nom) LIKE '%ophtalmologie%'
LIMIT 1;

INSERT INTO public.medecins (first_name, name, specialite_id, email, phone_number)
SELECT 
  'Sonia', 'Dresse Kerkour', s.id, '', ''
FROM public.specialites s 
WHERE LOWER(s.nom) LIKE '%ophtalmologie%'
LIMIT 1;

INSERT INTO public.medecins (first_name, name, specialite_id, email, phone_number)
SELECT 
  'Soydan', 'Dr Kurun', s.id, '', ''
FROM public.specialites s 
WHERE LOWER(s.nom) LIKE '%ophtalmologie%'
LIMIT 1;

INSERT INTO public.medecins (first_name, name, specialite_id, email, phone_number)
SELECT 
  'Vasilios', 'Dr Papastefanou', s.id, '', ''
FROM public.specialites s 
WHERE LOWER(s.nom) LIKE '%ophtalmologie%'
LIMIT 1;

-- Insert doctors - dermatologie
INSERT INTO public.medecins (first_name, name, specialite_id, email, phone_number)
SELECT 
  'Aleksandar', 'Pr Krunic', s.id, '', ''
FROM public.specialites s 
WHERE LOWER(s.nom) LIKE '%dermatologie%'
LIMIT 1;

INSERT INTO public.medecins (first_name, name, specialite_id, email, phone_number)
SELECT 
  'Anna-Maria', 'Forster', s.id, '', ''
FROM public.specialites s 
WHERE LOWER(s.nom) LIKE '%dermatologie%'
LIMIT 1;

-- Insert doctors - orthoptie
INSERT INTO public.medecins (first_name, name, specialite_id, email, phone_number)
SELECT 
  'Amandine', 'Ablitzer', s.id, '', ''
FROM public.specialites s 
WHERE LOWER(s.nom) LIKE '%orthoptie%'
LIMIT 1;

-- Insert doctors - gynécologie
INSERT INTO public.medecins (first_name, name, specialite_id, email, phone_number)
SELECT 
  'Bogdan', 'Dr Popescu', s.id, '', ''
FROM public.specialites s 
WHERE LOWER(s.nom) LIKE '%gynécologie%' OR LOWER(s.nom) LIKE '%gynecologie%'
LIMIT 1;

-- Insert doctors - ORL
INSERT INTO public.medecins (first_name, name, specialite_id, email, phone_number)
SELECT 
  'Chiara', 'Dre Rosato', s.id, '', ''
FROM public.specialites s 
WHERE LOWER(s.nom) LIKE '%orl%'
LIMIT 1;

INSERT INTO public.medecins (first_name, name, specialite_id, email, phone_number)
SELECT 
  'Lluis Ezra', 'Dr Nisa', s.id, '', ''
FROM public.specialites s 
WHERE LOWER(s.nom) LIKE '%orl%'
LIMIT 1;

-- Insert doctors - gastroentérologie
INSERT INTO public.medecins (first_name, name, specialite_id, email, phone_number)
SELECT 
  'Dimitrios', 'Dr Polyzois', s.id, '', ''
FROM public.specialites s 
WHERE LOWER(s.nom) LIKE '%gastroentérologie%' OR LOWER(s.nom) LIKE '%gastroenterologie%'
LIMIT 1;

INSERT INTO public.medecins (first_name, name, specialite_id, email, phone_number)
SELECT 
  'Florian', 'Pr Froehlich', s.id, '', ''
FROM public.specialites s 
WHERE LOWER(s.nom) LIKE '%gastroentérologie%' OR LOWER(s.nom) LIKE '%gastroenterologie%'
LIMIT 1;

INSERT INTO public.medecins (first_name, name, specialite_id, email, phone_number)
SELECT 
  'Serge', 'Dr Zeeh', s.id, '', ''
FROM public.specialites s 
WHERE LOWER(s.nom) LIKE '%gastroentérologie%' OR LOWER(s.nom) LIKE '%gastroenterologie%'
LIMIT 1;

-- Insert doctors - angiologie
INSERT INTO public.medecins (first_name, name, specialite_id, email, phone_number)
SELECT 
  'Michèle', 'Dr Depairon', s.id, '', ''
FROM public.specialites s 
WHERE LOWER(s.nom) LIKE '%angiologie%'
LIMIT 1;

-- Insert doctors - rhumatologie
INSERT INTO public.medecins (first_name, name, specialite_id, email, phone_number)
SELECT 
  'Rui', 'Dr De Melo', s.id, '', ''
FROM public.specialites s 
WHERE LOWER(s.nom) LIKE '%rhumatologie%'
LIMIT 1;

-- Insert doctors - anesthésiologie
INSERT INTO public.medecins (first_name, name, specialite_id, email, phone_number)
SELECT 
  'Felix', 'Dr Lutz', s.id, '', ''
FROM public.specialites s 
WHERE LOWER(s.nom) LIKE '%anesthésiologie%' OR LOWER(s.nom) LIKE '%anesthesiologie%'
LIMIT 1;