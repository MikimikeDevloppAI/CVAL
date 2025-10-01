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
  prefere_port_en_truie: boolean;
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

    // Fetch secretaires data for prefere_port_en_truie
    const { data: secretaires, error: secretairesError } = await supabaseServiceRole
      .from('secretaires')
      .select('id, prefere_port_en_truie')
      .eq('actif', true);

    if (secretairesError) throw secretairesError;

    // Fetch backup data (they don't have prefere_port_en_truie)
    const { data: backups, error: backupsError } = await supabaseServiceRole
      .from('backup')
      .select('id')
      .eq('actif', true);

    if (backupsError) throw backupsError;

    console.log(`   Found ${besoins?.length || 0} besoins, ${capacites?.length || 0} capacités, ${secretaires?.length || 0} secrétaires`);

    // Transform data
    const capacitesMap = buildCapacitesMap(capacites, secretaires, backups);
    const besoinsMap = buildBesoinsMap(besoins);

    console.log(`   Transformed to ${capacitesMap.size} capacité slots, ${besoinsMap.size} besoin groups`);

    // Build and solve MILP model
    console.log('🧮 Building MILP model...');
    const { model, stats } = buildMILPModel(capacitesMap, besoinsMap, startDate, endDate);
    
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

    // Insert new planning - both site and administrative assignments
    const insertData = [];
    
    // Site assignments
    for (const r of results.filter(r => r.type === 'site')) {
      insertData.push({
        date: r.date,
        type: 'medecin',
        type_assignation: 'site',
        site_id: r.site_id,
        heure_debut: r.demi_journee === 'matin' ? DEMI_JOURNEE_SLOTS.matin.start : DEMI_JOURNEE_SLOTS.apres_midi.start,
        heure_fin: r.demi_journee === 'matin' ? DEMI_JOURNEE_SLOTS.matin.end : DEMI_JOURNEE_SLOTS.apres_midi.end,
        medecins_ids: r.medecin_ids,
        secretaires_ids: r.secretaires_assignees.filter(id => !id.startsWith('backup_')),
        backups_ids: r.secretaires_assignees.filter(id => id.startsWith('backup_')).map(id => id.replace('backup_', '')),
        statut: 'planifie',
      });
    }
    
    // Administrative assignments
    for (const r of results.filter(r => r.type === 'administratif')) {
      insertData.push({
        date: r.date,
        type: 'medecin',
        type_assignation: 'administratif',
        site_id: null,
        heure_debut: r.demi_journee === 'matin' ? DEMI_JOURNEE_SLOTS.matin.start : DEMI_JOURNEE_SLOTS.apres_midi.start,
        heure_fin: r.demi_journee === 'matin' ? DEMI_JOURNEE_SLOTS.matin.end : DEMI_JOURNEE_SLOTS.apres_midi.end,
        medecins_ids: [],
        secretaires_ids: r.secretaires_assignees.filter(id => !id.startsWith('backup_')),
        backups_ids: r.secretaires_assignees.filter(id => id.startsWith('backup_')).map(id => id.replace('backup_', '')),
        statut: 'planifie',
      });
    }

    const { error: insertError } = await supabaseServiceRole
      .from('planning_genere')
      .insert(insertData);

    if (insertError) throw insertError;

    console.log(`✅ Successfully saved ${insertData.length} planning entries (${results.filter(r => r.type === 'site').length} site, ${results.filter(r => r.type === 'administratif').length} administratif)`);

    const response = {
      success: true,
      stats: {
        total_entries: insertData.length,
        site_assignments: results.filter(r => r.type === 'site').length,
        administrative_assignments: results.filter(r => r.type === 'administratif').length,
        date_range: { start: startDate, end: endDate },
        objective_value: solution.result,
        penalties: results[0]?.penalties || {},
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
  capacites: any[],
  secretaires: any[],
  backups: any[]
): Map<string, CapaciteData> {
  const map = new Map<string, CapaciteData>();
  
  // Build lookup maps for prefere_port_en_truie
  const secretairesMap = new Map(secretaires.map(s => [s.id, s.prefere_port_en_truie || false]));

  for (const cap of capacites) {
    const personId = cap.secretaire_id ? cap.secretaire_id : `backup_${cap.backup_id}`;
    
    if (!map.has(personId)) {
      const preferePortEnTruie = cap.secretaire_id ? (secretairesMap.get(cap.secretaire_id) || false) : false;
      
      map.set(personId, {
        id: personId,
        secretaire_id: cap.secretaire_id,
        backup_id: cap.backup_id,
        specialites: cap.specialites || [],
        prefere_port_en_truie: preferePortEnTruie,
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
  besoinsMap: Map<string, BesoinData>,
  startDate: string,
  endDate: string
) {
  // Penalty constants - hierarchical (SITE_CHANGE > ESPLANADE)
  const SITE_CHANGE_PENALTY = 0.01;       // PRIORITY 1 - Changing site between matin/apres
  const ESPLANADE_BASE_PENALTY = 0.0005;  // PRIORITY 2 - Base penalty for Esplanade assignment
  
  // Esplanade site ID
  const ESPLANADE_SITE_ID = '043899a1-a232-4c4b-9d7d-0eb44dad00ad';
  
  const model: any = {
    optimize: 'objective',
    opType: 'max',
    constraints: {},
    variables: {},
    ints: {},
  };

  let totalVars = 0;

  // Pre-calculate which sites each person could work at for each date/specialty
  const personDateSpecSites = new Map<string, { matin: Set<string>, apres: Set<string> }>();
  
  for (const [personId, capData] of capacitesMap) {
    for (const slot of capData.slots) {
      for (const specialiteId of capData.specialites) {
        const key = `${personId}_${slot.date}_${specialiteId}`;
        if (!personDateSpecSites.has(key)) {
          personDateSpecSites.set(key, { matin: new Set(), apres: new Set() });
        }
        
        const sites = personDateSpecSites.get(key)!;
        for (const [_, besoin] of besoinsMap) {
          if (besoin.date === slot.date && besoin.demi_journee === slot.demi_journee && besoin.specialite_id === specialiteId) {
            if (slot.demi_journee === 'matin') {
              sites.matin.add(besoin.site_id);
            } else {
              sites.apres.add(besoin.site_id);
            }
          }
        }
      }
    }
  }
  
  // Track Esplanade assignments per person for progressive penalty
  const esplanadeAssignmentsPerPerson = new Map<string, number>();

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
            
            // Contribution based on REAL need (non-rounded)
            let contributionPercent = 100 / besoin.besoin;
            
            // PRIORITY 1: Site change penalty (highest)
            const siteKey = `${personId}_${date}_${specialiteId}`;
            const sitesInfo = personDateSpecSites.get(siteKey);
            
            if (sitesInfo) {
              // If person works both matin and apres for this spec/date
              if (sitesInfo.matin.size > 0 && sitesInfo.apres.size > 0) {
                // Check if there are different sites in matin vs apres
                const otherDemi = demi === 'matin' ? 'apres' : 'matin';
                const otherSites = demi === 'matin' ? sitesInfo.apres : sitesInfo.matin;
                
                // If current site is not in the other demi, apply strong penalty
                if (otherSites.size > 0 && !otherSites.has(besoin.site_id)) {
                  contributionPercent -= SITE_CHANGE_PENALTY;
                }
              }
            }
            
            // PRIORITY 2: Progressive Esplanade penalty
            if (besoin.site_id === ESPLANADE_SITE_ID && !capData.prefere_port_en_truie) {
              // Get current count of Esplanade assignments for this person
              const currentCount = esplanadeAssignmentsPerPerson.get(personId) || 0;
              // Apply progressive penalty: 1st time = 1x, 2nd time = 2x, 3rd time = 3x, etc.
              const progressivePenalty = ESPLANADE_BASE_PENALTY * (currentCount + 1);
              contributionPercent -= progressivePenalty;
              
              // Track that this variable could assign to Esplanade
              esplanadeAssignmentsPerPerson.set(personId, currentCount + 1);
            }
            
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
  
  // Add administrative assignment variables
  // These are used when needs are satisfied and secretaries are available
  for (const [personId, capData] of capacitesMap) {
    for (const slot of capData.slots) {
      const varName = `admin_${personId}_${slot.date}_${slot.demi_journee}`;
      
      // Small positive value to encourage administrative assignments when possible
      model.variables[varName] = {
        objective: 0.00001, // Very small to not affect main optimization
        [`uniqueness_${personId}_${slot.date}_${slot.demi_journee}`]: 1,
        [`admin_assignment_${slot.date}_${slot.demi_journee}`]: 1,
      };
      
      model.ints[varName] = 1;
      totalVars++;
    }
  }

  // Uniqueness constraints: each person assigned to at most 1 site/specialty per (date, demi)
  for (const [personId, capData] of capacitesMap) {
    for (const slot of capData.slots) {
      const constraintName = `uniqueness_${personId}_${slot.date}_${slot.demi_journee}`;
      model.constraints[constraintName] = { max: 1 };
    }
  }

  // Capacity constraints: max secretaries per besoin = ceil(besoin)
  for (const [key, besoin] of besoinsMap) {
    const maxCapacity = Math.ceil(besoin.besoin);
    const constraintName = `capacity_${besoin.date}_${besoin.demi_journee}_${besoin.site_id}_${besoin.specialite_id}`;
    model.constraints[constraintName] = { max: maxCapacity };
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
    site_id?: string;
    specialite_id?: string;
    besoin?: number;
    secretaires_assignees: string[];
    medecin_ids: string[];
    type: 'site' | 'administratif';
    penalties?: any;
  }[] = [];

  // Group site assignments by (date, demi, site, specialite)
  const assignmentGroups = new Map<string, string[]>();
  
  // Group administrative assignments by (date, demi)
  const adminAssignments = new Map<string, string[]>();

  // Track penalties
  let siteChangeCount = 0;
  let esplanadeAssignments = 0;
  const esplanadePerPerson = new Map<string, number>();

  for (const [varName, value] of Object.entries(solution)) {
    if (value === 1) {
      if (varName.startsWith('x_')) {
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
          
          // Track Esplanade assignments
          if (siteId === '043899a1-a232-4c4b-9d7d-0eb44dad00ad') {
            esplanadeAssignments++;
            esplanadePerPerson.set(personId, (esplanadePerPerson.get(personId) || 0) + 1);
          }
        }
      } else if (varName.startsWith('admin_')) {
        // Parse: admin_person_date_demi
        const parts = varName.split('_');
        if (parts.length >= 4) {
          const personId = parts[1];
          const date = parts[2];
          const demi = parts[3] as DemiJournee;
          
          const key = `${date}|${demi}`;
          if (!adminAssignments.has(key)) {
            adminAssignments.set(key, []);
          }
          adminAssignments.get(key)!.push(personId);
        }
      }
    }
  }

  // Create results for each besoin (site assignments)
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
      type: 'site',
      penalties: {
        site_changes: siteChangeCount,
        esplanade_assignments: esplanadeAssignments,
        esplanade_per_person: Object.fromEntries(esplanadePerPerson),
      },
    });
  }
  
  // Create results for administrative assignments
  for (const [key, persons] of adminAssignments) {
    const [date, demi] = key.split('|');
    
    results.push({
      date,
      demi_journee: demi as DemiJournee,
      secretaires_assignees: persons,
      medecin_ids: [],
      type: 'administratif',
    });
  }

  return results;
}
