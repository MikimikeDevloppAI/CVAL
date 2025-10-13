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

    // 1. Fetch data
    const [
      { data: typesIntervention, error: tiError },
      { data: besoinsEffectifs, error: beError },
      { data: blocsBesoins, error: bbError },
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
        .eq('type', 'bloc_operatoire')
        .eq('actif', true),
      supabaseServiceRole.from('bloc_operatoire_besoins').select('*')
        .eq('date', single_day)
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
    if (bbError) throw bbError;
    if (pbError) throw pbError;
    if (capError) throw capError;
    if (cmfError) throw cmfError;

    // Joindre manuellement besoins_effectifs avec bloc_operatoire_besoins
    const blocsBesoinsMap = new Map(blocsBesoins.map(b => [b.id, b]));
    const operations = besoinsEffectifs
      .filter(be => be.bloc_operatoire_besoin_id && blocsBesoinsMap.has(be.bloc_operatoire_besoin_id))
      .map(be => {
        const blocInfo = blocsBesoinsMap.get(be.bloc_operatoire_besoin_id);
        return {
          id: be.id,
          bloc_operatoire_besoin_id: be.bloc_operatoire_besoin_id,
          date: be.date,
          type_intervention_id: be.type_intervention_id,
          heure_debut: blocInfo.heure_debut,
          heure_fin: blocInfo.heure_fin,
          specialite_id: blocInfo.specialite_id
        };
      });

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
  const roomSchedules: Record<string, any[]> = { rouge: [], verte: [], jaune: [] };
  
  const sorted = operations.sort((a, b) => {
    const typeA = typesMap.get(a.type_intervention_id);
    const typeB = typesMap.get(b.type_intervention_id);
    if (typeA?.salle_preferentielle && !typeB?.salle_preferentielle) return -1;
    if (!typeA?.salle_preferentielle && typeB?.salle_preferentielle) return 1;
    return a.heure_debut.localeCompare(b.heure_debut);
  });
  
  for (const operation of sorted) {
    const typeIntervention = typesMap.get(operation.type_intervention_id);
    let assignedRoom = null;
    
    // Try preferred room first
    if (typeIntervention?.salle_preferentielle) {
      const preferred = typeIntervention.salle_preferentielle;
      if (isRoomAvailable(preferred, operation.heure_debut, operation.heure_fin, roomSchedules)) {
        assignedRoom = preferred;
      }
    }
    
    // Try multi-flux if preferred is occupied
    if (!assignedRoom && multiFluxConfigs.length > 0) {
      const compatibleConfig = findCompatibleMultiFluxConfig(operation, roomSchedules, multiFluxConfigs, typesMap);
      if (compatibleConfig) {
        assignedRoom = compatibleConfig.salle_suggeree;
      }
    }
    
    // Fallback: first available room
    if (!assignedRoom) {
      for (const room of ['rouge', 'verte', 'jaune']) {
        if (isRoomAvailable(room, operation.heure_debut, operation.heure_fin, roomSchedules)) {
          assignedRoom = room;
          break;
        }
      }
    }
    
    if (!assignedRoom) {
      console.warn(`⚠️ Cannot assign room for operation ${operation.id}`);
      continue;
    }
    
    roomSchedules[assignedRoom].push({
      heure_debut: operation.heure_debut,
      heure_fin: operation.heure_fin
    });
    
    assignments.push({
      operation_id: operation.id,
      salle: assignedRoom,
      heure_debut: operation.heure_debut,
      heure_fin: operation.heure_fin
    });
  }
  
  return assignments;
}

function isRoomAvailable(room: string, debut: string, fin: string, schedules: any): boolean {
  const schedule = schedules[room] || [];
  for (const slot of schedule) {
    if (debut < slot.heure_fin && fin > slot.heure_debut) {
      return false;
    }
  }
  return true;
}

function findCompatibleMultiFluxConfig(operation: any, roomSchedules: any, configs: any[], typesMap: Map<string, any>): any {
  // Simplified multi-flux logic
  return null;
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
  
  for (const operation of operations) {
    const typeIntervention = typesMap.get(operation.type_intervention_id);
    const besoins = typeIntervention?.types_intervention_besoins_personnel || [];
    
    for (const besoin of besoins) {
      const eligible = getEligibleSecretaries(
        besoin.type_besoin,
        operation,
        personnelBloc,
        capacitesMap
      );
      
      // Score différencié selon type de besoin
      const score = (besoin.type_besoin === 'accueil_ophtalmo' || besoin.type_besoin === 'accueil_dermato') 
        ? 0.5 
        : 1.0;
      
      for (let ordre = 1; ordre <= besoin.nombre_requis; ordre++) {
        for (const sec of eligible) {
          const varName = `x_${sec.id}_${operation.id}_${besoin.type_besoin}_${ordre}`;
          
          model.variables[varName] = {
            score: score,
            [`need_${operation.id}_${besoin.type_besoin}`]: 1,
            [`capacity_${sec.id}_${operation.heure_debut}`]: 1
          };
          model.ints[varName] = 1;
        }
      }
      
      model.constraints[`need_${operation.id}_${besoin.type_besoin}`] = {
        equal: besoin.nombre_requis
      };
    }
  }
  
  // Unicité temporelle
  for (const sec of personnelBloc) {
    const timeSlots = getUniqueTimeSlots(operations);
    for (const timeSlot of timeSlots) {
      model.constraints[`capacity_${sec.id}_${timeSlot.debut}`] = {
        max: 1
      };
    }
  }
  
  const solution = solver.Solve(model);
  return solution;
}

function getEligibleSecretaries(
  type_besoin: string,
  operation: any,
  personnelBloc: any[],
  capacitesMap: Map<string, any>
): any[] {
  let eligible = personnelBloc.filter(s => 
    isAvailableForOperation(s.id, operation.heure_debut, operation.heure_fin, capacitesMap)
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

function isAvailableForOperation(secId: string, debut: string, fin: string, capacitesMap: Map<string, any>): boolean {
  const periode = debut < '12:30:00' ? 'matin' : 'apres_midi';
  const key = `${secId}_${periode}`;
  return capacitesMap.has(key);
}

function getUniqueTimeSlots(operations: any[]): any[] {
  const slots = new Set();
  operations.forEach(op => {
    slots.add(op.heure_debut);
  });
  return Array.from(slots).map(debut => ({ debut }));
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
  // Save bloc operations with rooms
  const blocRows = roomAssignments.map(ra => {
    const operation = operations.find(b => b.id === ra.operation_id);
    return {
      planning_id,
      date: single_day,
      bloc_operatoire_besoin_id: operation.bloc_operatoire_besoin_id,
      type_intervention_id: operation.type_intervention_id,
      salle_assignee: ra.salle,
      heure_debut: ra.heure_debut,
      heure_fin: ra.heure_fin,
      statut: 'planifie'
    };
  });
  
  const { data: savedBlocs, error: blocError } = await supabase
    .from('planning_genere_bloc_operatoire')
    .insert(blocRows)
    .select();
  
  if (blocError) throw blocError;
  
  // Save personnel assignments
  const personnelRows = [];
  for (const [varName, value] of Object.entries(personnelSolution)) {
    if (varName.startsWith('x_') && (value as number) > 0.5) {
      const parts = varName.split('_');
      const secId = parts[1];
      const opId = parts[2];
      const typeBesoin = parts[3];
      const ordre = parseInt(parts[4]);
      
      const blocId = savedBlocs.find((b: any) => b.bloc_operatoire_besoin_id === opId)?.id;
      
      personnelRows.push({
        planning_genere_bloc_operatoire_id: blocId,
        type_besoin: typeBesoin,
        secretaire_id: secId,
        ordre
      });
    }
  }
  
  if (personnelRows.length > 0) {
    const { error: personnelError } = await supabase
      .from('planning_genere_bloc_personnel')
      .insert(personnelRows);
    
    if (personnelError) throw personnelError;
  }
  
  return {
    blocs_assigned: savedBlocs.length,
    personnel_assigned: personnelRows.length
  };
}
