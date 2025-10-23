-- Mise à jour de la fonction pour gérer le point-virgule final dans les requêtes
CREATE OR REPLACE FUNCTION execute_read_query(query text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  cleaned_query text;
BEGIN
  -- Nettoyer la requête: supprimer le point-virgule final et les espaces
  cleaned_query := TRIM(BOTH FROM query);
  cleaned_query := REGEXP_REPLACE(cleaned_query, ';+\s*$', '');
  
  -- Vérifier que c'est bien un SELECT ou WITH (CTE)
  IF lower(trim(cleaned_query)) NOT LIKE 'select%' AND lower(trim(cleaned_query)) NOT LIKE 'with%' THEN
    RAISE EXCEPTION 'Only SELECT queries are allowed';
  END IF;
  
  -- Exécuter et retourner en JSON
  EXECUTE format('SELECT jsonb_agg(row_to_json(t)) FROM (%s) t', cleaned_query) INTO result;
  
  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION execute_read_query(text) IS 'Exécute une requête SQL SELECT en lecture seule et retourne les résultats en JSON. Nettoie automatiquement les points-virgules finaux. Utilisée par l''assistant IA pour interroger la base de données.';