-- Dupliquer toutes les secrétaires avec leurs horaires de base
DO $$
DECLARE
  v_secretaire RECORD;
  v_new_id uuid;
  v_horaire RECORD;
BEGIN
  -- Pour chaque secrétaire active
  FOR v_secretaire IN 
    SELECT * FROM public.secretaires WHERE actif = true
  LOOP
    -- Générer un nouvel ID
    v_new_id := gen_random_uuid();
    
    -- Insérer la copie de la secrétaire
    INSERT INTO public.secretaires (
      id,
      profile_id,
      specialites,
      site_preferentiel_id,
      nombre_jours_supplementaires,
      flexible_jours_supplementaires,
      prefere_port_en_truie,
      actif,
      name,
      first_name,
      email,
      phone_number
    ) VALUES (
      v_new_id,
      NULL, -- Pas de profile lié pour les copies
      v_secretaire.specialites,
      v_secretaire.site_preferentiel_id,
      v_secretaire.nombre_jours_supplementaires,
      v_secretaire.flexible_jours_supplementaires,
      v_secretaire.prefere_port_en_truie,
      true,
      COALESCE(v_secretaire.name, '') || ' (Copie)',
      COALESCE(v_secretaire.first_name, '') || ' (Copie)',
      NULL, -- Pas d'email pour les copies
      NULL  -- Pas de téléphone pour les copies
    );
    
    -- Copier tous les horaires de base
    FOR v_horaire IN
      SELECT * FROM public.horaires_base_secretaires 
      WHERE secretaire_id = v_secretaire.id AND actif = true
    LOOP
      INSERT INTO public.horaires_base_secretaires (
        secretaire_id,
        jour_semaine,
        heure_debut,
        heure_fin,
        type,
        actif
      ) VALUES (
        v_new_id,
        v_horaire.jour_semaine,
        v_horaire.heure_debut,
        v_horaire.heure_fin,
        v_horaire.type,
        true
      );
    END LOOP;
    
    RAISE NOTICE 'Secrétaire dupliquée: % % -> %', v_secretaire.first_name, v_secretaire.name, v_new_id;
  END LOOP;
END $$;