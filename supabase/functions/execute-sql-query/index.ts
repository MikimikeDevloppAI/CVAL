import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ParsedQuery {
  table: string;
  columns: string;
  joins: Array<{ table: string; foreignKey: string; select: string }>;
  filters: Array<{ column: string; operator: string; value: any }>;
  orderBy?: { column: string; ascending: boolean };
  limit: number;
}

function parseSelectQuery(sql: string): ParsedQuery {
  const normalized = sql.toLowerCase().trim();
  
  // Extraire la table principale
  const fromMatch = normalized.match(/from\s+(\w+)/);
  if (!fromMatch) throw new Error('Table principale introuvable');
  const mainTable = fromMatch[1];
  
  // Extraire les colonnes
  const selectMatch = normalized.match(/select\s+(.*?)\s+from/s);
  if (!selectMatch) throw new Error('Colonnes introuvables');
  let columnsStr = selectMatch[1].trim();
  
  // Parser les JOINs
  const joins: Array<{ table: string; foreignKey: string; select: string }> = [];
  const joinRegex = /join\s+(\w+)(?:\s+as\s+)?(\w+)?\s+on\s+(\w+)\.(\w+)\s*=\s*(\w+)\.(\w+)/g;
  let joinMatch;
  
  while ((joinMatch = joinRegex.exec(normalized)) !== null) {
    const joinTable = joinMatch[1];
    const alias = joinMatch[2] || joinMatch[1];
    const leftTable = joinMatch[3];
    const leftCol = joinMatch[4];
    const rightTable = joinMatch[5];
    const rightCol = joinMatch[6];
    
    // Déterminer la clé étrangère
    const foreignKey = leftTable === mainTable ? leftCol : rightCol;
    
    // Extraire les colonnes du JOIN depuis le SELECT
    const joinCols: string[] = [];
    const colRegex = new RegExp(`${alias}\\.([\\w_]+)`, 'g');
    let colMatch;
    while ((colMatch = colRegex.exec(columnsStr)) !== null) {
      joinCols.push(colMatch[1]);
    }
    
    joins.push({
      table: joinTable,
      foreignKey,
      select: joinCols.join(',') || '*'
    });
  }
  
  // Nettoyer les colonnes pour ne garder que celles de la table principale
  let mainColumns = columnsStr;
  for (const join of joins) {
    const alias = normalized.match(new RegExp(`join\\s+${join.table}(?:\\s+as\\s+)?(\\w+)?`))?.[1] || join.table;
    mainColumns = mainColumns.replace(new RegExp(`${alias}\\.\\w+,?\\s*`, 'g'), '');
  }
  mainColumns = mainColumns.replace(new RegExp(`${mainTable}\\.`, 'g'), '').trim();
  if (mainColumns.endsWith(',')) mainColumns = mainColumns.slice(0, -1);
  if (!mainColumns || mainColumns === '') mainColumns = '*';
  
  // Parser les filtres WHERE
  const filters: Array<{ column: string; operator: string; value: any }> = [];
  const whereMatch = normalized.match(/where\s+(.*?)(?:\s+order\s+by|\s+limit|$)/s);
  if (whereMatch) {
    const whereClause = whereMatch[1].trim();
    // Parser les conditions simples (=, >=, <=, >, <, !=, LIKE, IN)
    const conditions = whereClause.split(/\s+and\s+/i);
    
    for (const condition of conditions) {
      const eqMatch = condition.match(/(\w+\.)?(\w+)\s*=\s*'([^']+)'/);
      const gteMatch = condition.match(/(\w+\.)?(\w+)\s*>=\s*'([^']+)'/);
      const lteMatch = condition.match(/(\w+\.)?(\w+)\s*<=\s*'([^']+)'/);
      const gtMatch = condition.match(/(\w+\.)?(\w+)\s*>\s*'([^']+)'/);
      const ltMatch = condition.match(/(\w+\.)?(\w+)\s*<\s*'([^']+)'/);
      const likeMatch = condition.match(/(\w+\.)?(\w+)\s+like\s+'([^']+)'/i);
      
      if (eqMatch) {
        filters.push({ column: eqMatch[2], operator: 'eq', value: eqMatch[3] });
      } else if (gteMatch) {
        filters.push({ column: gteMatch[2], operator: 'gte', value: gteMatch[3] });
      } else if (lteMatch) {
        filters.push({ column: lteMatch[2], operator: 'lte', value: lteMatch[3] });
      } else if (gtMatch) {
        filters.push({ column: gtMatch[2], operator: 'gt', value: gtMatch[3] });
      } else if (ltMatch) {
        filters.push({ column: ltMatch[2], operator: 'lt', value: ltMatch[3] });
      } else if (likeMatch) {
        filters.push({ column: likeMatch[2], operator: 'like', value: likeMatch[3] });
      }
    }
  }
  
  // Parser ORDER BY
  let orderBy: { column: string; ascending: boolean } | undefined;
  const orderMatch = normalized.match(/order\s+by\s+(\w+\.)?(\w+)(?:\s+(asc|desc))?/);
  if (orderMatch) {
    orderBy = {
      column: orderMatch[2],
      ascending: !orderMatch[3] || orderMatch[3] === 'asc'
    };
  }
  
  // Extraire LIMIT
  const limitMatch = normalized.match(/limit\s+(\d+)/);
  const limit = limitMatch ? parseInt(limitMatch[1]) : 100;
  
  return {
    table: mainTable,
    columns: mainColumns,
    joins,
    filters,
    orderBy,
    limit: Math.min(limit, 100)
  };
}

async function executeWithQueryBuilder(parsed: ParsedQuery, supabaseClient: any) {
  // Construire le select avec les JOINs
  let selectStr = parsed.columns;
  if (parsed.joins.length > 0) {
    const joinSelects = parsed.joins.map(j => `${j.table}(${j.select})`).join(',');
    selectStr = selectStr === '*' ? joinSelects : `${selectStr},${joinSelects}`;
  }
  
  let query = supabaseClient.from(parsed.table).select(selectStr);
  
  // Appliquer les filtres
  for (const filter of parsed.filters) {
    switch (filter.operator) {
      case 'eq':
        query = query.eq(filter.column, filter.value);
        break;
      case 'gte':
        query = query.gte(filter.column, filter.value);
        break;
      case 'lte':
        query = query.lte(filter.column, filter.value);
        break;
      case 'gt':
        query = query.gt(filter.column, filter.value);
        break;
      case 'lt':
        query = query.lt(filter.column, filter.value);
        break;
      case 'like':
        query = query.like(filter.column, filter.value);
        break;
    }
  }
  
  // Appliquer ORDER BY
  if (parsed.orderBy) {
    query = query.order(parsed.orderBy.column, { ascending: parsed.orderBy.ascending });
  }
  
  // Appliquer LIMIT
  query = query.limit(parsed.limit);
  
  return await query;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { query } = await req.json();
    
    console.log('📊 Requête SQL reçue:', query);
    
    // Validation stricte de sécurité
    if (!isValidReadOnlySQL(query)) {
      console.error('❌ Requête SQL invalide ou non autorisée');
      return new Response(
        JSON.stringify({ error: 'Requête SQL invalide ou non autorisée' }),
        { 
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Initialiser le client Supabase avec service role pour contourner RLS
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Parser la requête SQL
    console.log('🔍 Parsing de la requête SQL...');
    const parsed = parseSelectQuery(query);
    console.log('✅ Requête parsée:', JSON.stringify(parsed, null, 2));

    // Exécuter avec le query builder
    console.log('⚡ Exécution avec le query builder...');
    const { data, error } = await executeWithQueryBuilder(parsed, supabaseClient);

    if (error) {
      console.error('❌ Erreur lors de l\'exécution de la requête:', error);
      throw error;
    }

    console.log('✅ Requête exécutée avec succès, résultats:', data?.length || 0, 'lignes');

    return new Response(
      JSON.stringify({ data }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Erreur:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});

function isValidReadOnlySQL(sql: string): boolean {
  if (!sql) return false;
  
  const normalized = sql.toLowerCase().trim();
  
  // Liste des mots-clés interdits
  const forbiddenKeywords = [
    'insert', 'update', 'delete', 'drop', 'alter', 
    'create', 'truncate', 'grant', 'revoke', 'execute',
    'call', 'merge', 'replace', 'rename', 'comment',
    'commit', 'rollback', 'savepoint', 'set', 'declare'
  ];
  
  // Vérifier la présence de mots-clés interdits
  for (const keyword of forbiddenKeywords) {
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    if (regex.test(normalized)) {
      console.warn(`⚠️ Mot-clé interdit détecté: ${keyword}`);
      return false;
    }
  }
  
  // Doit commencer par SELECT ou WITH (pour les CTEs)
  if (!normalized.startsWith('select') && !normalized.startsWith('with')) {
    console.warn('⚠️ La requête doit commencer par SELECT ou WITH');
    return false;
  }
  
  // Vérifier qu'il y a une limite (max 100 lignes)
  if (!normalized.includes('limit')) {
    console.warn('⚠️ La requête doit contenir une clause LIMIT');
    return false;
  }
  
  // Extraire la valeur du LIMIT
  const limitMatch = normalized.match(/limit\s+(\d+)/i);
  if (limitMatch) {
    const limitValue = parseInt(limitMatch[1]);
    if (limitValue > 100) {
      console.warn('⚠️ LIMIT ne peut pas dépasser 100');
      return false;
    }
  }
  
  return true;
}
