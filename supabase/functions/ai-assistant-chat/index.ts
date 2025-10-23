import 'https://deno.land/x/xhr@0.1.0/mod.ts';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';

const openAIApiKey = Deno.env.get('OPENAI_API_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages } = await req.json();
    
    console.log('💬 Nouvelle conversation reçue, messages:', messages.length);

    // Initialiser le client Supabase
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Charger les données de contexte
    console.log('📊 Chargement du contexte...');
    const context = await loadContextData(supabaseClient);
    
    // Construire le prompt système avec le contexte
    const systemPrompt = buildSystemPrompt(context);
    
    // Préparer les outils disponibles pour l'agent
    const tools = [
      {
        type: 'function',
        function: {
          name: 'execute_sql_query',
          description: 'Exécute une requête SQL SELECT en lecture seule sur la base de données de planning médical. Utilise cette fonction pour obtenir des informations sur les absences, les affectations, les horaires, etc.',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'La requête SQL SELECT à exécuter. Doit être en lecture seule (SELECT uniquement) et contenir une clause LIMIT (max 100).'
              },
              explanation: {
                type: 'string',
                description: 'Explication en français de ce que cette requête va chercher.'
              }
            },
            required: ['query', 'explanation']
          }
        }
      }
    ];

    // Garder seulement les 5 derniers messages utilisateur/assistant pour le contexte
    const recentMessages = messages.slice(-5);
    
    // Appeler OpenAI avec les tools
    console.log('🤖 Appel de OpenAI GPT-5-mini...');
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAIApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-5-mini-2025-08-07',
        messages: [
          { role: 'system', content: systemPrompt },
          ...recentMessages
        ],
        tools: tools,
        tool_choice: 'auto',
        max_completion_tokens: 2000
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('❌ Erreur OpenAI:', error);
      throw new Error(`OpenAI API error: ${error}`);
    }

    const data = await response.json();
    const assistantMessage = data.choices[0].message;
    
    console.log('📝 Réponse OpenAI reçue, tool_calls:', assistantMessage.tool_calls?.length || 0);

    // Si l'IA veut appeler des tools
    if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      console.log('🔧 Exécution de', assistantMessage.tool_calls.length, 'tool(s)...');
      
      // Exécuter tous les tool_calls en parallèle
      const toolResults = await Promise.all(
        assistantMessage.tool_calls.map(async (toolCall: any) => {
          if (toolCall.function.name === 'execute_sql_query') {
            const args = JSON.parse(toolCall.function.arguments);
            console.log('📊 Requête SQL:', args.query);
            console.log('💡 Explication:', args.explanation);
            
            // Appeler l'edge function pour exécuter la requête
            const { data: sqlData, error: sqlError } = await supabaseClient.functions.invoke(
              'execute-sql-query',
              {
                body: { query: args.query }
              }
            );

            if (sqlError) {
              console.error('❌ Erreur lors de l\'exécution SQL:', sqlError);
              return {
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify({ error: sqlError.message })
              };
            }

            console.log('✅ Résultats SQL obtenus:', sqlData?.data?.length || 0, 'lignes');

            return {
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(sqlData.data || [])
            };
          }
          
          return {
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({ error: 'Tool non supporté' })
          };
        })
      );

      // Appeler à nouveau OpenAI avec tous les résultats
      const finalResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openAIApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-5-mini-2025-08-07',
          messages: [
            { role: 'system', content: systemPrompt },
            ...recentMessages,
            assistantMessage,
            ...toolResults
          ],
          max_completion_tokens: 2000
        }),
      });

      if (!finalResponse.ok) {
        const error = await finalResponse.text();
        console.error('❌ Erreur OpenAI (2ème appel):', error);
        throw new Error(`OpenAI API error: ${error}`);
      }

      const finalData = await finalResponse.json();
      const finalMessage = finalData.choices[0].message.content;
      
      console.log('✅ Réponse finale générée');

      // Récupérer la première requête SQL pour l'affichage
      const firstToolCall = assistantMessage.tool_calls[0];
      const firstArgs = JSON.parse(firstToolCall.function.arguments);

      return new Response(
        JSON.stringify({ 
          response: finalMessage,
          sql_executed: firstArgs.query,
          sql_explanation: firstArgs.explanation,
          results_count: toolResults.reduce((sum, r) => {
            try {
              const data = JSON.parse(r.content);
              return sum + (Array.isArray(data) ? data.length : 0);
            } catch {
              return sum;
            }
          }, 0)
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Si pas de tool call, retourner directement la réponse
    console.log('✅ Réponse directe (sans requête SQL)');
    return new Response(
      JSON.stringify({ 
        response: assistantMessage.content,
        sql_executed: null
      }),
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

async function loadContextData(supabase: any) {
  console.log('  📋 Chargement des secrétaires...');
  const { data: secretaires } = await supabase
    .from('secretaires')
    .select('id, name, first_name, actif')
    .eq('actif', true)
    .order('name');

  console.log('  👨‍⚕️ Chargement des médecins...');
  const { data: medecins } = await supabase
    .from('medecins')
    .select('id, name, first_name, actif, specialites(nom)')
    .eq('actif', true)
    .order('name');

  console.log('  🏥 Chargement des sites...');
  const { data: sites } = await supabase
    .from('sites')
    .select('id, nom, adresse, actif')
    .eq('actif', true)
    .order('nom');

  console.log('  ✅ Contexte chargé:', {
    secretaires: secretaires?.length || 0,
    medecins: medecins?.length || 0,
    sites: sites?.length || 0
  });

  return {
    secretaires: secretaires || [],
    medecins: medecins || [],
    sites: sites || []
  };
}

function buildSystemPrompt(context: any): string {
  const today = new Date().toISOString().split('T')[0];
  
  return `Tu es un assistant IA spécialisé dans l'analyse du planning médical de la Clinique La Vallée.

📅 DATE D'AUJOURD'HUI: ${today}
Format des dates dans la base: 'YYYY-MM-DD' (exemple: '2025-10-24')

🔑 DONNÉES DE RÉFÉRENCE:

**SECRÉTAIRES ACTIVES (${context.secretaires.length}):**
${context.secretaires.map((s: any) => `- ${s.first_name} ${s.name} (ID: ${s.id})`).join('\n')}

**MÉDECINS ACTIFS (${context.medecins.length}):**
${context.medecins.map((m: any) => `- Dr. ${m.first_name} ${m.name} - ${m.specialites?.nom || 'N/A'} (ID: ${m.id})`).join('\n')}

**SITES ACTIFS (${context.sites.length}):**
${context.sites.map((s: any) => `- ${s.nom} (ID: ${s.id})`).join('\n')}

📊 SCHÉMA DE LA BASE DE DONNÉES:

**absences** - Absences du personnel
- id (uuid)
- date_debut (date) - Date de début de l'absence
- date_fin (date) - Date de fin de l'absence
- demi_journee (enum: 'matin', 'apres_midi', 'toute_journee')
- type (enum: 'conge', 'maladie', 'formation', 'autre')
- statut (enum: 'en_attente', 'approuve', 'refuse')
- type_personne (enum: 'medecin', 'secretaire')
- medecin_id (uuid, nullable)
- secretaire_id (uuid, nullable)
- motif (text)

**jours_feries** - Jours fériés
- id (uuid)
- date (date)
- nom (text)
- actif (boolean)

**capacite_effective** - Qui travaille où et quand (affectations réelles)
- id (uuid)
- date (date)
- secretaire_id (uuid)
- demi_journee (enum: 'matin', 'apres_midi')
- site_id (uuid)
- actif (boolean)

**besoin_effectif** - Besoins en personnel
- id (uuid)
- date (date)
- type (enum: 'medecin', 'bloc_operatoire')
- medecin_id (uuid, nullable)
- site_id (uuid)
- demi_journee (enum: 'matin', 'apres_midi')
- actif (boolean)

**secretaires** - Informations des secrétaires
- id (uuid)
- name (text)
- first_name (text)
- email (text)
- actif (boolean)
- horaire_flexible (boolean)

**medecins** - Informations des médecins
- id (uuid)
- name (text)
- first_name (text)
- email (text)
- specialite_id (uuid)
- actif (boolean)

**sites** - Informations des sites médicaux
- id (uuid)
- nom (text)
- adresse (text)
- fermeture (boolean)
- actif (boolean)

🎯 TON RÔLE:
Tu as accès à la fonction "execute_sql_query" pour interroger la base de données.
- Analyse la question de l'utilisateur
- Si tu as besoin de données, utilise execute_sql_query avec une requête SQL SELECT
- Les requêtes DOIVENT être en lecture seule (SELECT uniquement)
- Les requêtes DOIVENT contenir une clause LIMIT (max 100)
- Utilise les JOINs pour avoir des noms lisibles plutôt que des IDs
- Réponds toujours en français de façon claire et structurée

💡 CONSEILS POUR LES REQUÊTES:
- Pour les dates: utilise des comparaisons directes (ex: date >= '2025-10-20')
- Pour "cette semaine": calcule la plage de dates par rapport à aujourd'hui (${today})
- Pour "la semaine prochaine": ajoute 7 jours à la date actuelle
- Joins recommandés: JOIN secretaires/medecins/sites pour afficher les noms
- Toujours filtrer sur actif = true sauf si demandé explicitement

🚫 RÈGLES DE SÉCURITÉ:
- JAMAIS de INSERT, UPDATE, DELETE, DROP, ALTER, CREATE
- TOUJOURS mettre une clause LIMIT (max 100)
- Valider que les IDs fournis par l'utilisateur existent dans les listes ci-dessus

✅ EXEMPLES DE BONNES REQUÊTES:

1. Qui est en congé cette semaine?
SELECT 
  CASE 
    WHEN a.type_personne = 'secretaire' THEN s.first_name || ' ' || s.name
    WHEN a.type_personne = 'medecin' THEN m.first_name || ' ' || m.name
  END as personne,
  a.type_personne,
  a.date_debut,
  a.date_fin,
  a.type,
  a.statut
FROM absences a
LEFT JOIN secretaires s ON a.secretaire_id = s.id
LEFT JOIN medecins m ON a.medecin_id = m.id
WHERE a.date_debut <= '${today}' AND a.date_fin >= '${today}'
  AND a.statut = 'approuve'
ORDER BY a.date_debut
LIMIT 100;

2. Où travaille une secrétaire aujourd'hui?
SELECT 
  s.first_name || ' ' || s.name as secretaire,
  si.nom as site,
  ce.demi_journee,
  ce.date
FROM capacite_effective ce
JOIN secretaires s ON s.id = ce.secretaire_id
JOIN sites si ON si.id = ce.site_id
WHERE ce.date = '${today}'
  AND ce.actif = true
  AND s.name ILIKE '%[nom]%'
ORDER BY ce.demi_journee
LIMIT 100;

3. Jours fériés du mois:
SELECT 
  date,
  nom
FROM jours_feries
WHERE date >= '2025-10-01' AND date <= '2025-10-31'
  AND actif = true
ORDER BY date
LIMIT 100;

📝 FORMAT DE RÉPONSE:
- Commence par une phrase claire répondant à la question
- Si tu as fait une requête, présente les résultats de façon structurée (listes, tableaux)
- Mentionne le nombre de résultats trouvés
- Si aucun résultat, dis-le clairement et suggère pourquoi`;
}
