-- ============================================
-- SEED DATA for Supabase Branching
-- ============================================

-- Insert specialités
INSERT INTO public.specialites (nom, code) VALUES
  ('Cardiologie', 'CARDIO'),
  ('Neurologie', 'NEURO'),
  ('Pédiatrie', 'PEDIA'),
  ('Orthopédie', 'ORTHO'),
  ('Radiologie', 'RADIO')
ON CONFLICT DO NOTHING;

-- Insert sites (using specialite codes to find IDs)
INSERT INTO public.sites (nom, adresse, actif, specialite_id, fermeture)
SELECT 
  'Clinique La Vallée - Site Principal',
  '123 Avenue de la Santé, 75001 Paris',
  true,
  (SELECT id FROM public.specialites WHERE code = 'CARDIO' LIMIT 1),
  false
WHERE NOT EXISTS (SELECT 1 FROM public.sites WHERE nom = 'Clinique La Vallée - Site Principal');

INSERT INTO public.sites (nom, adresse, actif, specialite_id, fermeture)
SELECT 
  'Clinique La Vallée - Bloc opératoire',
  '123 Avenue de la Santé, 75001 Paris',
  true,
  (SELECT id FROM public.specialites WHERE code = 'ORTHO' LIMIT 1),
  false
WHERE NOT EXISTS (SELECT 1 FROM public.sites WHERE nom = 'Clinique La Vallée - Bloc opératoire');

INSERT INTO public.sites (nom, adresse, actif, specialite_id, fermeture)
SELECT 
  'Clinique Port-en-Truie',
  '456 Rue de la Mer, 44000 Nantes',
  true,
  (SELECT id FROM public.specialites WHERE code = 'NEURO' LIMIT 1),
  false
WHERE NOT EXISTS (SELECT 1 FROM public.sites WHERE nom = 'Clinique Port-en-Truie');
