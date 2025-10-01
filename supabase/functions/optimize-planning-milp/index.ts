import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
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

interface CapaciteData {
  id: string;
  secretaire_id?: string;
  backup_id?: string;
  specialites: string[];
  slots: {
    date: string;
    demi_journee: DemiJournee;
  }[];
}

interface BesoinData {
  date: string;
  demi_journee: DemiJournee;
  site_id: string;
  specialite_id: string;
  besoin: number;
  medecin_ids: string[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('🚀 Starting MILP planning optimization');
    
    const supabaseServiceRole = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get date range from request or use default (current week)
    const { date_debut, date_fin } = await req.json().catch(() => ({}));
    const startDate = date_debut || new Date().toISOString().split('T')[0];
    const endDate = date_fin || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    console.log(`📊 Fetching data from ${startDate} to ${endDate}...`);

    // Fetch besoins effectifs
    const { data: besoins, error: besoinError } = await supabaseServiceRole
      .from('besoin_effectif')
      .select('*')
      .gte('date', startDate)
      .lte('date', endDate)
      .eq('actif', true);

    if (besoinError) throw besoinError;

    // Fetch capacités effectives (secrétaires et backups)
    const { data: capacites, error: capaciteError } = await supabaseServiceRole
      .from('capacite_effective')
      .select('*')
      .gte('date', startDate)
      .lte('date', endDate)
      .eq('actif', true);

    if (capaciteError) throw capaciteError;

    console.log(`   Found ${besoins?.length || 0} besoins, ${capacites?.length || 0} capacités`);

    // Transform data
    const capacitesMap = buildCapacitesMap(capacites);
    const besoinsMap = buildBesoinsMap(besoins);

    console.log(`   Transformed to ${capacitesMap.size} capacité slots, ${besoinsMap.size} besoin groups`);

    // Build and solve MILP model
    console.log('🧮 Building MILP model...');
    const { model, stats } = buildMILPModel(capacitesMap, besoinsMap);
    
    console.log(`   📊 Variables: ${stats.totalVars}, Contraintes: ${stats.totalConstraints}`);
    
    console.log('⚡ Solving MILP problem...');
    const solution = solver.Solve(model);

    if (!solution.feasible) {
      throw new Error('MILP problem is infeasible - no valid solution found');
    }

    console.log(`✅ MILP solution found with objective value: ${solution.result}`);

    // Parse results
    const results = parseResults(solution, capacitesMap, besoinsMap);

    // Save to database
    console.log('💾 Saving results to planning_genere...');
    
    // Clear existing planning for this period
    await supabaseServiceRole
      .from('planning_genere')
      .delete()
      .gte('date', startDate)
      .lte('date', endDate);

    // Insert new planning
    const insertData = results.map(r => ({
      date: r.date,
      type: 'site',
      type_assignation: 'site',
      site_id: r.site_id,
      heure_debut: r.demi_journee === 'matin' ? DEMI_JOURNEE_SLOTS.matin.start : DEMI_JOURNEE_SLOTS.apres_midi.start,
      heure_fin: r.demi_journee === 'matin' ? DEMI_JOURNEE_SLOTS.matin.end : DEMI_JOURNEE_SLOTS.apres_midi.end,
      medecins_ids: r.medecin_ids,
      secretaires_ids: r.secretaires_assignees.filter(id => !id.startsWith('backup_')),
      backups_ids: r.secretaires_assignees.filter(id => id.startsWith('backup_')).map(id => id.replace('backup_', '')),
      statut: 'planifie',
    }));

    const { error: insertError } = await supabaseServiceRole
      .from('planning_genere')
      .insert(insertData);

    if (insertError) throw insertError;

    console.log(`✅ Successfully saved ${results.length} planning entries`);

    const response = {
      success: true,
      stats: {
        total_entries: results.length,
        date_range: { start: startDate, end: endDate },
        objective_value: solution.result,
      },
      results: results,
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('❌ Error in MILP planning optimization:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function buildCapacitesMap(
  capacites: any[]
): Map<string, CapaciteData> {
  const map = new Map<string, CapaciteData>();

  for (const cap of capacites) {
    const personId = cap.secretaire_id ? cap.secretaire_id : `backup_${cap.backup_id}`;
    
    if (!map.has(personId)) {
      map.set(personId, {
        id: personId,
        secretaire_id: cap.secretaire_id,
        backup_id: cap.backup_id,
        specialites: cap.specialites || [],
        slots: [],
      });
    }

    const data = map.get(personId)!;
    
    // Determine demi_journee based on time overlap
    const matinStart = '07:30:00';
    const matinEnd = '12:00:00';
    const apresStart = '13:00:00';
    const apresEnd = '17:00:00';

    // Check matin
    if (cap.heure_debut < matinEnd && cap.heure_fin > matinStart) {
      const overlapStart = cap.heure_debut > matinStart ? cap.heure_debut : matinStart;
      const overlapEnd = cap.heure_fin < matinEnd ? cap.heure_fin : matinEnd;
      const overlapHours = (new Date(`2000-01-01T${overlapEnd}`).getTime() - 
                            new Date(`2000-01-01T${overlapStart}`).getTime()) / (1000 * 60 * 60);
      if (overlapHours >= 1) {
        data.slots.push({ date: cap.date, demi_journee: 'matin' });
      }
    }

    // Check apres_midi
    if (cap.heure_debut < apresEnd && cap.heure_fin > apresStart) {
      const overlapStart = cap.heure_debut > apresStart ? cap.heure_debut : apresStart;
      const overlapEnd = cap.heure_fin < apresEnd ? cap.heure_fin : apresEnd;
      const overlapHours = (new Date(`2000-01-01T${overlapEnd}`).getTime() - 
                            new Date(`2000-01-01T${overlapStart}`).getTime()) / (1000 * 60 * 60);
      if (overlapHours >= 1) {
        data.slots.push({ date: cap.date, demi_journee: 'apres_midi' });
      }
    }
  }

  return map;
}

function buildBesoinsMap(
  besoins: any[]
): Map<string, BesoinData> {
  const besoinsMap = new Map<string, BesoinData>();

  for (const besoin of besoins) {
    const matinStart = '07:30:00';
    const matinEnd = '12:00:00';
    const apresStart = '13:00:00';
    const apresEnd = '17:00:00';

    // Calculate matin overlap
    if (besoin.heure_debut < matinEnd && besoin.heure_fin > matinStart) {
      const overlapStart = besoin.heure_debut > matinStart ? besoin.heure_debut : matinStart;
      const overlapEnd = besoin.heure_fin < matinEnd ? besoin.heure_fin : matinEnd;
      const overlapHours = (new Date(`2000-01-01T${overlapEnd}`).getTime() - 
                            new Date(`2000-01-01T${overlapStart}`).getTime()) / (1000 * 60 * 60);
      
      if (overlapHours > 0) {
        const key = `${besoin.date}|matin|${besoin.site_id}|${besoin.specialite_id}`;
        if (!besoinsMap.has(key)) {
          besoinsMap.set(key, {
            date: besoin.date,
            demi_journee: 'matin',
            site_id: besoin.site_id,
            specialite_id: besoin.specialite_id,
            besoin: 0,
            medecin_ids: [],
          });
        }
        const proportionCovered = overlapHours / 4.5;
        const entry = besoinsMap.get(key)!;
        entry.besoin += besoin.nombre_secretaires_requis * proportionCovered;
        if (besoin.medecin_id && !entry.medecin_ids.includes(besoin.medecin_id)) {
          entry.medecin_ids.push(besoin.medecin_id);
        }
      }
    }

    // Calculate apres_midi overlap
    if (besoin.heure_debut < apresEnd && besoin.heure_fin > apresStart) {
      const overlapStart = besoin.heure_debut > apresStart ? besoin.heure_debut : apresStart;
      const overlapEnd = besoin.heure_fin < apresEnd ? besoin.heure_fin : apresEnd;
      const overlapHours = (new Date(`2000-01-01T${overlapEnd}`).getTime() - 
                            new Date(`2000-01-01T${overlapStart}`).getTime()) / (1000 * 60 * 60);
      
      if (overlapHours > 0) {
        const key = `${besoin.date}|apres_midi|${besoin.site_id}|${besoin.specialite_id}`;
        if (!besoinsMap.has(key)) {
          besoinsMap.set(key, {
            date: besoin.date,
            demi_journee: 'apres_midi',
            site_id: besoin.site_id,
            specialite_id: besoin.specialite_id,
            besoin: 0,
            medecin_ids: [],
          });
        }
        const proportionCovered = overlapHours / 4.0;
        const entry = besoinsMap.get(key)!;
        entry.besoin += besoin.nombre_secretaires_requis * proportionCovered;
        if (besoin.medecin_id && !entry.medecin_ids.includes(besoin.medecin_id)) {
          entry.medecin_ids.push(besoin.medecin_id);
        }
      }
    }
  }

  return besoinsMap;
}

function buildMILPModel(
  capacitesMap: Map<string, CapaciteData>,
  besoinsMap: Map<string, BesoinData>
) {
  // Very small penalty to prefer consistency (same site matin/apres) without affecting satisfaction
  const PENALTY_WEIGHT = 0.001;
  
  const model: any = {
    optimize: 'objective',
    opType: 'max',
    constraints: {},
    variables: {},
    ints: {},
  };

  let totalVars = 0;

  // Build variables: x_person_date_demi_site_specialite
  for (const [personId, capData] of capacitesMap) {
    for (const slot of capData.slots) {
      const date = slot.date;
      const demi = slot.demi_journee;

      for (const specialiteId of capData.specialites) {
        // Find all besoins matching this date, demi, specialite
        for (const [besoinKey, besoin] of besoinsMap) {
          if (besoin.date === date && besoin.demi_journee === demi && besoin.specialite_id === specialiteId) {
            const varName = `x_${personId}_${date}_${demi}_${besoin.site_id}_${specialiteId}`;
            
            // Contribution based on REAL need (non-rounded) like optimize-base-schedule-milp
            // Each assignment contributes (100 / real_need) percentage points
            // Maximum is capped at 100% via constraint
            const contributionPercent = 100 / besoin.besoin;
            
            model.variables[varName] = {
              objective: contributionPercent,
              [`uniqueness_${personId}_${date}_${demi}`]: 1,
              [`capacity_${date}_${demi}_${besoin.site_id}_${specialiteId}`]: 1,
            };

            model.ints[varName] = 1;
            totalVars++;
          }
        }
      }
    }
  }

  // Uniqueness constraints: each person assigned to at most 1 site/specialty per (date, demi)
  for (const [personId, capData] of capacitesMap) {
    for (const slot of capData.slots) {
      const constraintName = `uniqueness_${personId}_${slot.date}_${slot.demi_journee}`;
      model.constraints[constraintName] = { max: 1 };
    }
  }

  // Capacity constraints: max secretaries per besoin = ceil(besoin) to avoid over-assignment
  for (const [key, besoin] of besoinsMap) {
    const maxCapacity = Math.ceil(besoin.besoin);
    const constraintName = `capacity_${besoin.date}_${besoin.demi_journee}_${besoin.site_id}_${besoin.specialite_id}`;
    model.constraints[constraintName] = { max: maxCapacity };
  }

  // Add penalty for changing sites between matin and apres_midi for same person/specialty
  const dates = new Set(Array.from(besoinsMap.values()).map(b => b.date));
  
  for (const [personId, capData] of capacitesMap) {
    for (const date of dates) {
      const hasMatinSlot = capData.slots.some(s => s.date === date && s.demi_journee === 'matin');
      const hasApresSlot = capData.slots.some(s => s.date === date && s.demi_journee === 'apres_midi');
      
      if (hasMatinSlot && hasApresSlot) {
        for (const specialiteId of capData.specialites) {
          // Get all site combinations for this specialty on this date
          const sitesMatinForSpec = Array.from(besoinsMap.values())
            .filter(b => b.date === date && b.demi_journee === 'matin' && b.specialite_id === specialiteId)
            .map(b => b.site_id);
          
          const sitesApresForSpec = Array.from(besoinsMap.values())
            .filter(b => b.date === date && b.demi_journee === 'apres_midi' && b.specialite_id === specialiteId)
            .map(b => b.site_id);

          // If there are different sites for this specialty between matin and apres_midi
          for (const siteM of sitesMatinForSpec) {
            for (const siteA of sitesApresForSpec) {
              if (siteM !== siteA) {
                // Add penalty if person is assigned to both different sites
                const varMatinName = `x_${personId}_${date}_matin_${siteM}_${specialiteId}`;
                const varApresName = `x_${personId}_${date}_apres_midi_${siteA}_${specialiteId}`;
                
                // Only if both variables exist
                if (model.variables[varMatinName] && model.variables[varApresName]) {
                  // Create auxiliary variable for penalty
                  const penaltyVar = `penalty_${personId}_${date}_${siteM}_${siteA}_${specialiteId}`;
                  model.variables[penaltyVar] = {
                    objective: -PENALTY_WEIGHT,
                  };
                  model.ints[penaltyVar] = 1;
                  totalVars++;
                  
                  // Link penalty: penalty_var * 2 >= x_matin + x_apres
                  // So penalty_var = 1 only if both x_matin=1 and x_apres=1
                  const constraintName = `link_penalty_${penaltyVar}`;
                  model.constraints[constraintName] = { min: 0 };
                  model.variables[penaltyVar][constraintName] = 2;
                  model.variables[varMatinName][constraintName] = -1;
                  model.variables[varApresName][constraintName] = -1;
                }
              }
            }
          }
        }
      }
    }
  }

  console.log(`   📊 Built model with ${totalVars} variables (${Object.keys(model.constraints).length} constraints)`);

  return {
    model,
    stats: {
      totalVars: totalVars,
      totalConstraints: Object.keys(model.constraints).length,
    }
  };
}

function parseResults(
  solution: any,
  capacitesMap: Map<string, CapaciteData>,
  besoinsMap: Map<string, BesoinData>
) {
  const results: {
    date: string;
    demi_journee: DemiJournee;
    site_id: string;
    specialite_id: string;
    besoin: number;
    secretaires_assignees: string[];
    medecin_ids: string[];
  }[] = [];

  // Group assignments by (date, demi, site, specialite)
  const assignmentGroups = new Map<string, string[]>();

  for (const [varName, value] of Object.entries(solution)) {
    if (varName.startsWith('x_') && value === 1) {
      // Parse: x_person_date_demi_site_specialite
      const parts = varName.split('_');
      if (parts.length >= 6) {
        const personId = parts[1];
        const date = parts[2];
        const demi = parts[3] as DemiJournee;
        const siteId = parts[4];
        const specialiteId = parts.slice(5).join('_');

        const key = `${date}|${demi}|${siteId}|${specialiteId}`;
        if (!assignmentGroups.has(key)) {
          assignmentGroups.set(key, []);
        }
        assignmentGroups.get(key)!.push(personId);
      }
    }
  }

  // Create results for each besoin
  for (const [key, besoin] of besoinsMap) {
    const assignedPersons = assignmentGroups.get(key) || [];

    results.push({
      date: besoin.date,
      demi_journee: besoin.demi_journee,
      site_id: besoin.site_id,
      specialite_id: besoin.specialite_id,
      besoin: Math.round(besoin.besoin * 10) / 10,
      secretaires_assignees: assignedPersons,
      medecin_ids: besoin.medecin_ids,
    });
  }

  return results;
}
