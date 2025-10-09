-- Insérer toutes les secrétaires avec spécialité dermatologie
DO $$
DECLARE
  v_dermatologie_id UUID;
BEGIN
  -- Récupérer l'ID de la spécialité dermatologie
  SELECT id INTO v_dermatologie_id FROM public.specialites WHERE nom ILIKE '%dermat%' LIMIT 1;
  
  IF v_dermatologie_id IS NULL THEN
    -- Créer la spécialité si elle n'existe pas
    INSERT INTO public.specialites (nom, code) VALUES ('Dermatologie', 'DERM') RETURNING id INTO v_dermatologie_id;
  END IF;

  -- Insérer toutes les secrétaires
  INSERT INTO public.secretaires (first_name, name, specialites, actif) VALUES
    ('Sabrina', 'Schlüchter', ARRAY[v_dermatologie_id], true),
    ('Adéline', 'Vural', ARRAY[v_dermatologie_id], true),
    ('Lucie', 'Vanni', ARRAY[v_dermatologie_id], true),
    ('Mélanie', 'Joray', ARRAY[v_dermatologie_id], true),
    ('Christine', 'Ribeaud', ARRAY[v_dermatologie_id], true),
    ('Cynthia', 'Zimmermann', ARRAY[v_dermatologie_id], true),
    ('Florence', 'Bron', ARRAY[v_dermatologie_id], true),
    ('Gaëlle', 'Jeannerat', ARRAY[v_dermatologie_id], true),
    ('Julianne', 'Kunz', ARRAY[v_dermatologie_id], true),
    ('Léna', 'Jurot', ARRAY[v_dermatologie_id], true),
    ('Loïs', 'Lambelet', ARRAY[v_dermatologie_id], true),
    ('Maryline', 'Cattin', ARRAY[v_dermatologie_id], true),
    ('Mathilde', 'Etique', ARRAY[v_dermatologie_id], true),
    ('Meliha', 'Filieri', ARRAY[v_dermatologie_id], true),
    ('Mirlinda', 'Hasani', ARRAY[v_dermatologie_id], true),
    ('Sarah', 'Bortolon', ARRAY[v_dermatologie_id], true),
    ('Stéphanie', 'Kaufmann', ARRAY[v_dermatologie_id], true),
    ('Vivianne', 'Lovis', ARRAY[v_dermatologie_id], true),
    ('Aurélie', 'Nusbaumer', ARRAY[v_dermatologie_id], true),
    ('Gilles', 'Mourey', ARRAY[v_dermatologie_id], true),
    ('Inès', 'Ramseier', ARRAY[v_dermatologie_id], true),
    ('Laura', 'Spring', ARRAY[v_dermatologie_id], true),
    ('Lucie', 'Pratillo', ARRAY[v_dermatologie_id], true),
    ('Stéphanie', 'Guillaume', ARRAY[v_dermatologie_id], true),
    ('Alexandrine', 'Fleury', ARRAY[v_dermatologie_id], true)
  ON CONFLICT DO NOTHING;
END $$;