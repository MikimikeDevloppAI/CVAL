-- Création de 10 secrétaires avec horaires variés

DO $$
DECLARE
  v_secretaire_id uuid;
BEGIN
  -- Secrétaire 1: Temps plein (lundi à vendredi), Ophtalmologie + ORL
  INSERT INTO public.secretaires (first_name, name, email, phone_number, specialites, actif)
  VALUES ('Sophie', 'Martin', 'sophie.martin@clinique.fr', '0601020304', 
          ARRAY['20765751-3371-4931-9be1-67b05d743d3d'::uuid, 'c953b795-f4ce-41ff-aae4-2c4af0211102'::uuid], true)
  RETURNING id INTO v_secretaire_id;
  
  INSERT INTO public.horaires_base_secretaires (secretaire_id, jour_semaine, heure_debut, heure_fin, actif, type)
  VALUES 
    (v_secretaire_id, 1, '07:30', '17:30', true, 'fixe'),
    (v_secretaire_id, 2, '07:30', '17:30', true, 'fixe'),
    (v_secretaire_id, 3, '07:30', '17:30', true, 'fixe'),
    (v_secretaire_id, 4, '07:30', '17:30', true, 'fixe'),
    (v_secretaire_id, 5, '07:30', '17:30', true, 'fixe');

  -- Secrétaire 2: Temps plein, Dermatologie uniquement
  INSERT INTO public.secretaires (first_name, name, email, phone_number, specialites, actif)
  VALUES ('Marie', 'Dubois', 'marie.dubois@clinique.fr', '0601020305', 
          ARRAY['eecd7fb0-2677-4457-b8d0-ea9c2959bc5e'::uuid], true)
  RETURNING id INTO v_secretaire_id;
  
  INSERT INTO public.horaires_base_secretaires (secretaire_id, jour_semaine, heure_debut, heure_fin, actif, type)
  VALUES 
    (v_secretaire_id, 1, '07:30', '17:30', true, 'fixe'),
    (v_secretaire_id, 2, '07:30', '17:30', true, 'fixe'),
    (v_secretaire_id, 3, '07:30', '17:30', true, 'fixe'),
    (v_secretaire_id, 4, '07:30', '17:30', true, 'fixe'),
    (v_secretaire_id, 5, '07:30', '17:30', true, 'fixe');

  -- Secrétaire 3: Temps partiel (lundi, mercredi, vendredi), Gynécologie + Rhumatologie
  INSERT INTO public.secretaires (first_name, name, email, phone_number, specialites, actif)
  VALUES ('Claire', 'Bernard', 'claire.bernard@clinique.fr', '0601020306', 
          ARRAY['a1f51bf2-add8-445f-b815-76a32fb1d256'::uuid, 'dc5b934c-5fa2-4cee-8f7b-a06147114931'::uuid], true)
  RETURNING id INTO v_secretaire_id;
  
  INSERT INTO public.horaires_base_secretaires (secretaire_id, jour_semaine, heure_debut, heure_fin, actif, type)
  VALUES 
    (v_secretaire_id, 1, '07:30', '17:30', true, 'fixe'),
    (v_secretaire_id, 3, '07:30', '17:30', true, 'fixe'),
    (v_secretaire_id, 5, '07:30', '17:30', true, 'fixe');

  -- Secrétaire 4: Temps plein, Gastroentérologie + Angiologie
  INSERT INTO public.secretaires (first_name, name, email, phone_number, specialites, actif)
  VALUES ('Laura', 'Petit', 'laura.petit@clinique.fr', '0601020307', 
          ARRAY['5a89afc2-a4ae-4499-a0e5-996a0a682f61'::uuid, '0968c1e3-49b2-405c-9601-a112767c2b28'::uuid], true)
  RETURNING id INTO v_secretaire_id;
  
  INSERT INTO public.horaires_base_secretaires (secretaire_id, jour_semaine, heure_debut, heure_fin, actif, type)
  VALUES 
    (v_secretaire_id, 1, '07:30', '17:30', true, 'fixe'),
    (v_secretaire_id, 2, '07:30', '17:30', true, 'fixe'),
    (v_secretaire_id, 3, '07:30', '17:30', true, 'fixe'),
    (v_secretaire_id, 4, '07:30', '17:30', true, 'fixe'),
    (v_secretaire_id, 5, '07:30', '17:30', true, 'fixe');

  -- Secrétaire 5: Temps partiel (mardi, jeudi), Ophtalmologie uniquement
  INSERT INTO public.secretaires (first_name, name, email, phone_number, specialites, actif)
  VALUES ('Julie', 'Roux', 'julie.roux@clinique.fr', '0601020308', 
          ARRAY['20765751-3371-4931-9be1-67b05d743d3d'::uuid], true)
  RETURNING id INTO v_secretaire_id;
  
  INSERT INTO public.horaires_base_secretaires (secretaire_id, jour_semaine, heure_debut, heure_fin, actif, type)
  VALUES 
    (v_secretaire_id, 2, '07:30', '17:30', true, 'fixe'),
    (v_secretaire_id, 4, '07:30', '17:30', true, 'fixe');

  -- Secrétaire 6: Temps plein, Toutes spécialités (polyvalente)
  INSERT INTO public.secretaires (first_name, name, email, phone_number, specialites, actif)
  VALUES ('Emma', 'Moreau', 'emma.moreau@clinique.fr', '0601020309', 
          ARRAY['20765751-3371-4931-9be1-67b05d743d3d'::uuid, 'c953b795-f4ce-41ff-aae4-2c4af0211102'::uuid, 
                'eecd7fb0-2677-4457-b8d0-ea9c2959bc5e'::uuid, 'a1f51bf2-add8-445f-b815-76a32fb1d256'::uuid], true)
  RETURNING id INTO v_secretaire_id;
  
  INSERT INTO public.horaires_base_secretaires (secretaire_id, jour_semaine, heure_debut, heure_fin, actif, type)
  VALUES 
    (v_secretaire_id, 1, '07:30', '17:30', true, 'fixe'),
    (v_secretaire_id, 2, '07:30', '17:30', true, 'fixe'),
    (v_secretaire_id, 3, '07:30', '17:30', true, 'fixe'),
    (v_secretaire_id, 4, '07:30', '17:30', true, 'fixe'),
    (v_secretaire_id, 5, '07:30', '17:30', true, 'fixe');

  -- Secrétaire 7: Temps partiel (lundi, mardi, jeudi), ORL + Dermatologie
  INSERT INTO public.secretaires (first_name, name, email, phone_number, specialites, actif)
  VALUES ('Camille', 'Simon', 'camille.simon@clinique.fr', '0601020310', 
          ARRAY['c953b795-f4ce-41ff-aae4-2c4af0211102'::uuid, 'eecd7fb0-2677-4457-b8d0-ea9c2959bc5e'::uuid], true)
  RETURNING id INTO v_secretaire_id;
  
  INSERT INTO public.horaires_base_secretaires (secretaire_id, jour_semaine, heure_debut, heure_fin, actif, type)
  VALUES 
    (v_secretaire_id, 1, '07:30', '17:30', true, 'fixe'),
    (v_secretaire_id, 2, '07:30', '17:30', true, 'fixe'),
    (v_secretaire_id, 4, '07:30', '17:30', true, 'fixe');

  -- Secrétaire 8: Temps plein, Rhumatologie + Gastroentérologie
  INSERT INTO public.secretaires (first_name, name, email, phone_number, specialites, actif)
  VALUES ('Sarah', 'Laurent', 'sarah.laurent@clinique.fr', '0601020311', 
          ARRAY['dc5b934c-5fa2-4cee-8f7b-a06147114931'::uuid, '5a89afc2-a4ae-4499-a0e5-996a0a682f61'::uuid], true)
  RETURNING id INTO v_secretaire_id;
  
  INSERT INTO public.horaires_base_secretaires (secretaire_id, jour_semaine, heure_debut, heure_fin, actif, type)
  VALUES 
    (v_secretaire_id, 1, '07:30', '17:30', true, 'fixe'),
    (v_secretaire_id, 2, '07:30', '17:30', true, 'fixe'),
    (v_secretaire_id, 3, '07:30', '17:30', true, 'fixe'),
    (v_secretaire_id, 4, '07:30', '17:30', true, 'fixe'),
    (v_secretaire_id, 5, '07:30', '17:30', true, 'fixe');

  -- Secrétaire 9: Temps partiel (mercredi, jeudi, vendredi), Angiologie uniquement
  INSERT INTO public.secretaires (first_name, name, email, phone_number, specialites, actif)
  VALUES ('Lucie', 'Michel', 'lucie.michel@clinique.fr', '0601020312', 
          ARRAY['0968c1e3-49b2-405c-9601-a112767c2b28'::uuid], true)
  RETURNING id INTO v_secretaire_id;
  
  INSERT INTO public.horaires_base_secretaires (secretaire_id, jour_semaine, heure_debut, heure_fin, actif, type)
  VALUES 
    (v_secretaire_id, 3, '07:30', '17:30', true, 'fixe'),
    (v_secretaire_id, 4, '07:30', '17:30', true, 'fixe'),
    (v_secretaire_id, 5, '07:30', '17:30', true, 'fixe');

  -- Secrétaire 10: Temps plein, Gynécologie + Ophtalmologie + Dermatologie
  INSERT INTO public.secretaires (first_name, name, email, phone_number, specialites, actif)
  VALUES ('Léa', 'Garcia', 'lea.garcia@clinique.fr', '0601020313', 
          ARRAY['a1f51bf2-add8-445f-b815-76a32fb1d256'::uuid, '20765751-3371-4931-9be1-67b05d743d3d'::uuid, 
                'eecd7fb0-2677-4457-b8d0-ea9c2959bc5e'::uuid], true)
  RETURNING id INTO v_secretaire_id;
  
  INSERT INTO public.horaires_base_secretaires (secretaire_id, jour_semaine, heure_debut, heure_fin, actif, type)
  VALUES 
    (v_secretaire_id, 1, '07:30', '17:30', true, 'fixe'),
    (v_secretaire_id, 2, '07:30', '17:30', true, 'fixe'),
    (v_secretaire_id, 3, '07:30', '17:30', true, 'fixe'),
    (v_secretaire_id, 4, '07:30', '17:30', true, 'fixe'),
    (v_secretaire_id, 5, '07:30', '17:30', true, 'fixe');
END $$;

-- Désactiver temporairement le trigger de vérification des chevauchements
ALTER TABLE public.capacite_effective DISABLE TRIGGER trigger_check_capacite_effective_overlap;

-- Supprimer toutes les capacités effectives existantes et régénérer
DELETE FROM public.capacite_effective;
SELECT public.generate_capacite_effective();

-- Réactiver le trigger
ALTER TABLE public.capacite_effective ENABLE TRIGGER trigger_check_capacite_effective_overlap;