import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import solver from 'https://esm.sh/javascript-lp-solver@0.4.24';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('🏥 Phase 1: Starting bloc operatoire MILP optimization');
    
    const supabaseServiceRole = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { single_day } = await req.json().catch(() => ({}));
    if (!single_day) {
      throw new Error('single_day parameter is required');
    }

    console.log(`📅 Optimizing bloc for day: ${single_day}`);

    // Get Bloc operatoire site ID
    const { data: blocSite, error: blocSiteError } = await supabaseServiceRole
      .from('sites')
      .select('id')
      .ilike('nom', '%Bloc opératoire%')
      .single();
    
    if (blocSiteError) throw blocSiteError;
    const blocSiteId = blocSite.id;

    // 1. Fetch data
    const [
      { data: typesIntervention, error: tiError },
      { data: besoinsEffectifs, error: beError },
      { data: personnelBloc, error: pbError },
      { data: capacites, error: capError },
      { data: configurationsMultiFlux, error: cmfError }
    ] = await Promise.all([
      supabaseServiceRole.from('types_intervention').select(`
        *,
        types_intervention_besoins_personnel(type_besoin, nombre_requis)
      `).eq('actif', true),
      supabaseServiceRole.from('besoin_effectif').select('*')
        .eq('date', single_day)
        .eq('site_id', blocSiteId)
        .not('type_intervention_id', 'is', null)
        .eq('actif', true),
      supabaseServiceRole.from('secretaires').select('*')
        .eq('personnel_bloc_operatoire', true).eq('actif', true),
      supabaseServiceRole.from('capacite_effective').select('*')
        .eq('date', single_day).eq('actif', true),
      supabaseServiceRole.from('configurations_multi_flux').select(`
        *,
        configurations_multi_flux_interventions(type_intervention_id, salle, ordre)
      `).eq('actif', true)
    ]);

    if (tiError) throw tiError;
    if (beError) throw beError;
    if (pbError) throw pbError;
    if (capError) throw capError;
    if (cmfError) throw cmfError;

    // Créer les opérations à partir des besoins
    // Si demi_journee = 'toute_journee', créer DEUX opérations (matin + après-midi)
    const operations: any[] = [];
    for (const be of besoinsEffectifs || []) {
      if (be.demi_journee === 'toute_journee') {
        operations.push({
          id: be.id,
          date: be.date,
          type_intervention_id: be.type_intervention_id,
          medecin_id: be.medecin_id,
          demi_journee: 'matin'
        });
        operations.push({
          id: be.id,
          date: be.date,
          type_intervention_id: be.type_intervention_id,
          medecin_id: be.medecin_id,
          demi_journee: 'apres_midi'
        });
      } else {
        operations.push({
          id: be.id,
          date: be.date,
          type_intervention_id: be.type_intervention_id,
          medecin_id: be.medecin_id,
          demi_journee: be.demi_journee
        });
      }
    }

    console.log(`✓ ${operations.length} operations, ${personnelBloc.length} personnel bloc`);

    if (operations.length === 0) {
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'No bloc operations for this day',
        blocs_assigned: 0,
        personnel_assigned: 0
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Create maps
    const typesInterventionMap = new Map(typesIntervention.map(t => [t.id, t]));
    const capacitesMap = new Map();
    capacites.forEach(c => {
      const key = `${c.secretaire_id || c.backup_id}_${c.demi_journee}`;
      if (!capacitesMap.has(key)) capacitesMap.set(key, []);
      capacitesMap.get(key).push(c);
    });

    // 2. Assign rooms
    const roomAssignments = assignRooms(operations, typesInterventionMap, configurationsMultiFlux);

    // 3. Get or create planning_id
    const weekStart = getWeekStart(new Date(single_day));
    const weekEnd = getWeekEnd(new Date(single_day));
    const weekStartStr = weekStart.toISOString().split('T')[0];
    const weekEndStr = weekEnd.toISOString().split('T')[0];

    let planning_id;
    const { data: existingPlanning } = await supabaseServiceRole
      .from('planning')
      .select('*')
      .eq('date_debut', weekStartStr)
      .eq('date_fin', weekEndStr)
      .maybeSingle();

    if (existingPlanning) {
      planning_id = existingPlanning.id;
    } else {
      const { data: newPlanning, error: planningError } = await supabaseServiceRole
        .from('planning')
        .insert({
          date_debut: weekStartStr,
          date_fin: weekEndStr,
          statut: 'en_cours'
        })
        .select()
        .single();
      if (planningError) throw planningError;
      planning_id = newPlanning.id;
    }

    // 4. Build MILP for personnel
    const personnelAssignments = await buildAndSolveBlocPersonnelMILP(
      operations,
      personnelBloc,
      typesInterventionMap,
      capacitesMap
    );

    // 5. Save results
    const results = await saveBlocAssignments(
      roomAssignments,
      personnelAssignments,
      planning_id,
      single_day,
      operations,
      typesInterventionMap,
      supabaseServiceRole
    );

    console.log(`✅ Phase 1 complete: ${results.blocs_assigned} operations, ${results.personnel_assigned} personnel`);

    return new Response(JSON.stringify({
      success: true,
      ...results
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('❌ Bloc optimization error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

function getWeekEnd(date: Date): Date {
  const start = getWeekStart(date);
  return new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);
}

function assignRooms(operations: any[], typesMap: Map<string, any>, multiFluxConfigs: any[]) {
  const assignments: any[] = [];
  const roomSchedules: Record<string, Record<string, any[]>> = { 
    rouge: { matin: [], apres_midi: [] }, 
    verte: { matin: [], apres_midi: [] }, 
    jaune: { matin: [], apres_midi: [] } 
  };
  
  const sorted = operations.sort((a, b) => {
    const typeA = typesMap.get(a.type_intervention_id);
    const typeB = typesMap.get(b.type_intervention_id);
    if (typeA?.salle_preferentielle && !typeB?.salle_preferentielle) return -1;
    if (!typeA?.salle_preferentielle && typeB?.salle_preferentielle) return 1;
    return a.demi_journee.localeCompare(b.demi_journee);
  });
  
  for (const operation of sorted) {
    const typeIntervention = typesMap.get(operation.type_intervention_id);
    let assignedRoom = null;
    
    // Try preferred room first
    if (typeIntervention?.salle_preferentielle) {
      const preferred = typeIntervention.salle_preferentielle;
      if (isRoomAvailable(preferred, operation.demi_journee, roomSchedules)) {
        assignedRoom = preferred;
      }
    }
    
    // Fallback: first available room
    if (!assignedRoom) {
      for (const room of ['rouge', 'verte', 'jaune']) {
        if (isRoomAvailable(room, operation.demi_journee, roomSchedules)) {
          assignedRoom = room;
          break;
        }
      }
    }
    
    if (!assignedRoom) {
      console.warn(`⚠️ Cannot assign room for operation ${operation.id}`);
      continue;
    }
    
    roomSchedules[assignedRoom][operation.demi_journee].push(operation.id);
    
    assignments.push({
      operation_id: operation.id,
      salle: assignedRoom,
      demi_journee: operation.demi_journee
    });
  }
  
  return assignments;
}

function isRoomAvailable(room: string, demi_journee: string, schedules: any): boolean {
  const schedule = schedules[room]?.[demi_journee] || [];
  return schedule.length === 0; // Une seule opération par salle par demi-journée
}


function buildAndSolveBlocPersonnelMILP(
  operations: any[],
  personnelBloc: any[],
  typesMap: Map<string, any>,
  capacitesMap: Map<string, any>
): any {
  const model: any = {
    optimize: 'score',
    opType: 'max',
    constraints: {},
    variables: {},
    ints: {}
  };
  
  console.log(`\n🔍 Building MILP for ${operations.length} operations and ${personnelBloc.length} personnel`);
  
  let totalVariables = 0;
  
  for (const operation of operations) {
    const typeIntervention = typesMap.get(operation.type_intervention_id);
    const besoins = typeIntervention?.types_intervention_besoins_personnel || [];
    
    console.log(`  📋 Operation ${operation.id} (${typeIntervention?.nom}): ${besoins.length} besoins`);
    
    if (besoins.length === 0) {
      console.warn(`  ⚠️ No personnel needs defined for ${typeIntervention?.nom}`);
    }
    
    for (const besoin of besoins) {
      const eligible = getEligibleSecretaries(
        besoin.type_besoin,
        operation,
        personnelBloc,
        capacitesMap
      );
      
      console.log(`    👥 ${besoin.type_besoin} (x${besoin.nombre_requis}): ${eligible.length} eligible`);
      
      if (eligible.length === 0) {
        console.warn(`    ⚠️ NO ELIGIBLE SECRETARIES for ${besoin.type_besoin}`);
        continue;
      }
      
      // Score différencié selon type de besoin
      const score = (besoin.type_besoin === 'accueil_ophtalmo' || besoin.type_besoin === 'accueil_dermato') 
        ? 0.5 
        : 1.0;
      
      for (let ordre = 1; ordre <= besoin.nombre_requis; ordre++) {
        for (const sec of eligible) {
          const varName = `x_${sec.id}_${operation.id}_${operation.demi_journee}_${besoin.type_besoin}_${ordre}`;
          
          model.variables[varName] = {
            score: score,
            [`need_${operation.id}_${operation.demi_journee}_${besoin.type_besoin}`]: 1,
            [`capacity_${sec.id}_${operation.demi_journee}`]: 1
          };
          model.ints[varName] = 1;
          totalVariables++;
        }
      }
      
      model.constraints[`need_${operation.id}_${operation.demi_journee}_${besoin.type_besoin}`] = {
        equal: besoin.nombre_requis
      };
    }
  }
  
  console.log(`  📊 Total variables: ${totalVariables}`);
  
  // Unicité temporelle par demi-journée
  for (const sec of personnelBloc) {
    for (const demiJournee of ['matin', 'apres_midi', 'toute_journee']) {
      model.constraints[`capacity_${sec.id}_${demiJournee}`] = {
        max: 1
      };
    }
  }
  
  console.log(`  🔧 Solving MILP...`);
  const solution = solver.Solve(model);
  console.log(`  ✅ Solution feasible: ${solution.feasible !== false}`);
  
  return solution;
}

function getEligibleSecretaries(
  type_besoin: string,
  operation: any,
  personnelBloc: any[],
  capacitesMap: Map<string, any>
): any[] {
  let eligible = personnelBloc.filter(s => 
    isAvailableForOperation(s.id, operation.demi_journee, capacitesMap)
  );
  
  switch (type_besoin) {
    case 'instrumentiste':
      eligible = eligible.filter(s => s.instrumentaliste);
      break;
    case 'aide_salle':
      eligible = eligible.filter(s => s.aide_de_salle);
      break;
    case 'instrumentiste_aide_salle':
      eligible = eligible.filter(s => s.instrumentaliste);
      break;
    case 'accueil_dermato':
      eligible = eligible.filter(s => s.bloc_dermato_accueil);
      break;
    case 'accueil_ophtalmo':
      eligible = eligible.filter(s => s.bloc_ophtalmo_accueil);
      break;
    case 'anesthesiste':
      eligible = eligible.filter(s => s.anesthesiste);
      break;
  }
  
  return eligible;
}

function isAvailableForOperation(secId: string, demi_journee: string, capacitesMap: Map<string, any>): boolean {
  const key = `${secId}_${demi_journee}`;
  const keyTouteJournee = `${secId}_toute_journee`;
  return capacitesMap.has(key) || capacitesMap.has(keyTouteJournee);
}

async function saveBlocAssignments(
  roomAssignments: any[],
  personnelSolution: any,
  planning_id: string,
  single_day: string,
  operations: any[],
  typesMap: Map<string, any>,
  supabase: any
) {
  console.log(`\n💾 Saving ${roomAssignments.length} bloc assignments...`);
  
  // Save bloc operations with rooms (utilise periode)
  const blocRows = roomAssignments.map(ra => {
    const operation = operations.find(b => b.id === ra.operation_id && b.demi_journee === ra.demi_journee);
    
    return {
      planning_id,
      date: single_day,
      type_intervention_id: operation.type_intervention_id,
      medecin_id: operation.medecin_id,
      salle_assignee: ra.salle,
      periode: ra.demi_journee,
      statut: 'planifie'
    };
  });
  
  const { data: savedBlocs, error: blocError } = await supabase
    .from('planning_genere_bloc_operatoire')
    .insert(blocRows)
    .select();
  
  if (blocError) throw blocError;
  console.log(`  ✅ ${savedBlocs.length} blocs saved`);
  
  // Save personnel assignments
  const personnelRows = [];
  for (const [varName, value] of Object.entries(personnelSolution)) {
    if (varName.startsWith('x_') && (value as number) > 0.5) {
      const parts = varName.split('_');
      const secId = parts[1];
      const opId = parts[2];
      const periode = parts[3];
      const ordre = parseInt(parts[parts.length - 1]);
      // Le type_besoin est tout ce qui reste entre periode et ordre
      const typeBesoin = parts.slice(4, parts.length - 1).join('_');
      
      const operation = operations.find((o: any) => o.id === opId && o.demi_journee === periode);
      if (!operation) continue;
      
      // Match by both type_intervention_id AND periode
      const blocId = savedBlocs.find((b: any) => 
        b.type_intervention_id === operation.type_intervention_id &&
        b.periode === operation.demi_journee
      )?.id;
      
      if (blocId) {
        personnelRows.push({
          planning_genere_bloc_operatoire_id: blocId,
          type_besoin: typeBesoin,
          secretaire_id: secId,
          ordre
        });
      }
    }
  }
  
  console.log(`  👥 ${personnelRows.length} personnel assignments to save`);
  
  if (personnelRows.length > 0) {
    const { error: personnelError } = await supabase
      .from('planning_genere_bloc_personnel')
      .insert(personnelRows);
    
    if (personnelError) {
      console.error('  ❌ Personnel error:', personnelError);
      throw personnelError;
    }
    console.log(`  ✅ ${personnelRows.length} personnel saved`);
  }
  
  return {
    blocs_assigned: savedBlocs.length,
    personnel_assigned: personnelRows.length
  };
}
