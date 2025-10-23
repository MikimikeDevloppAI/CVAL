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
                description: 'La requête SQL SELECT à exécuter. Doit être en lecture seule (SELECT uniquement) et contenir une clause LIMIT (max 100). IMPORTANT: Ne termine JAMAIS la requête par un point-virgule (;).'
              },
              explanation: {
                type: 'string',
                description: 'Explication en français de ce que cette requête va chercher.'
              }
            },
            required: ['query', 'explanation']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'prepare_absence_creation',
          description: 'Prépare la création d\'une absence pour un médecin ou une secrétaire. Ne crée PAS l\'absence directement, retourne les données pour confirmation utilisateur.',
          parameters: {
            type: 'object',
            properties: {
              person_name: {
                type: 'string',
                description: 'Nom complet ou partiel de la personne (ex: "Christine", "Ribeaud", "Christine Ribeaud")'
              },
              person_type: {
                type: 'string',
                enum: ['medecin', 'secretaire'],
                description: 'Type de personne: "medecin" ou "secretaire"'
              },
              date_debut: {
                type: 'string',
                description: 'Date de début de l\'absence au format YYYY-MM-DD'
              },
              date_fin: {
                type: 'string',
                description: 'Date de fin de l\'absence au format YYYY-MM-DD (peut être identique à date_debut pour une absence d\'un jour)'
              },
              period: {
                type: 'string',
                enum: ['matin', 'apres_midi', 'toute_journee'],
                description: 'Période: "matin", "apres_midi", ou "toute_journee"'
              },
              type: {
                type: 'string',
                enum: ['conges', 'maladie', 'formation', 'autre'],
                description: 'Type d\'absence: "conges", "maladie", "formation", ou "autre"'
              },
              motif: {
                type: 'string',
                description: 'Motif optionnel de l\'absence'
              }
            },
            required: ['person_name', 'person_type', 'date_debut', 'date_fin', 'period', 'type']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'prepare_jour_ferie_creation',
          description: 'Prépare la création d\'un jour férié. Ne crée PAS le jour férié directement, retourne les données pour confirmation utilisateur.',
          parameters: {
            type: 'object',
            properties: {
              date: {
                type: 'string',
                description: 'Date du jour férié au format YYYY-MM-DD'
              },
              nom: {
                type: 'string',
                description: 'Nom du jour férié (ex: "Noël", "14 juillet", "Pentecôte")'
              }
            },
            required: ['date', 'nom']
          }
        }
      }
    ];

    // Garder seulement les 3 derniers messages utilisateur/assistant pour le contexte
    const recentMessages = messages.slice(-3);
    
    // Appeler OpenAI avec les tools
    console.log('🤖 Appel de OpenAI GPT-4o-mini...');
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAIApiKey}`,
        'Content-Type': 'application/json',
      },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            ...recentMessages
          ],
          tools: tools,
          tool_choice: 'auto',
          stream: false
        }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('❌ Erreur OpenAI:', error);
      throw new Error(`OpenAI API error: ${error}`);
    }

    // Parser la réponse JSON
    const data = await response.json();
    const assistantMessage = data.choices?.[0]?.message;
    
    if (!assistantMessage) {
      throw new Error('No assistant message in response');
    }
    
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
            let sqlQuery = args.query;
            
            // Sécurité: s'assurer que la requête a LIMIT et pas de ;
            sqlQuery = sqlQuery.replace(/;+\s*$/g, '').trim();
            if (!sqlQuery.toLowerCase().match(/limit\s+\d+/i)) {
              sqlQuery += ' LIMIT 100';
              console.log('➕ LIMIT 100 ajouté à la requête');
            }
            
            console.log('📊 Requête SQL:', sqlQuery);
            console.log('💡 Explication:', args.explanation);
            
            // Appeler l'edge function pour exécuter la requête
            const { data: sqlData, error: sqlError } = await supabaseClient.functions.invoke(
              'execute-sql-query',
              {
                body: { query: sqlQuery }
              }
            );

            if (sqlError) {
              console.error('❌ Erreur lors de l\'exécution SQL:', sqlError);
              return {
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify({ 
                  error: 'Erreur lors de la récupération des données. Explique à l\'utilisateur que les données n\'ont pas pu être récupérées et propose une solution alternative si possible.',
                  details: sqlError.message 
                })
              };
            }

            console.log('✅ Résultats SQL obtenus:', sqlData?.data?.length || 0, 'lignes');

            return {
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(sqlData.data || [])
            };
          }

          if (toolCall.function.name === 'prepare_absence_creation') {
            const args = JSON.parse(toolCall.function.arguments);
            console.log('🔧 Préparation absence:', args);

            // Rechercher la personne dans la DB
            const tableName = args.person_type === 'medecin' ? 'medecins' : 'secretaires';
            const searchTerm = args.person_name.toLowerCase().trim();
            
            // Récupérer toutes les personnes actives et faire la recherche en mémoire
            // pour gérer les cas "prénom nom" et recherches partielles
            const { data: allPersons, error: searchError } = await supabaseClient
              .from(tableName)
              .select('id, name, first_name')
              .eq('actif', true);

            if (searchError) {
              console.error('Erreur recherche personne:', searchError);
              return {
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify({ 
                  error: `Erreur lors de la recherche de la personne.` 
                })
              };
            }

            if (!allPersons || allPersons.length === 0) {
              return {
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify({ 
                  error: `Aucune personne active trouvée dans la base de données.` 
                })
              };
            }

            // Filtrer les personnes qui correspondent à la recherche
            const persons = allPersons.filter(p => {
              const fullName = `${p.first_name} ${p.name}`.toLowerCase();
              const reverseName = `${p.name} ${p.first_name}`.toLowerCase();
              const firstName = p.first_name?.toLowerCase() || '';
              const lastName = p.name?.toLowerCase() || '';
              
              // Chercher dans : nom complet, nom inversé, prénom seul, nom seul
              return fullName.includes(searchTerm) ||
                     reverseName.includes(searchTerm) ||
                     firstName.includes(searchTerm) ||
                     lastName.includes(searchTerm);
            });

            console.log(`🔍 Recherche "${searchTerm}" dans ${allPersons.length} personnes, ${persons.length} résultat(s)`);

            if (persons.length === 0) {
              return {
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify({ 
                  error: `Aucune personne trouvée avec le nom "${args.person_name}". Vérifie l'orthographe ou demande à l'utilisateur de préciser.` 
                })
              };
            }

            if (persons.length > 1) {
              const names = persons.map(p => `${p.first_name} ${p.name}`).join(', ');
              return {
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify({ 
                  error: `Plusieurs personnes trouvées: ${names}. Demande à l'utilisateur de préciser le nom complet.` 
                })
              };
            }

            const person = persons[0];

            // Vérifier que les dates sont valides
            const dateDebut = new Date(args.date_debut);
            const dateFin = new Date(args.date_fin);
            if (dateDebut > dateFin) {
              return {
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify({ 
                  error: 'La date de début doit être avant ou égale à la date de fin.' 
                })
              };
            }

            // Retourner les données préparées avec un marqueur spécial
            return {
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify({ 
                action_prepared: 'absence',
                data: {
                  person_id: person.id,
                  person_name: `${person.first_name} ${person.name}`,
                  person_type: args.person_type,
                  type: args.type,
                  date_debut: args.date_debut,
                  date_fin: args.date_fin,
                  demi_journee: args.period,
                  motif: args.motif || null
                }
              })
            };
          }

          if (toolCall.function.name === 'prepare_jour_ferie_creation') {
            const args = JSON.parse(toolCall.function.arguments);
            console.log('🔧 Préparation jour férié:', args);

            // Vérifier que le jour férié n'existe pas déjà
            const { data: existing, error: checkError } = await supabaseClient
              .from('jours_feries')
              .select('id, nom')
              .eq('date', args.date)
              .eq('actif', true)
              .limit(1);

            if (checkError) {
              return {
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify({ 
                  error: 'Erreur lors de la vérification du jour férié.' 
                })
              };
            }

            if (existing && existing.length > 0) {
              return {
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify({ 
                  error: `Un jour férié existe déjà à cette date: ${existing[0].nom}` 
                })
              };
            }

            // Retourner les données préparées
            return {
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify({ 
                action_prepared: 'jour_ferie',
                data: {
                  date: args.date,
                  nom: args.nom
                }
              })
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
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            ...recentMessages,
            assistantMessage,
            ...toolResults
          ],
          stream: false
        }),
      });

      if (!finalResponse.ok) {
        const error = await finalResponse.text();
        console.error('❌ Erreur OpenAI (2ème appel):', error);
        throw new Error(`OpenAI API error: ${error}`);
      }

      const finalData = await finalResponse.json();
      const finalMessage = finalData.choices?.[0]?.message?.content || 'Désolé, je n\'ai pas pu générer de réponse.';

      console.log('✅ Réponse finale reçue');

      // Vérifier si une action est en attente dans les toolResults
      let pendingAction = null;
      for (const result of toolResults) {
        try {
          const parsed = JSON.parse(result.content);
          if (parsed.action_prepared) {
            pendingAction = {
              type: parsed.action_prepared,
              data: parsed.data
            };
            break;
          }
        } catch (e) {
          // Ignore parsing errors
        }
      }

      return new Response(
        JSON.stringify({ 
          content: finalMessage,
          pendingAction: pendingAction
        }),
        {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        }
      );
    }

    // Si pas de tool call, retourner directement la réponse
    console.log('✅ Réponse directe (sans requête SQL)');
    
    return new Response(
      JSON.stringify({ content: assistantMessage.content || '' }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      }
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

  console.log('  🏥 Chargement des types d\'intervention et besoins opérationnels...');
  const { data: typesIntervention } = await supabase
    .from('types_intervention')
    .select(`
      id, 
      nom, 
      code,
      actif,
      types_intervention_besoins_personnel(
        nombre_requis,
        besoins_operations(nom, code, categorie)
      )
    `)
    .eq('actif', true)
    .order('nom');

  console.log('  ✅ Contexte chargé:', {
    secretaires: secretaires?.length || 0,
    medecins: medecins?.length || 0,
    sites: sites?.length || 0,
    typesIntervention: typesIntervention?.length || 0
  });

  return {
    secretaires: secretaires || [],
    medecins: medecins || [],
    sites: sites || [],
    typesIntervention: typesIntervention || []
  };
}

function buildSystemPrompt(context: any): string {
  const currentDate = new Date().toISOString().split('T')[0];
  
  return `Tu es un assistant IA spécialisé dans l'analyse des plannings médicaux d'une clinique.
Date actuelle: ${currentDate}

Principes de communication CRITIQUES:
1. LANGAGE NATUREL UNIQUEMENT:
   - Ne JAMAIS mentionner de termes techniques de base de données (actif, capacite_effective, besoin_effectif, etc.)
   - Parler de "secrétaires", "assistantes médicales", "médecins" qui "travaillent" tel jour
   - Utiliser "journée entière" ou "toute la journée" quand matin ET après-midi sont présents
   - Ne jamais dire "actif = true", dire plutôt "en service" ou simplement ne rien mentionner
   
2. TERMINOLOGIE UTILISATEUR:
   - capacite_effective = jours où les secrétaires/assistantes médicales travaillent
   - besoin_effectif = jours où les médecins travaillent
   - Accepter tous les synonymes: secrétaire, assistante médicale, personnel administratif, etc.

3. COMPRENDRE "QUI TRAVAILLE":
   - Quand on demande "où/quand travaille [PERSONNE]", identifier d'abord si c'est une secrétaire ou un médecin
   - Pour les SECRÉTAIRES/ASSISTANTES MÉDICALES : utiliser la table capacite_effective
     * Colonnes clés: secretaire_id, date, demi_journee, site_id
     * Joindre avec secretaires et sites pour avoir les noms
   - Pour les MÉDECINS : utiliser la table besoin_effectif
     * Colonnes clés: medecin_id, date, demi_journee, site_id
     * Joindre avec medecins et sites pour avoir les noms
   - Questions types à reconnaître:
     * "où travaille [NOM]" → chercher dans capacite_effective si secrétaire, besoin_effectif si médecin
     * "qui travaille au [SITE]" → filtrer par site_id
     * "la semaine prochaine" → date >= CURRENT_DATE AND date < CURRENT_DATE + INTERVAL '1 week'

4. CRÉATION D'ABSENCES ET JOURS FÉRIÉS:
   - Quand l'utilisateur demande de créer une absence ou un jour férié, utiliser les tools appropriés
   - Pour créer une absence: utiliser prepare_absence_creation
     * Exemples: "Crée une absence pour Christine vendredi matin", "Marie est en congés la semaine prochaine"
     * Identifier la personne, le type (si non précisé, utiliser "conges" par défaut), les dates et la période
     * Interpréter les dates relatives ("vendredi", "la semaine prochaine", "du 15 au 20", etc.)
     * Si la période (matin/après-midi) n'est pas précisée, utiliser "toute_journee" par défaut
     * NE PAS poser de questions de clarification si les valeurs par défaut sont raisonnables
     * Appeler directement le tool et laisser l'utilisateur confirmer ou annuler via le dialog
   - Pour créer un jour férié: utiliser prepare_jour_ferie_creation
     * Exemples: "Ajoute le 25 décembre comme jour férié", "Crée un jour férié pour Noël"
   - IMPORTANT: Ces tools ne créent RIEN dans la base, ils préparent juste les données pour validation
   - Après l'appel du tool, NE PAS demander de confirmation dans le message, car le dialog de confirmation s'affichera automatiquement
   - Message après préparation: "Je prépare l'absence/le jour férié pour [résumé rapide]." (le dialog s'ouvrira automatiquement)
    
5. COMPORTEMENT PROACTIF:
   - NE PAS poser trop de questions de clarification
   - Faire une interprétation raisonnable de la demande et exécuter la requête
   - L'utilisateur reposera une question s'il n'est pas satisfait de la réponse
   - Privilégier l'action plutôt que la validation

6. FORMAT DES RÉPONSES:
   - Présenter les résultats de manière claire et lisible
   - Regrouper par personne plutôt que par jour si c'est plus lisible
   - Simplifier: si matin + après-midi = dire "journée entière"
   - JAMAIS montrer le SQL à l'utilisateur
   - Ne mentionner la limite de 100 lignes QUE si elle est atteinte (exemple: "Attention, seules les 100 premières lignes sont affichées")
   - Utiliser des tableaux markdown bien formatés avec des en-têtes clairs
   
7. TABLEAUX MARKDOWN:
   - Utiliser le format markdown avec alignement
   - Exemples de bonnes en-têtes: "Date", "Personne", "Site", "Période" (pas "demi_journee")
   - Simplifier les rôles: is_1r = "Responsable 1R", is_2f = "Responsable 2F", etc.
   - Si aucun rôle spécial, ne rien afficher
   
8. TECHNIQUES:
   - Limiter les résultats avec LIMIT 100
   - IMPORTANT: Utiliser les VRAIS noms de colonnes (voir schéma ci-dessous)
   - Ne JAMAIS terminer les requêtes SQL par un point-virgule (;)

Données de référence:

SECRÉTAIRES:
${context.secretaires.map((s: any) => `- ${s.name} ${s.first_name} (ID: ${s.id})`).join('\n')}

MÉDECINS:
${context.medecins.map((m: any) => `- ${m.name} ${m.first_name} - ${m.specialites?.nom || 'N/A'} (ID: ${m.id})`).join('\n')}

SITES:
${context.sites.map((site: any) => `- ${site.nom} (ID: ${site.id})`).join('\n')}

TYPES D'INTERVENTION (OPÉRATIONS) avec leurs besoins en aides opératoires/assistantes de bloc:
${context.typesIntervention.map((type: any) => {
  const besoins = type.types_intervention_besoins_personnel || [];
  const besoinsList = besoins
    .map((b: any) => `${b.nombre_requis}x ${b.besoins_operations?.nom || 'N/A'} (${b.besoins_operations?.categorie || 'N/A'})`)
    .join(', ');
  return `- ${type.nom} (Code: ${type.code}, ID: ${type.id})${besoinsList ? `\n  Besoins: ${besoinsList}` : ''}`;
}).join('\n')}

═══════════════════════════════════════════════════════════════
SCHÉMA COMPLET DE LA BASE DE DONNÉES
═══════════════════════════════════════════════════════════════

📋 TABLE: secretaires (secrétaires)
Colonnes:
  - id (uuid, PK)
  - first_name (text) ⚠️ IMPORTANT: C'est "first_name" PAS "prenom"
  - name (text) ⚠️ IMPORTANT: C'est "name" PAS "nom"
  - email (text)
  - phone_number (text)
  - actif (boolean) - true si la secrétaire est active
  - horaire_flexible (boolean)
  - prefered_admin (boolean) - préfère les tâches administratives
  - pourcentage_temps (numeric) - pourcentage de temps de travail
  - profile_id (uuid) - lien avec le compte utilisateur

📋 TABLE: medecins (médecins)
Colonnes:
  - id (uuid, PK)
  - first_name (text) ⚠️ IMPORTANT: C'est "first_name" PAS "prenom"
  - name (text) ⚠️ IMPORTANT: C'est "name" PAS "nom"
  - email (text)
  - phone_number (text)
  - actif (boolean) - true si le médecin est actif
  - specialite_id (uuid) → FK vers specialites.id
  - besoin_secretaires (numeric) - nombre de secrétaires requis (ex: 1.2)
  - profile_id (uuid)

📋 TABLE: sites (sites médicaux)
Colonnes:
  - id (uuid, PK)
  - nom (text) - nom du site
  - adresse (text)
  - actif (boolean)
  - fermeture (boolean) - true si le site est en fermeture

📋 TABLE: capacite_effective (affectations des secrétaires)
Cette table contient les affectations réelles des secrétaires aux sites et opérations.
Colonnes:
  - id (uuid, PK)
  - date (date) - date de l'affectation
  - demi_journee (text) - 'matin' ou 'apres_midi'
  - secretaire_id (uuid) → FK vers secretaires.id
  - site_id (uuid) → FK vers sites.id
  - planning_genere_bloc_operatoire_id (uuid) → FK vers planning_genere_bloc_operatoire.id
  - besoin_operation_id (uuid) → FK vers besoins_operations.id
  - is_1r (boolean) - responsable 1R
  - is_2f (boolean) - responsable 2F
  - is_3f (boolean) - responsable 3F
  - actif (boolean)

📋 TABLE: besoin_effectif (besoins en médecins)
Cette table contient les besoins effectifs de médecins par site et date.
Colonnes:
  - id (uuid, PK)
  - date (date)
  - demi_journee (text) - 'matin' ou 'apres_midi'
  - type (text) - 'medecin' ou 'bloc_operatoire'
  - medecin_id (uuid) → FK vers medecins.id
  - site_id (uuid) → FK vers sites.id
  - type_intervention_id (uuid) → FK vers types_intervention.id
  - actif (boolean)

📋 TABLE: planning_genere_bloc_operatoire (opérations planifiées au bloc)
Cette table contient les opérations planifiées au bloc opératoire.
Colonnes:
  - id (uuid, PK)
  - date (date)
  - periode (text) - 'matin' ou 'apres_midi'
  - type_intervention_id (uuid) → FK vers types_intervention.id
  - medecin_id (uuid) → FK vers medecins.id
  - salle_assignee (uuid) → FK vers salles_operation.id
  - besoin_effectif_id (uuid) → FK vers besoin_effectif.id
  - validated (boolean) - true si validé
  - statut (text) - 'planifie', 'annule', etc.
  - planning_id (uuid)

📋 TABLE: besoins_operations (types de besoins opérationnels)
Colonnes:
  - id (uuid, PK)
  - nom (text) - nom du besoin
  - code (text) - code du besoin
  - description (text)
  - categorie (text)
  - actif (boolean)

📋 TABLE: types_intervention (types d'interventions)
Colonnes:
  - id (uuid, PK)
  - nom (text) - nom du type d'intervention
  - code (text)
  - actif (boolean)
  - salle_preferentielle (uuid) → FK vers salles_operation.id

📋 TABLE: salles_operation (salles d'opération)
Colonnes:
  - id (uuid, PK)
  - name (text) - nom de la salle

📋 TABLE: absences (absences du personnel)
Colonnes:
  - id (uuid, PK)
  - date_debut (date) - date de début de l'absence
  - date_fin (date) - date de fin de l'absence
  - demi_journee (text) - 'matin', 'apres_midi', ou 'toute_journee'
  - type (text) - type d'absence
  - type_personne (text) - 'medecin' ou 'secretaire'
  - medecin_id (uuid) → FK vers medecins.id (si type_personne='medecin')
  - secretaire_id (uuid) → FK vers secretaires.id (si type_personne='secretaire')
  - statut (text) - 'approuve', 'en_attente', 'refuse'
  - motif (text) - raison de l'absence

📋 TABLE: jours_feries (jours fériés)
Colonnes:
  - id (uuid, PK)
  - date (date)
  - nom (text) - nom du jour férié
  - actif (boolean)

📋 TABLE: specialites (spécialités médicales)
Colonnes:
  - id (uuid, PK)
  - nom (text) - nom de la spécialité
  - code (text)

═══════════════════════════════════════════════════════════════
EXEMPLES DE REQUÊTES TYPES
═══════════════════════════════════════════════════════════════

-- Exemple 1: Affectations d'une secrétaire avec les sites
SELECT 
  s.first_name, s.name,
  ce.date, ce.demi_journee,
  si.nom as site_nom
FROM capacite_effective ce
JOIN secretaires s ON ce.secretaire_id = s.id
JOIN sites si ON ce.site_id = si.id
WHERE s.first_name = 'Marie' AND ce.actif = true
ORDER BY ce.date DESC
LIMIT 100;

-- Exemple 2: Opérations du bloc avec médecin et salle
SELECT 
  pb.date, pb.periode,
  m.first_name as medecin_prenom, m.name as medecin_nom,
  ti.nom as type_intervention,
  so.name as salle,
  pb.validated
FROM planning_genere_bloc_operatoire pb
LEFT JOIN medecins m ON pb.medecin_id = m.id
LEFT JOIN types_intervention ti ON pb.type_intervention_id = ti.id
LEFT JOIN salles_operation so ON pb.salle_assignee = so.id
WHERE pb.date >= '2025-01-01' AND pb.statut != 'annule'
ORDER BY pb.date, pb.periode
LIMIT 100;

-- Exemple 3: Absences d'une période avec noms complets
SELECT 
  a.date_debut, a.date_fin, a.demi_journee, a.motif,
  CASE 
    WHEN a.type_personne = 'secretaire' THEN s.first_name || ' ' || s.name
    WHEN a.type_personne = 'medecin' THEN m.first_name || ' ' || m.name
  END as personne,
  a.type_personne, a.statut
FROM absences a
LEFT JOIN secretaires s ON a.secretaire_id = s.id
LEFT JOIN medecins m ON a.medecin_id = m.id
WHERE a.date_debut >= '2024-12-20' AND a.date_fin <= '2025-01-10'
ORDER BY a.date_debut
LIMIT 100;

-- Exemple 4: Besoins effectifs par site avec médecins
SELECT 
  be.date, be.demi_journee,
  s.nom as site_nom,
  m.first_name || ' ' || m.name as medecin,
  ti.nom as type_intervention
FROM besoin_effectif be
JOIN sites s ON be.site_id = s.id
LEFT JOIN medecins m ON be.medecin_id = m.id
LEFT JOIN types_intervention ti ON be.type_intervention_id = ti.id
WHERE be.date >= CURRENT_DATE AND be.actif = true
ORDER BY be.date, s.nom
LIMIT 100;

⚠️ RAPPELS TECHNIQUES IMPORTANTS:
1. Colonnes: toujours utiliser "first_name" et "name" (JAMAIS "prenom" ni "nom")
2. Utiliser des JOINs pour récupérer les noms depuis les tables liées
3. Toujours ajouter LIMIT 100 pour limiter les résultats
4. Filtrer sur actif = true quand pertinent (mais ne JAMAIS le mentionner à l'utilisateur)
5. Pour les dates, utiliser le format 'YYYY-MM-DD'
6. ⚠️ CRITIQUE: Ne JAMAIS terminer les requêtes SQL par un point-virgule (;)
7. Quand matin ET après-midi sont présents pour la même personne/jour, les regrouper et dire "journée entière"

EXEMPLE DE BONNE RÉPONSE AVEC TABLEAU:
❌ MAUVAIS: Afficher le SQL ou mentionner "actif = true" ou "is_2f"
✅ BON: 
"Voici les assistantes médicales qui travaillent les samedis en 2026 :

| Date | Période | Site | Assistante | Rôle |
|------|---------|------|-----------|------|
| 10/01/2026 | Matin | Centre Esplanade - Ophtalmologie | Léna Jurot | Responsable 2F |
| 14/02/2026 | Matin | Centre Esplanade - Ophtalmologie | Léna Jurot | Responsable 2F |
| 14/03/2026 | Matin | Centre Esplanade - Ophtalmologie | Léna Jurot | Responsable 2F |

Au total, 6 samedis sont planifiés pour cette période."

Pour toute question nécessitant des données, utilise l'outil execute_sql_query avec une requête SQL appropriée.`;
}
