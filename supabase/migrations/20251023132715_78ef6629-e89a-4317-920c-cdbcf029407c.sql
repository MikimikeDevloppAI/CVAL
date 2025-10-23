-- Recréer la fonction execute_readonly_sql avec sanitization des point-virgules
CREATE OR REPLACE FUNCTION execute_readonly_sql(query_text text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result json;
  normalized_query text;
  sanitized_query text;
BEGIN
  -- Sanitize la requête: enlever les point-virgules et espaces en fin de chaîne
  sanitized_query := regexp_replace(trim(query_text), ';+\s*$', '', 'g');
  
  -- Sécurité: refuser les requêtes avec plusieurs statements
  IF position(';' in sanitized_query) > 0 THEN
    RAISE EXCEPTION 'Multiple statements are not allowed';
  END IF;
  
  -- Normaliser la requête pour les vérifications
  normalized_query := lower(trim(sanitized_query));
  
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
  
  -- Exécuter la requête sanitisée et retourner le résultat en JSON
  EXECUTE format('SELECT json_agg(row_to_json(t)) FROM (%s) t', sanitized_query) INTO result;
  
  RETURN COALESCE(result, '[]'::json);
END;
$$;