-- Récupérer l'ID du site admin
DO $$
DECLARE
  v_admin_site_id UUID;
BEGIN
  -- Trouver le site admin
  SELECT id INTO v_admin_site_id
  FROM public.sites
  WHERE LOWER(nom) LIKE '%admin%'
  LIMIT 1;

  -- Si le site admin existe, mettre à jour les valeurs NULL et ajouter la contrainte DEFAULT
  IF v_admin_site_id IS NOT NULL THEN
    -- Mettre à jour les lignes existantes avec site_id NULL
    UPDATE public.capacite_effective
    SET site_id = v_admin_site_id
    WHERE site_id IS NULL;

    -- Ajouter la contrainte DEFAULT pour les futures insertions
    EXECUTE format('ALTER TABLE public.capacite_effective ALTER COLUMN site_id SET DEFAULT %L', v_admin_site_id);
    
    -- Rendre la colonne NOT NULL maintenant qu'elle a une valeur par défaut
    ALTER TABLE public.capacite_effective ALTER COLUMN site_id SET NOT NULL;
  ELSE
    RAISE NOTICE 'Aucun site admin trouvé - veuillez créer un site admin avant d''exécuter cette migration';
  END IF;
END $$;