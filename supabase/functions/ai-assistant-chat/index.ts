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
          max_completion_tokens: 1000
        }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('❌ Erreur OpenAI:', error);
      throw new Error(`OpenAI API error: ${error}`);
    }

    const data = await response.json();
    console.log('🔍 Réponse OpenAI complète:', JSON.stringify(data, null, 2));
    const assistantMessage = data.choices[0].message;
    
    console.log('📝 Réponse OpenAI reçue, tool_calls:', assistantMessage.tool_calls?.length || 0);
    console.log('📝 Content:', assistantMessage.content);

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
          max_completion_tokens: 1000
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

      return new Response(
        JSON.stringify({ 
          response: finalMessage
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Si pas de tool call, retourner directement la réponse
    const responseContent = assistantMessage.content || '';
    console.log('✅ Réponse directe (sans requête SQL)');
    console.log('📄 Contenu de la réponse:', responseContent);
    console.log('📊 Longueur:', responseContent.length);
    
    if (!responseContent || responseContent.trim() === '') {
      console.error('⚠️ ATTENTION: Réponse vide d\'OpenAI!');
      console.error('Message complet:', JSON.stringify(assistantMessage, null, 2));
    }
    
    return new Response(
      JSON.stringify({ 
        response: responseContent
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

📅 DATE: ${today} (Format: YYYY-MM-DD)

🎯 PRINCIPES DE RÉPONSE:
- Réponds de manière DIRECTE et NATURELLE
- Utilise des TABLEAUX Markdown pour présenter plusieurs résultats
- Ne pose des questions complémentaires QUE si l'information est vraiment ambiguë
- Présente les horaires de façon fluide (ex: "le matin" au lieu de "demi_journee: matin")
- Si aucun résultat, dis-le simplement sans proposer 10 options

🔑 DONNÉES DE RÉFÉRENCE:

**Secrétaires (${context.secretaires.length}):**
${context.secretaires.map((s: any) => `- ${s.first_name} ${s.name} (ID: ${s.id})`).join('\n')}

**Médecins (${context.medecins.length}):**
${context.medecins.map((m: any) => `- Dr. ${m.first_name} ${m.name} - ${m.specialites?.nom || 'N/A'} (ID: ${m.id})`).join('\n')}

**Sites (${context.sites.length}):**
${context.sites.map((s: any) => `- ${s.nom} (ID: ${s.id})`).join('\n')}

📊 BASE DE DONNÉES:

Tables principales:
- **absences**: date_debut, date_fin, demi_journee ('matin'/'apres_midi'/'toute_journee'), type, statut, type_personne ('medecin'/'secretaire'), medecin_id, secretaire_id
- **capacite_effective**: date, secretaire_id, demi_journee, site_id, actif (affectations secrétaires)
- **besoin_effectif**: date, type ('medecin'/'bloc_operatoire'), medecin_id, site_id, demi_journee, actif (besoins médecins)
- **jours_feries**: date, nom, actif

🎯 INSTRUCTIONS:
- Utilise execute_sql_query pour interroger la base (SELECT uniquement, LIMIT 100 max)
- Joins: JOIN secretaires/medecins/sites pour afficher les noms complets
- Filtre toujours sur actif = true
- **TABLEAUX**: Pour 3+ résultats, utilise un tableau Markdown:

| Nom | Site | Horaire |
|-----|------|---------|
| ... | ...  | ...     |

- **LANGAGE NATUREL**: "le matin" au lieu de "demi_journee: matin"

📝 FORMAT DE RÉPONSE:
- Réponds de façon DIRECTE avec les informations demandées
- Utilise des tableaux Markdown pour 3+ résultats
- Langage naturel et concis
- Ne pose des questions QUE si vraiment nécessaire`;
}
