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

    const { week_start, week_end, selected_dates, planning_id: provided_planning_id } = await req.json().catch(() => ({}));
    if (!week_start || !week_end) {
      throw new Error('week_start and week_end parameters are required');
    }

    const allDates = [];
    let currentDate = new Date(week_start);
    const endDate = new Date(week_end);
    while (currentDate <= endDate) {
      allDates.push(currentDate.toISOString().split('T')[0]);
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Filter dates if selected_dates provided
    const dates = selected_dates && selected_dates.length > 0 ? selected_dates : allDates;
    
    console.log(`📅 Optimizing bloc for ${dates.length} date(s):`, dates);
    console.log(`📋 Filtering besoins to selected dates only: ${dates.join(', ')}`);

    // Get Bloc operatoire site ID
    const { data: blocSite, error: blocSiteError } = await supabaseServiceRole
      .from('sites')
      .select('id')
      .ilike('nom', '%Bloc opératoire%')
      .single();
    
    if (blocSiteError) throw blocSiteError;
    const blocSiteId = blocSite.id;

    // 1. Fetch data - restrict to selected dates only
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
      // CRITICAL: Only fetch besoins for selected dates to avoid duplicates
      supabaseServiceRole.from('besoin_effectif').select('*')
        .in('date', dates)  // Use dates (selected_dates or allDates)
        .eq('site_id', blocSiteId)
        .not('type_intervention_id', 'is', null)
        .eq('actif', true),
      supabaseServiceRole.from('secretaires').select('*')
        .eq('personnel_bloc_operatoire', true).eq('actif', true),
      supabaseServiceRole.from('capacite_effective').select('*')
        .gte('date', week_start)
        .lte('date', week_end)
        .eq('actif', true),
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
      const key = `${c.date}_${c.secretaire_id || c.backup_id}_${c.demi_journee}`;
      if (!capacitesMap.has(key)) capacitesMap.set(key, []);
      capacitesMap.get(key).push(c);
    });

    // 2. Assign rooms
    const roomAssignments = assignRooms(operations, typesInterventionMap, configurationsMultiFlux);

    // 3. Use provided planning_id or fallback to create/find one
    let planning_id = provided_planning_id;
    
    if (!planning_id) {
      // Fallback: normalize to ISO week and search/create
      const firstDate = new Date(week_start + 'T00:00:00Z');
      const dayOfWeek = firstDate.getUTCDay();
      const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const isoWeekStart = new Date(firstDate);
      isoWeekStart.setUTCDate(firstDate.getUTCDate() - daysFromMonday);
      const isoWeekEnd = new Date(isoWeekStart);
      isoWeekEnd.setUTCDate(isoWeekStart.getUTCDate() + 6);
      
      const weekStartNorm = isoWeekStart.toISOString().split('T')[0];
      const weekEndNorm = isoWeekEnd.toISOString().split('T')[0];
      
      const { data: existingPlanning } = await supabaseServiceRole
        .from('planning')
        .select('*')
        .eq('date_debut', weekStartNorm)
        .eq('date_fin', weekEndNorm)
        .maybeSingle();

      if (existingPlanning) {
        planning_id = existingPlanning.id;
        console.log(`📋 Found existing planning: ${planning_id}`);
      } else {
        const { data: newPlanning, error: planningError } = await supabaseServiceRole
          .from('planning')
          .insert({
            date_debut: weekStartNorm,
            date_fin: weekEndNorm,
            statut: 'en_cours'
          })
          .select()
          .single();
        if (planningError) throw planningError;
        planning_id = newPlanning.id;
        console.log(`📋 Created new planning: ${planning_id}`);
      }
    } else {
      console.log(`📋 Using provided planning_id: ${planning_id}`);
    }

    // 4. Save bloc operations and create personnel rows
    const { savedBlocs, personnelRows } = await createBlocAndPersonnelRows(
      roomAssignments,
      planning_id,
      operations,
      typesInterventionMap,
      supabaseServiceRole
    );

    // 5. Build MILP to assign personnel to rows
    const personnelAssignments = buildAndSolveBlocPersonnelMILP(
      personnelRows,
      personnelBloc,
      capacitesMap
    );

    // 6. Update personnel rows with assignments
    const results = await updatePersonnelAssignments(
      personnelRows,
      personnelAssignments,
      savedBlocs.length,
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
  
  // Structure: roomSchedules[room][date][periode] = [operation_ids]
  const roomSchedules: Record<string, Record<string, Record<string, any[]>>> = { 
    rouge: {}, 
    verte: {}, 
    jaune: {} 
  };
  
  // Initialize for all dates and periods
  const dates = [...new Set(operations.map(op => op.date))];
  for (const room of ['rouge', 'verte', 'jaune']) {
    for (const date of dates) {
      roomSchedules[room][date] = { matin: [], apres_midi: [] };
    }
  }
  
  // Group operations by date, demi_journee, and type_intervention_id
  const groupedOps = new Map<string, any[]>();
  for (const op of operations) {
    const key = `${op.date}_${op.demi_journee}_${op.type_intervention_id}`;
    if (!groupedOps.has(key)) groupedOps.set(key, []);
    groupedOps.get(key)!.push(op);
  }
  
  console.log(`📦 Grouped operations into ${groupedOps.size} groups for multi-flux detection`);
  
  // Process each group and check for multi-flux configurations
  const processedOps = new Set<string>();
  
  for (const [groupKey, groupOps] of groupedOps.entries()) {
    const [date, demi_journee, type_intervention_id] = groupKey.split('_');
    const count = groupOps.length;
    
    if (count >= 2) {
      // Look for multi-flux configuration
      const targetType = count === 2 ? 'double_flux' : count === 3 ? 'triple_flux' : null;
      
      if (targetType) {
        const config = multiFluxConfigs.find(c => 
          c.type_flux === targetType &&
          c.configurations_multi_flux_interventions?.some((i: any) => i.type_intervention_id === type_intervention_id)
        );
        
        if (config) {
          console.log(`✓ Found ${targetType} config for type ${type_intervention_id}: ${config.nom}`);
          
          // Get interventions with their assigned rooms
          const interventions = config.configurations_multi_flux_interventions
            .filter((i: any) => i.type_intervention_id === type_intervention_id)
            .sort((a: any, b: any) => a.ordre - b.ordre);
          
          if (interventions.length === count) {
            // Assign rooms according to configuration
            let allRoomsAvailable = true;
            const roomsToAssign: string[] = [];
            
            for (const intervention of interventions) {
              const room = intervention.salle;
              if (!isRoomAvailable(room, date, demi_journee, roomSchedules)) {
                allRoomsAvailable = false;
                console.warn(`⚠️ Room ${room} not available for multi-flux config ${config.nom}`);
                break;
              }
              roomsToAssign.push(room);
            }
            
            if (allRoomsAvailable) {
              // Assign operations to rooms from configuration
              for (let i = 0; i < groupOps.length; i++) {
                const operation = groupOps[i];
                const assignedRoom = roomsToAssign[i];
                
                roomSchedules[assignedRoom][date][demi_journee].push(operation.id);
                assignments.push({
                  operation_id: operation.id,
                  salle: assignedRoom,
                  demi_journee: operation.demi_journee
                });
                processedOps.add(operation.id + '_' + operation.demi_journee);
              }
              
              console.log(`✓ Assigned ${count} operations using ${targetType} config: ${roomsToAssign.join(', ')}`);
              continue;
            }
          }
        }
      }
    }
    
    // Fallback: no multi-flux config or not available, assign individually
    // But respect preferences and handle conflicts
    const remainingOps = groupOps.filter(op => !processedOps.has(op.id + '_' + op.demi_journee));
    
    if (remainingOps.length > 0) {
      // Group by preference
      const byPreference = new Map<string, any[]>();
      const noPreference: any[] = [];
      
      for (const op of remainingOps) {
        const typeIntervention = typesMap.get(op.type_intervention_id);
        const pref = typeIntervention?.salle_preferentielle;
        
        if (pref) {
          if (!byPreference.has(pref)) byPreference.set(pref, []);
          byPreference.get(pref)!.push(op);
        } else {
          noPreference.push(op);
        }
      }
      
      // Assign operations with preferences
      for (const [preferredRoom, ops] of byPreference.entries()) {
        // Check if preferred room is available
        if (isRoomAvailable(preferredRoom, date, demi_journee, roomSchedules) && ops.length === 1) {
          // Single operation with preference: assign to preferred room
          const op = ops[0];
          roomSchedules[preferredRoom][date][demi_journee].push(op.id);
          assignments.push({
            operation_id: op.id,
            salle: preferredRoom,
            demi_journee: op.demi_journee
          });
          processedOps.add(op.id + '_' + op.demi_journee);
        } else {
          // Multiple ops want same room OR room not available: distribute randomly
          const shuffled = [...ops].sort(() => Math.random() - 0.5);
          
          for (const op of shuffled) {
            const opKey = op.id + '_' + op.demi_journee;
            if (processedOps.has(opKey)) continue;
            
            let assignedRoom = null;
            
            // Try preferred room first
            if (isRoomAvailable(preferredRoom, date, demi_journee, roomSchedules)) {
              assignedRoom = preferredRoom;
            } else {
              // Fallback: first available room
              for (const room of ['rouge', 'verte', 'jaune']) {
                if (isRoomAvailable(room, date, demi_journee, roomSchedules)) {
                  assignedRoom = room;
                  break;
                }
              }
            }
            
            if (!assignedRoom) {
              console.warn(`⚠️ Cannot assign room for operation ${op.id}`);
              continue;
            }
            
            roomSchedules[assignedRoom][date][demi_journee].push(op.id);
            assignments.push({
              operation_id: op.id,
              salle: assignedRoom,
              demi_journee: op.demi_journee
            });
            processedOps.add(opKey);
          }
        }
      }
      
      // Assign operations without preference (distribute randomly)
      const shuffledNoPreference = [...noPreference].sort(() => Math.random() - 0.5);
      for (const op of shuffledNoPreference) {
        const opKey = op.id + '_' + op.demi_journee;
        if (processedOps.has(opKey)) continue;
        
        let assignedRoom = null;
        for (const room of ['rouge', 'verte', 'jaune']) {
          if (isRoomAvailable(room, date, demi_journee, roomSchedules)) {
            assignedRoom = room;
            break;
          }
        }
        
        if (!assignedRoom) {
          console.warn(`⚠️ Cannot assign room for operation ${op.id}`);
          continue;
        }
        
        roomSchedules[assignedRoom][date][demi_journee].push(op.id);
        assignments.push({
          operation_id: op.id,
          salle: assignedRoom,
          demi_journee: op.demi_journee
        });
        processedOps.add(opKey);
      }
    }
  }
  
  return assignments;
}

function isRoomAvailable(room: string, date: string, demi_journee: string, schedules: any): boolean {
  const schedule = schedules[room]?.[date]?.[demi_journee] || [];
  return schedule.length === 0; // Une seule opération par salle par date+période
}


function buildAndSolveBlocPersonnelMILP(
  personnelRows: any[],
  personnelBloc: any[],
  capacitesMap: Map<string, any>
): any {
  const model: any = {
    optimize: 'score',
    opType: 'max',
    constraints: {},
    variables: {},
    ints: {}
  };
  
  console.log(`\n🔍 Building MILP for ${personnelRows.length} personnel rows and ${personnelBloc.length} personnel`);
  
  let totalVariables = 0;
  
  // Group rows by date + demi_journee to enforce uniqueness
  const rowsByDateDemiJournee = new Map<string, any[]>();
  for (const row of personnelRows) {
    const key = `${row.date}_${row.demi_journee}`;
    if (!rowsByDateDemiJournee.has(key)) {
      rowsByDateDemiJournee.set(key, []);
    }
    rowsByDateDemiJournee.get(key)!.push(row);
  }
  
  // Create variables: x_<secretaire_id>_<personnel_row_id>
  for (const row of personnelRows) {
    const eligible = getEligibleSecretaries(
      row.type_besoin,
      row,
      personnelBloc,
      capacitesMap
    );
    
    if (eligible.length === 0) {
      console.warn(`    ⚠️ NO ELIGIBLE SECRETARIES for row ${row.id} (${row.type_besoin})`);
      continue;
    }
    
    // Score: 1.0 pour base, 0.5 pour accueil
    const score = (row.type_besoin === 'accueil_ophtalmo' || row.type_besoin === 'accueil_dermato') 
      ? 0.5 
      : 1.0;
    
    for (const sec of eligible) {
      const varName = `x_${sec.id}_${row.id}`;
      
      model.variables[varName] = {
        score: score,
        [`row_${row.id}`]: 1,
        [`sec_${sec.id}_${row.date}_${row.demi_journee}`]: 1
      };
      model.ints[varName] = 1;
      totalVariables++;
    }
    
    // Contrainte: chaque ligne peut avoir au maximum 1 secrétaire
    model.constraints[`row_${row.id}`] = {
      max: 1
    };
  }
  
  console.log(`  📊 Total variables: ${totalVariables}`);
  
  // Contrainte: chaque secrétaire peut être assignée au maximum 1 fois par date + demi-journée
  // On parcourt toutes les combinaisons date + demi_journee présentes dans personnelRows
  const dateDemiJournees = new Set<string>();
  for (const row of personnelRows) {
    dateDemiJournees.add(`${row.date}_${row.demi_journee}`);
  }
  
  for (const sec of personnelBloc) {
    for (const dateDemiJournee of dateDemiJournees) {
      model.constraints[`sec_${sec.id}_${dateDemiJournee}`] = {
        max: 1
      };
    }
  }
  
  console.log(`  🔧 Solving MILP...`);
  const solution = solver.Solve(model);
  console.log(`  ✅ Solution feasible: ${solution.feasible !== false}, score: ${solution.result || 0}`);
  
  return solution;
}

function getEligibleSecretaries(
  type_besoin: string,
  operation: any,
  personnelBloc: any[],
  capacitesMap: Map<string, any>
): any[] {
  let eligible = personnelBloc.filter(s => 
    isAvailableForOperation(s.id, operation.date, operation.demi_journee, capacitesMap)
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

function isAvailableForOperation(secId: string, date: string, demi_journee: string, capacitesMap: Map<string, any>): boolean {
  const key = `${date}_${secId}_${demi_journee}`;
  const keyTouteJournee = `${date}_${secId}_toute_journee`;
  return capacitesMap.has(key) || capacitesMap.has(keyTouteJournee);
}

async function createBlocAndPersonnelRows(
  roomAssignments: any[],
  planning_id: string,
  operations: any[],
  typesMap: Map<string, any>,
  supabase: any
) {
  console.log(`\n💾 Creating ${roomAssignments.length} bloc operations...`);
  
  // Save bloc operations with rooms
  const blocRows = roomAssignments.map(ra => {
    const operation = operations.find(b => b.id === ra.operation_id && b.demi_journee === ra.demi_journee);
    
    return {
      planning_id,
      date: operation.date,
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
  
  // Create ALL personnel need rows (with secretaire_id = NULL)
  const allPersonnelRows = [];
  for (const savedBloc of savedBlocs) {
    const operation = operations.find((o: any) => 
      o.type_intervention_id === savedBloc.type_intervention_id &&
      o.demi_journee === savedBloc.periode
    );
    
    if (!operation) continue;
    
    const typeIntervention = typesMap.get(savedBloc.type_intervention_id);
    const besoins = typeIntervention?.types_intervention_besoins_personnel || [];
    
    for (const besoin of besoins) {
      for (let ordre = 1; ordre <= besoin.nombre_requis; ordre++) {
        allPersonnelRows.push({
          planning_id,
          planning_genere_bloc_operatoire_id: savedBloc.id,
          date: savedBloc.date,
          periode: savedBloc.periode,
          type_assignation: 'bloc',
          type_besoin_bloc: besoin.type_besoin,
          secretaire_id: null,
          ordre
        });
      }
    }
  }
  
  console.log(`  📋 Creating ${allPersonnelRows.length} personnel need rows...`);
  
  if (allPersonnelRows.length === 0) {
    return { savedBlocs, personnelRows: [] };
  }
  
  const { data: insertedPersonnel, error: personnelError } = await supabase
    .from('planning_genere_personnel')
    .insert(allPersonnelRows)
    .select();
  
  if (personnelError) {
    console.error('  ❌ Personnel creation error:', personnelError);
    throw personnelError;
  }
  
  console.log(`  ✅ ${insertedPersonnel.length} personnel rows created`);
  
  // Enrich rows with date + demi_journee for MILP
  const enrichedRows = insertedPersonnel.map((row: any) => {
    const bloc = savedBlocs.find((b: any) => b.id === row.planning_genere_bloc_operatoire_id);
    return {
      ...row,
      date: bloc?.date,
      demi_journee: bloc?.periode || 'matin',
      type_besoin: row.type_besoin_bloc  // Map type_besoin_bloc to type_besoin for MILP compatibility
    };
  });
  
  return { savedBlocs, personnelRows: enrichedRows };
}

async function updatePersonnelAssignments(
  personnelRows: any[],
  personnelSolution: any,
  blocsCount: number,
  supabase: any
) {
  console.log(`\n🔄 Updating personnel assignments from MILP solution...`);
  
  let assignmentCount = 0;
  
  // Parse MILP solution: x_<secretaire_id>_<personnel_row_id>
  for (const [varName, value] of Object.entries(personnelSolution)) {
    if (varName.startsWith('x_') && (value as number) > 0.5) {
      const parts = varName.split('_');
      const secId = parts[1];
      const rowId = parts[2];
      
      const { error: updateError } = await supabase
        .from('planning_genere_personnel')
        .update({ secretaire_id: secId })
        .eq('id', rowId);
      
      if (!updateError) {
        assignmentCount++;
      } else {
        console.error(`  ❌ Failed to assign secretary ${secId} to row ${rowId}:`, updateError);
      }
    }
  }
  
  console.log(`  ✅ ${assignmentCount} personnel assigned via MILP`);
  
  return {
    blocs_assigned: blocsCount,
    personnel_assigned: assignmentCount
  };
}
