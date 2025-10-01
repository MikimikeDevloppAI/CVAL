import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// Import LP solver from CDN
import solver from 'https://esm.sh/javascript-lp-solver@0.4.24';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type DemiJournee = 'matin' | 'apres_midi';

const DEMI_JOURNEE_SLOTS = {
  matin: { start: '07:30:00', end: '12:00:00' },
  apres_midi: { start: '13:00:00', end: '17:00:00' },
};

interface SecretaireData {
  id: string;
  specialites: string[];
  horaires: {
    jour_semaine: number;
    demi_journee: DemiJournee;
  }[];
}

interface BesoinData {
  jour_semaine: number;
  demi_journee: DemiJournee;
  specialite_id: string;
  besoin: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('🚀 Starting MILP base schedule optimization');
    
    const supabaseServiceRole = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // 1. Fetch data
    console.log('📊 Fetching data from database...');
    
    // Fetch secretaires with specialites
    const { data: secretaires, error: secError } = await supabaseServiceRole
      .from('secretaires')
      .select('id, specialites')
      .eq('actif', true);

    if (secError) throw secError;

    // Fetch horaires_base_secretaires
    const { data: horairesSecretaires, error: horSecError } = await supabaseServiceRole
      .from('horaires_base_secretaires')
      .select('secretaire_id, jour_semaine, heure_debut, heure_fin')
      .eq('actif', true);

    if (horSecError) throw horSecError;

    // Fetch medecins
    const { data: medecins, error: medError } = await supabaseServiceRole
      .from('medecins')
      .select('id, specialite_id, besoin_secretaires')
      .eq('actif', true);

    if (medError) throw medError;

    // Fetch horaires_base_medecins
    const { data: horairesMedecins, error: horMedError } = await supabaseServiceRole
      .from('horaires_base_medecins')
      .select('medecin_id, jour_semaine, heure_debut, heure_fin')
      .eq('actif', true);

    if (horMedError) throw horMedError;

    console.log(`   Found ${secretaires?.length || 0} secretaires, ${medecins?.length || 0} medecins`);
    console.log(`   Found ${horairesSecretaires?.length || 0} secretaire schedules, ${horairesMedecins?.length || 0} medecin schedules`);

    // 2. Transform data
    const secretairesMap = buildSecretairesMap(secretaires, horairesSecretaires);
    const besoinsMap = buildBesoinsMap(medecins, horairesMedecins);

    console.log(`   Transformed to ${secretairesMap.size} secretaire slots, ${besoinsMap.size} besoin groups`);
    
    // Debug: Count secretaries per half-day
    let matinCount = 0;
    let apresMidiCount = 0;
    for (const [_, secData] of secretairesMap) {
      for (const h of secData.horaires) {
        if (h.demi_journee === 'matin') matinCount++;
        if (h.demi_journee === 'apres_midi') apresMidiCount++;
      }
    }
    console.log(`   📊 Secrétaires disponibles: ${matinCount} créneaux matin, ${apresMidiCount} créneaux après-midi`);
    
    // Debug: Count besoins per half-day
    let matinBesoins = 0;
    let apresMidiBesoins = 0;
    for (const [_, besoin] of besoinsMap) {
      if (besoin.demi_journee === 'matin') matinBesoins++;
      if (besoin.demi_journee === 'apres_midi') apresMidiBesoins++;
    }
    console.log(`   📊 Besoins: ${matinBesoins} groupes matin, ${apresMidiBesoins} groupes après-midi`);

    // 3. Build and solve MILP model
    console.log('🧮 Building MILP model...');
    const { model, stats } = buildMILPModel(secretairesMap, besoinsMap);
    
    console.log(`   📊 Variables créées: ${stats.totalVars} (${stats.matinVars} matin, ${stats.apresMidiVars} après-midi)`);
    console.log(`   📊 Contraintes: ${stats.totalConstraints}`);
    
    console.log('⚡ Solving MILP problem...');
    const solution = solver.Solve(model);

    if (!solution.feasible) {
      throw new Error('MILP problem is infeasible - no valid solution found');
    }

    console.log(`✅ MILP solution found with objective value: ${solution.result}`);

    // 4. Parse results
    const results = parseResults(solution, secretairesMap, besoinsMap);
    
    // Debug: Count assignments per half-day
    let matinAssignments = 0;
    let apresMidiAssignments = 0;
    for (const r of results) {
      if (r.demi_journee === 'matin') matinAssignments += r.capacites_assignees;
      if (r.demi_journee === 'apres_midi') apresMidiAssignments += r.capacites_assignees;
    }
    console.log(`   📊 Assignations: ${matinAssignments} matin, ${apresMidiAssignments} après-midi`);

    // 5. Save to database
    console.log('💾 Saving results to optimisation_horaires_base...');
    
    // Clear existing data
    await supabaseServiceRole
      .from('optimisation_horaires_base')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    // Insert new results
    const insertData = results.map(r => ({
      specialite_id: r.specialite_id,
      jour_semaine: r.jour_semaine,
      demi_journee: r.demi_journee,
      besoins: r.besoins,
      capacites_assignees: r.capacites_assignees,
      secretaires_assignees: r.secretaires_assignees,
    }));

    const { error: insertError } = await supabaseServiceRole
      .from('optimisation_horaires_base')
      .insert(insertData);

    if (insertError) throw insertError;

    console.log(`✅ Successfully saved ${results.length} optimization results`);

    // Calculate summary stats
    const totalAssignments = results.reduce((sum, r) => sum + r.capacites_assignees, 0);
    const totalBesoins = results.reduce((sum, r) => sum + r.besoins, 0);
    const satisfactionRate = totalBesoins > 0 ? (totalAssignments / totalBesoins) * 100 : 0;

    const response = {
      success: true,
      stats: {
        total_groups: results.length,
        total_assignments: totalAssignments,
        total_besoins: Math.ceil(totalBesoins),
        satisfaction_rate: satisfactionRate.toFixed(1) + '%',
        objective_value: solution.result,
      },
      results: results,
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('❌ Error in MILP optimization:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function buildSecretairesMap(
  secretaires: any[],
  horaires: any[]
): Map<string, SecretaireData> {
  const map = new Map<string, SecretaireData>();

  for (const sec of secretaires) {
    const secHoraires = horaires
      .filter(h => h.secretaire_id === sec.id)
      .map(h => {
        const slots: { jour_semaine: number; demi_journee: DemiJournee }[] = [];
        
        // Strict separation: matin is 07:30-12:00, apres_midi is 13:00-17:00
        // Check if covers matin period (must have significant overlap)
        const matinStart = '07:30:00';
        const matinEnd = '12:00:00';
        if (h.heure_debut <= matinStart && h.heure_fin >= matinEnd) {
          // Full matin coverage
          slots.push({ jour_semaine: h.jour_semaine, demi_journee: 'matin' });
        } else if (h.heure_debut < matinEnd && h.heure_fin > matinStart) {
          // Partial matin coverage (at least 1 hour overlap)
          const overlapStart = h.heure_debut > matinStart ? h.heure_debut : matinStart;
          const overlapEnd = h.heure_fin < matinEnd ? h.heure_fin : matinEnd;
          const overlapHours = (new Date(`2000-01-01T${overlapEnd}`).getTime() - 
                                new Date(`2000-01-01T${overlapStart}`).getTime()) / (1000 * 60 * 60);
          if (overlapHours >= 1) {
            slots.push({ jour_semaine: h.jour_semaine, demi_journee: 'matin' });
          }
        }
        
        // Check if covers apres_midi period (must have significant overlap)
        const apresStart = '13:00:00';
        const apresEnd = '17:00:00';
        if (h.heure_debut <= apresStart && h.heure_fin >= apresEnd) {
          // Full apres_midi coverage
          slots.push({ jour_semaine: h.jour_semaine, demi_journee: 'apres_midi' });
        } else if (h.heure_debut < apresEnd && h.heure_fin > apresStart) {
          // Partial apres_midi coverage (at least 1 hour overlap)
          const overlapStart = h.heure_debut > apresStart ? h.heure_debut : apresStart;
          const overlapEnd = h.heure_fin < apresEnd ? h.heure_fin : apresEnd;
          const overlapHours = (new Date(`2000-01-01T${overlapEnd}`).getTime() - 
                                new Date(`2000-01-01T${overlapStart}`).getTime()) / (1000 * 60 * 60);
          if (overlapHours >= 1) {
            slots.push({ jour_semaine: h.jour_semaine, demi_journee: 'apres_midi' });
          }
        }
        
        return slots;
      })
      .flat();

    if (secHoraires.length > 0) {
      map.set(sec.id, {
        id: sec.id,
        specialites: sec.specialites || [],
        horaires: secHoraires,
      });
    }
  }

  return map;
}

function buildBesoinsMap(
  medecins: any[],
  horaires: any[]
): Map<string, BesoinData> {
  const besoinsMap = new Map<string, BesoinData>();

  for (const med of medecins) {
    const medHoraires = horaires.filter(h => h.medecin_id === med.id);

    for (const h of medHoraires) {
      // Strict separation: matin is 07:30-12:00, apres_midi is 13:00-17:00
      const matinStart = '07:30:00';
      const matinEnd = '12:00:00';
      const apresStart = '13:00:00';
      const apresEnd = '17:00:00';

      // Calculate matin overlap
      if (h.heure_debut < matinEnd && h.heure_fin > matinStart) {
        const overlapStart = h.heure_debut > matinStart ? h.heure_debut : matinStart;
        const overlapEnd = h.heure_fin < matinEnd ? h.heure_fin : matinEnd;
        const overlapHours = (new Date(`2000-01-01T${overlapEnd}`).getTime() - 
                              new Date(`2000-01-01T${overlapStart}`).getTime()) / (1000 * 60 * 60);
        
        if (overlapHours > 0) {
          const key = `${h.jour_semaine}|matin|${med.specialite_id}`;
          if (!besoinsMap.has(key)) {
            besoinsMap.set(key, {
              jour_semaine: h.jour_semaine,
              demi_journee: 'matin',
              specialite_id: med.specialite_id,
              besoin: 0,
            });
          }
          // Weight besoin by the proportion of matin covered
          const proportionCovered = overlapHours / 4.5; // 4.5h = matin duration
          besoinsMap.get(key)!.besoin += med.besoin_secretaires * proportionCovered;
        }
      }

      // Calculate apres_midi overlap
      if (h.heure_debut < apresEnd && h.heure_fin > apresStart) {
        const overlapStart = h.heure_debut > apresStart ? h.heure_debut : apresStart;
        const overlapEnd = h.heure_fin < apresEnd ? h.heure_fin : apresEnd;
        const overlapHours = (new Date(`2000-01-01T${overlapEnd}`).getTime() - 
                              new Date(`2000-01-01T${overlapStart}`).getTime()) / (1000 * 60 * 60);
        
        if (overlapHours > 0) {
          const key = `${h.jour_semaine}|apres_midi|${med.specialite_id}`;
          if (!besoinsMap.has(key)) {
            besoinsMap.set(key, {
              jour_semaine: h.jour_semaine,
              demi_journee: 'apres_midi',
              specialite_id: med.specialite_id,
              besoin: 0,
            });
          }
          // Weight besoin by the proportion of apres_midi covered
          const proportionCovered = overlapHours / 4.0; // 4.0h = apres_midi duration
          besoinsMap.get(key)!.besoin += med.besoin_secretaires * proportionCovered;
        }
      }
    }
  }

  return besoinsMap;
}

function buildMILPModel(
  secretairesMap: Map<string, SecretaireData>,
  besoinsMap: Map<string, BesoinData>
) {
  const model: any = {
    optimize: 'satisfaction',
    opType: 'max',
    constraints: {},
    variables: {},
    ints: {},
  };

  let matinVars = 0;
  let apresMidiVars = 0;

  // Build variables: x_s_j_d_sp for each (secretaire, jour, demi_journee, specialite)
  for (const [secId, secData] of secretairesMap) {
    for (const horaire of secData.horaires) {
      const jour = horaire.jour_semaine;
      const demi = horaire.demi_journee;

      // For each specialite this secretary has
      for (const specialiteId of secData.specialites) {
        const varName = `x_${secId}_${jour}_${demi}_${specialiteId}`;
        
        // Check if there's a besoin for this (jour, demi, specialite)
        const besoinKey = `${jour}|${demi}|${specialiteId}`;
        const besoin = besoinsMap.get(besoinKey);

        if (besoin) {
          // Variable contributes to satisfaction
          model.variables[varName] = {
            satisfaction: 1, // Each assignment adds 1 to satisfaction
            [`uniqueness_${secId}_${jour}_${demi}`]: 1, // For uniqueness constraint
            [`coverage_${jour}_${demi}_${specialiteId}`]: 1, // For coverage tracking
          };

          // Mark as integer (binary: 0 or 1)
          model.ints[varName] = 1;
          
          // Count variables by half-day
          if (demi === 'matin') matinVars++;
          if (demi === 'apres_midi') apresMidiVars++;
        }
      }
    }
  }

  // Add uniqueness constraints: each secretary assigned to at most 1 specialty per (jour, demi)
  for (const [secId, secData] of secretairesMap) {
    for (const horaire of secData.horaires) {
      const jour = horaire.jour_semaine;
      const demi = horaire.demi_journee;
      const constraintName = `uniqueness_${secId}_${jour}_${demi}`;
      
      model.constraints[constraintName] = { max: 1 };
    }
  }

  // Optional: Add soft coverage constraints (we want to get close to besoin)
  // This is implicit through the objective function maximization

  return {
    model,
    stats: {
      totalVars: Object.keys(model.variables).length,
      matinVars,
      apresMidiVars,
      totalConstraints: Object.keys(model.constraints).length,
    }
  };
}

function parseResults(
  solution: any,
  secretairesMap: Map<string, SecretaireData>,
  besoinsMap: Map<string, BesoinData>
) {
  const results: {
    specialite_id: string;
    jour_semaine: number;
    demi_journee: DemiJournee;
    besoins: number;
    capacites_assignees: number;
    secretaires_assignees: string[];
  }[] = [];

  // Group assignments by (jour, demi, specialite)
  const assignmentGroups = new Map<string, string[]>();

  for (const [varName, value] of Object.entries(solution)) {
    if (varName.startsWith('x_') && value === 1) {
      // Parse variable name: x_secId_jour_demi_specialiteId
      const parts = varName.split('_');
      if (parts.length >= 5) {
        const secId = parts[1];
        const jour = parseInt(parts[2]);
        const demi = parts[3] as DemiJournee;
        const specialiteId = parts.slice(4).join('_'); // Handle UUIDs with underscores

        const key = `${jour}|${demi}|${specialiteId}`;
        if (!assignmentGroups.has(key)) {
          assignmentGroups.set(key, []);
        }
        assignmentGroups.get(key)!.push(secId);
      }
    }
  }

  // Create results for each besoin group
  for (const [key, besoin] of besoinsMap) {
    const [jourStr, demi, specialiteId] = key.split('|');
    const jour = parseInt(jourStr);
    
    const assignedSecs = assignmentGroups.get(key) || [];

    results.push({
      specialite_id: specialiteId,
      jour_semaine: jour,
      demi_journee: demi as DemiJournee,
      besoins: Math.round(besoin.besoin * 10) / 10,
      capacites_assignees: assignedSecs.length,
      secretaires_assignees: assignedSecs,
    });
  }

  return results;
}
