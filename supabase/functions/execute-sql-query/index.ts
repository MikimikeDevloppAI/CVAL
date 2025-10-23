import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    // Exécuter la requête
    const { data, error } = await supabaseClient.rpc('execute_read_query', {
      query: query
    });

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
