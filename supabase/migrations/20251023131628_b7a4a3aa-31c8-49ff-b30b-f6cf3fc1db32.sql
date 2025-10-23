-- Créer une fonction Postgres pour exécuter des requêtes SQL en lecture seule
CREATE OR REPLACE FUNCTION execute_readonly_sql(query_text text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result json;
  normalized_query text;
BEGIN
  -- Normaliser la requête
  normalized_query := lower(trim(query_text));
  
  -- Vérifier que c'est une requête SELECT
  IF NOT (normalized_query LIKE 'select %' OR normalized_query LIKE 'with %') THEN
    RAISE EXCEPTION 'Only SELECT queries are allowed';
  END IF;
  
  -- Vérifier qu'il n'y a pas de mots-clés interdits
  IF normalized_query ~ '(insert|update|delete|drop|alter|create|truncate|grant|revoke|execute|call|merge|replace|rename)' THEN
    RAISE EXCEPTION 'Query contains forbidden keywords';
  END IF;
  
  -- Vérifier qu'il y a une clause LIMIT
  IF NOT normalized_query ~ 'limit\s+\d+' THEN
    RAISE EXCEPTION 'Query must contain a LIMIT clause';
  END IF;
  
  -- Extraire et vérifier la valeur du LIMIT
  IF (SELECT regexp_replace(normalized_query, '.*limit\s+(\d+).*', '\1')::integer > 100) THEN
    RAISE EXCEPTION 'LIMIT cannot exceed 100';
  END IF;
  
  -- Exécuter la requête et retourner le résultat en JSON
  EXECUTE format('SELECT json_agg(row_to_json(t)) FROM (%s) t', query_text) INTO result;
  
  RETURN COALESCE(result, '[]'::json);
END;
$$;