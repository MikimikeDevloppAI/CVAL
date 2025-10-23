-- Fonction pour exécuter des requêtes SELECT en lecture seule de manière sécurisée
CREATE OR REPLACE FUNCTION execute_read_query(query text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  -- Vérifier que c'est bien un SELECT ou WITH (CTE)
  IF lower(trim(query)) NOT LIKE 'select%' AND lower(trim(query)) NOT LIKE 'with%' THEN
    RAISE EXCEPTION 'Only SELECT queries are allowed';
  END IF;
  
  -- Exécuter et retourner en JSON
  EXECUTE format('SELECT jsonb_agg(row_to_json(t)) FROM (%s) t', query) INTO result;
  
  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

-- Accorder les permissions nécessaires
GRANT EXECUTE ON FUNCTION execute_read_query(text) TO service_role;

-- Commentaire pour la documentation
COMMENT ON FUNCTION execute_read_query(text) IS 'Exécute une requête SQL SELECT en lecture seule et retourne les résultats en JSON. Utilisée par l''assistant IA pour interroger la base de données.';