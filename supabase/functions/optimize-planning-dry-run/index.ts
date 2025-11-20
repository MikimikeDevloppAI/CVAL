import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import solver from 'https://esm.sh/javascript-lp-solver@0.4.24';

import { loadWeekData } from './data-loader.ts';
import { buildMILPModelSoft } from './milp-builder.ts';
import type { SiteNeed, CapaciteEffective, AssignmentSummary, CurrentState } from './types.ts';
import { ADMIN_SITE_ID } from './types.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Calculate needs exactly like v2 - RAW needs without any current assignment impact
function calculateNeeds(
  besoins_effectifs: any[], // Already filtered by date
  medecins_map: Map<string, any>,
  planning_bloc: any[], // Already filtered by date + status
  types_intervention_besoins: any[],
  sites: any[]
): SiteNeed[] {
  const needs: SiteNeed[] = [];
  
  // ============================================================
  // 1. SITE NEEDS (from besoin_effectif)
  // ============================================================
  // Exclude all bloc sites by name
  const blocSiteIds = sites
    .filter(s => s.nom.toLowerCase().includes('bloc') || 
                  s.nom.toLowerCase().includes('opératoire'))
    .map(s => s.id);
  
  // Group by site|date|demi_journee (robust key)
  const siteGroups = new Map<string, any[]>();
  
  for (const besoin of besoins_effectifs) {
    if (besoin.type !== 'medecin') continue;
    if (blocSiteIds.includes(besoin.site_id)) continue;
    
    const key = `${besoin.site_id}|${besoin.date}|${besoin.demi_journee}`;
    if (!siteGroups.has(key)) {
      siteGroups.set(key, []);
    }
    siteGroups.get(key)!.push(besoin);
  }
  
  console.log('🧮 Besoins calculés (sites):');
  for (const [key, besoins] of siteGroups) {
    const [site_id, date, demi_journee] = key.split('|');
    
    let totalBesoin = 0;
    const medecins_ids: string[] = [];
    
    // CRITICAL: Calculate raw need based on all doctors, NO skipping
    for (const besoin of besoins) {
      if (besoin.medecin_id) {
        const medecin = medecins_map.get(besoin.medecin_id);
        if (medecin) {
          totalBesoin += medecin.besoin_secretaires ?? 1.2;
          medecins_ids.push(besoin.medecin_id);
        }
      }
    }
    
    const nombre_max = Math.ceil(totalBesoin);
    const site = sites.find(s => s.id === site_id);
    
    console.log(`  ${date} ${demi_journee} - ${site?.nom || site_id}: nombre_max=${nombre_max} (medecins=${medecins_ids.length})`);
    
    needs.push({
      site_id,
      date,
      periode: demi_journee as 'matin' | 'apres_midi',
      nombre_suggere: nombre_max,
      nombre_max,
      medecins_ids,
      type: 'site',
      site_nom: site?.nom || 'Site inconnu'
    });
  }
  
  // ============================================================
  // 2. BLOC NEEDS (from planning_genere_bloc_operatoire)
  // ============================================================
  const blocSite = sites.find(s => 
    s.nom.toLowerCase().includes('bloc') && 
    s.nom.toLowerCase().includes('opératoire')
  );
  
  // NO date/status filter here - already done before call
  for (const bloc of planning_bloc) {
    // Get personnel needs for this intervention type
    const besoinsPersonnel = types_intervention_besoins.filter(
      tb => tb.type_intervention_id === bloc.type_intervention_id && tb.actif
    );
    
    for (const besoinPersonnel of besoinsPersonnel) {
      needs.push({
        site_id: blocSite?.id || bloc.site_id,
        date: bloc.date,
        periode: bloc.periode,
        nombre_suggere: besoinPersonnel.nombre_requis,
        nombre_max: besoinPersonnel.nombre_requis,
        medecins_ids: bloc.medecin_id ? [bloc.medecin_id] : [],
        type: 'bloc_operatoire',
        bloc_operation_id: bloc.id,
        besoin_operation_id: besoinPersonnel.besoin_operation_id
        // NO site_nom here
      });
    }
  }
  
  return needs;
}

// Get current assignments for comparison
function getCurrentAssignments(
  date: string,
  capacites: CapaciteEffective[],
  needs: SiteNeed[],
  secretaires: any[],
  sites: any[],
  besoinsOperations: Map<string, any>,
  typesIntervention: Map<string, any>,
  sallesOperation: Map<string, any>,
  planningBloc: Map<string, any>,
  medecinsMap: Map<string, any>
): any[] {
  const assignments: any[] = [];

  for (const need of needs) {
    const assigned: any[] = [];
    
    // Find existing assignments for this need
    const relevantCapacites = capacites.filter(c => {
      if (c.date !== date || !c.actif) return false;
      if (c.demi_journee !== need.periode) return false;
      
      // For site needs: match site_id (exclude admin site)
      if (need.type === 'site') {
        return c.site_id === need.site_id && c.site_id !== '00000000-0000-0000-0000-000000000001';
      }
      
      // For bloc needs: match bloc_operation_id and besoin_operation_id
      if (need.type === 'bloc_operatoire') {
        return c.planning_genere_bloc_operatoire_id === need.bloc_operation_id &&
               c.besoin_operation_id === need.besoin_operation_id;
      }
      
      return false;
    });

    // Build secretaires list from existing assignments
    for (const cap of relevantCapacites) {
      const sec = secretaires.find(s => s.id === cap.secretaire_id);
      if (sec) {
        assigned.push({
          id: cap.secretaire_id,
          nom: `${sec.first_name} ${sec.name}`,
          is_backup: false,
          is_1r: cap.is_1r || false,
          is_2f: cap.is_2f || false,
          is_3f: cap.is_3f || false
        });
      }
    }

    const nombre_requis = Math.ceil(need.nombre_suggere);
    const nombre_assigne = assigned.length;
    const status = nombre_assigne >= nombre_requis ? 'satisfait' :
                   nombre_assigne > 0 ? 'partiel' : 'non_satisfait';

    // For bloc needs without site_nom, find site name from sites array
    let site_nom = need.site_nom;
    if (!site_nom && need.type === 'bloc_operatoire') {
      const site = sites.find(s => s.id === need.site_id);
      site_nom = site?.nom || 'Bloc opératoire';
    }

    // Add bloc operatoire details if applicable
    let type_intervention_nom = null;
    let besoin_operation_nom = null;
    let salle_nom = null;
    let periode_display = need.periode;
    let medecin_nom = null;

    if (need.type === 'bloc_operatoire') {
      // Get besoin operation name
      if (need.besoin_operation_id) {
        const besoinOp = besoinsOperations.get(need.besoin_operation_id);
        besoin_operation_nom = besoinOp?.nom || null;
      }

      // Get type intervention and salle from planning_genere_bloc_operatoire
      if (need.bloc_operation_id) {
        const planning = planningBloc.get(need.bloc_operation_id);
        if (planning) {
          periode_display = planning.periode || need.periode;
          
          if (planning.type_intervention_id) {
            const typeIntervention = typesIntervention.get(planning.type_intervention_id);
            type_intervention_nom = typeIntervention?.nom || null;
          }
          
          if (planning.salle_assignee) {
            const salle = sallesOperation.get(planning.salle_assignee);
            salle_nom = salle?.name || null;
          }

          // Get medecin name
          if (planning.medecin_id) {
            const medecinInfo = medecinsMap.get(planning.medecin_id);
            medecin_nom = medecinInfo ? `${medecinInfo.first_name} ${medecinInfo.name}` : null;
          }
        }
      }
    }

    assignments.push({
      date: need.date,
      site_id: need.site_id,
      site_nom: site_nom || 'Site inconnu',
      periode: periode_display,
      type: need.type,
      bloc_operation_id: need.bloc_operation_id,
      besoin_operation_id: need.besoin_operation_id,
      type_intervention_nom,
      besoin_operation_nom,
      salle_nom,
      medecin_nom,
      secretaires: assigned,
      nombre_requis,
      nombre_assigne,
      status
    });
  }

  return assignments;
}

// Calculate changes between before and after
function calculateChanges(before: any[], after: any[]): any[] {
  const changes: any[] = [];

  for (let i = 0; i < before.length; i++) {
    const beforeAssign = before[i];
    const afterAssign = after[i];

    const beforeIds = new Set(beforeAssign.secretaires.map((s: any) => s.id));
    const afterIds = new Set(afterAssign.secretaires.map((s: any) => s.id));

    const removed = beforeAssign.secretaires
      .filter((s: any) => !afterIds.has(s.id))
      .map((s: any) => s.nom);
    
    const added = afterAssign.secretaires
      .filter((s: any) => !beforeIds.has(s.id))
      .map((s: any) => s.nom);
    
    const unchanged = beforeAssign.secretaires
      .filter((s: any) => afterIds.has(s.id))
      .map((s: any) => s.nom);

    if (removed.length > 0 || added.length > 0) {
      changes.push({
        site_nom: beforeAssign.site_nom,
        periode: beforeAssign.periode,
        removed,
        added,
        unchanged,
        satisfaction_before: beforeAssign.status,
        satisfaction_after: afterAssign.status
      });
    }
  }

  return changes;
}

// Calculate individual secretary changes with full details
function calculateIndividualChanges(
  date: string,
  beforeAssignments: any[],
  afterAssignments: any[],
  dryRunRecords: any[],
  secretaires: any[],
  sites: any[],
  besoinsOperations: any[],
  typesIntervention: any[]
): any[] {
  const individualChanges: any[] = [];
  
  // Create maps for quick lookup
  const beforeMap = new Map<string, any>();
  beforeAssignments.forEach(assign => {
    assign.secretaires.forEach((sec: any) => {
      const key = `${sec.secretaire_id || sec.id}_${assign.periode}`;
      beforeMap.set(key, {
        secretaire_id: sec.secretaire_id || sec.id,
        periode: assign.periode,
        site_id: assign.site_id,
        site_nom: assign.site_nom,
        type: assign.type_assignation || assign.type || 'site',
        besoin_operation_id: sec.besoin_operation_id,
        planning_genere_bloc_id: sec.planning_genere_bloc_id,
        is_1r: sec.is_1r || false,
        is_2f: sec.is_2f || false,
        is_3f: sec.is_3f || false
      });
    });
  });
  
  const afterMap = new Map<string, any>();
  afterAssignments.forEach(assign => {
    assign.secretaires.forEach((sec: any) => {
      const key = `${sec.secretaire_id || sec.id}_${assign.periode}`;
      afterMap.set(key, {
        secretaire_id: sec.secretaire_id || sec.id,
        periode: assign.periode,
        site_id: assign.site_id,
        site_nom: assign.site_nom,
        type: assign.type_assignation || assign.type || 'site',
        besoin_operation_id: sec.besoin_operation_id,
        planning_genere_bloc_id: sec.planning_genere_bloc_id,
        is_1r: sec.is_1r || false,
        is_2f: sec.is_2f || false,
        is_3f: sec.is_3f || false
      });
    });
  });
  
  // Find all secretaries involved
  const allSecretaryIds = new Set<string>();
  beforeMap.forEach((_, key) => {
    const [secId] = key.split('_');
    allSecretaryIds.add(secId);
  });
  afterMap.forEach((_, key) => {
    const [secId] = key.split('_');
    allSecretaryIds.add(secId);
  });
  
  // For each secretary, compare before and after for each period
  allSecretaryIds.forEach(secId => {
    const secretaire = secretaires.find(s => s.id === secId);
    if (!secretaire) return;
    
    ['matin', 'apres_midi'].forEach(periode => {
      const key = `${secId}_${periode}`;
      const before = beforeMap.get(key);
      const after = afterMap.get(key);
      
      // Skip if no change
      if (before && after && 
          before.site_id === after.site_id &&
          before.besoin_operation_id === after.besoin_operation_id &&
          before.planning_genere_bloc_id === after.planning_genere_bloc_id &&
          before.is_1r === after.is_1r &&
          before.is_2f === after.is_2f &&
          before.is_3f === after.is_3f) {
        return;
      }
      
      // Skip if both are null/undefined (no assignment before or after)
      if (!before && !after) return;
      
      // Get besoin operation names
      let beforeBesoinNom = null;
      let afterBesoinNom = null;
      
      if (before?.besoin_operation_id) {
        const besoin = besoinsOperations.find(b => b.id === before.besoin_operation_id);
        beforeBesoinNom = besoin?.nom || null;
      }
      
      if (after?.besoin_operation_id) {
        const besoin = besoinsOperations.find(b => b.id === after.besoin_operation_id);
        afterBesoinNom = besoin?.nom || null;
      }
      
      individualChanges.push({
        date,
        secretaire_id: secId,
        secretaire_nom: `${secretaire.first_name} ${secretaire.name}`,
        periode,
        before: before ? {
          site_id: before.site_id,
          site_nom: before.site_nom,
          type: before.type,
          besoin_operation_id: before.besoin_operation_id,
          besoin_operation_nom: beforeBesoinNom,
          is_1r: before.is_1r,
          is_2f: before.is_2f,
          is_3f: before.is_3f
        } : null,
        after: after ? {
          site_id: after.site_id,
          site_nom: after.site_nom,
          type: after.type,
          besoin_operation_id: after.besoin_operation_id,
          besoin_operation_nom: afterBesoinNom,
          is_1r: after.is_1r,
          is_2f: after.is_2f,
          is_3f: after.is_3f
        } : null
      });
    });
  });
  
  return individualChanges;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { date, startDate, endDate } = await req.json();

    // Support both single date and date range
    let dates: string[] = [];
    if (startDate && endDate) {
      // Generate all dates in range
      const start = new Date(startDate);
      const end = new Date(endDate);
      const current = new Date(start);
      
      while (current <= end) {
        dates.push(current.toISOString().split('T')[0]);
        current.setDate(current.getDate() + 1);
      }
      
      console.log(`🧪 Dry-run optimization for period ${startDate} to ${endDate} (${dates.length} days)`);
    } else if (date) {
      dates = [date];
      console.log(`🧪 Dry-run optimization for ${date}`);
    } else {
      throw new Error('Either date or startDate/endDate is required');
    }

    // Load data using exact same function as v2
    const week_data = await loadWeekData(dates, supabase);
    
    // Identify Paul Jacquier and Florence Bron for 3F/2F logic
    const florenceBron = week_data.secretaires.find(s => 
      (s.first_name?.toLowerCase() === 'florence' && s.name?.toLowerCase() === 'bron') ||
      (s.name?.toLowerCase().includes('bron') && s.first_name?.toLowerCase().includes('florence'))
    );
    
    const { data: medecins, error: medError } = await supabase
      .from('medecins')
      .select('id, first_name, name')
      .eq('actif', true);
    
    if (medError) throw medError;
    
    const paulJacquier = medecins?.find(m => 
      (m.first_name?.toLowerCase() === 'paul' && m.name?.toLowerCase() === 'jacquier') ||
      (m.name?.toLowerCase().includes('jacquier') && m.first_name?.toLowerCase().includes('paul'))
    );
    
    console.log(`🔍 Florence Bron ID: ${florenceBron?.id || 'not found'}`);
    console.log(`🔍 Paul Jacquier ID: ${paulJacquier?.id || 'not found'}`);
    
    // Build week scores for closing responsibilities (1R=2pts, 2F=10pts, 3F=15pts)
    const currentWeekScores = new Map<string, {score: number, count_1r: number, count_2f: number, count_3f: number}>();
    
    // Get the week start/end for this date
    const targetDate = new Date(dates[0]);
    const dayOfWeek = targetDate.getDay();
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const weekStart = new Date(targetDate);
    weekStart.setDate(targetDate.getDate() + diffToMonday);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    const weekStartStr = weekStart.toISOString().split('T')[0];
    const weekEndStr = weekEnd.toISOString().split('T')[0];
    
    const { data: weekAssignments, error: waError } = await supabase
      .from('capacite_effective')
      .select('secretaire_id, is_1r, is_2f, is_3f, date')
      .gte('date', weekStartStr)
      .lte('date', weekEndStr)
      .not('secretaire_id', 'is', null);
    
    if (waError) throw waError;
    
    // Calculate current week scores (excluding current date being optimized)
    for (const assignment of weekAssignments || []) {
      if (assignment.date === date) continue; // Skip date being optimized
      
      const secId = assignment.secretaire_id;
      if (!secId) continue;
      
      if (!currentWeekScores.has(secId)) {
        currentWeekScores.set(secId, { score: 0, count_1r: 0, count_2f: 0, count_3f: 0 });
      }
      
      const secScore = currentWeekScores.get(secId)!;
      
      if (assignment.is_1r) {
        secScore.score += 2;
        secScore.count_1r += 1;
      }
      if (assignment.is_2f) {
        secScore.score += 10;
        secScore.count_2f += 1;
      }
      if (assignment.is_3f) {
        secScore.score += 15;
        secScore.count_3f += 1;
      }
    }
    
    console.log(`📊 Current week scores calculated for ${currentWeekScores.size} secretaries`);
    
    // Load additional data for bloc operatoire details
    const { data: besoinsOpsData } = await supabase
      .from('besoins_operations')
      .select('id, nom');
    
    const { data: typesInterventionData } = await supabase
      .from('types_intervention')
      .select('id, nom');
    
    const { data: sallesData } = await supabase
      .from('salles_operation')
      .select('id, name');
    
    const besoinsOperations = new Map(besoinsOpsData?.map(b => [b.id, b]) || []);
    const typesIntervention = new Map(typesInterventionData?.map(t => [t.id, t]) || []);
    const sallesOperation = new Map(sallesData?.map(s => [s.id, s]) || []);
    const planningBlocMap = new Map(
      week_data.planning_bloc
        .filter((p: any) => p.date === date)
        .map((p: any) => [p.id, p])
    );
    
    // Calculate needs using exact same logic as v2
    const needs = calculateNeeds(
      week_data.besoins_effectifs.filter(b => b.date === date),
      week_data.medecins_map,
      week_data.planning_bloc.filter(p => p.date === date),
      week_data.types_intervention_besoins,
      week_data.sites
    );

    // Get real capacities for this date
    const capacites = week_data.capacites_effective.filter(c => c.date === date);

    // Create fictitious capacities with everyone in ADMIN (in memory only, NO DB update)
    console.log(`\n📝 Création de capacités fictives (en mémoire) avec tout le monde en ADMIN...`);
    const fictitiousCapacites: CapaciteEffective[] = capacites
      .filter(cap => cap.actif)  // ← Filter only active capacities
      .map(cap => ({
        ...cap,
        site_id: ADMIN_SITE_ID,
        besoin_operation_id: undefined,
        planning_genere_bloc_operatoire_id: undefined,
        is_1r: false,
        is_2f: false,
        is_3f: false
      }));
    
    console.log(`  ✅ ${fictitiousCapacites.length} capacités fictives créées`);

    // Get current assignments BEFORE optimization (using real capacities for display)
    const beforeAssignments = getCurrentAssignments(
      date,
      capacites,  // Use real capacites for "Avant" display
      needs,
      week_data.secretaires,
      week_data.sites,
      besoinsOperations,
      typesIntervention,
      sallesOperation,
      planningBlocMap,
      week_data.medecins_map
    );

    // Capture current state from REAL capacities (for bonus +100/+100)
    console.log(`\n🎯 Capture de l'état actuel pour bonus +100 par demi-journée...`);
    const currentState = new Map<string, CurrentState>();
    
    // Count capacities with missing bloc IDs
    let blocWithoutIds = 0;
    const BLOC_SITE_ID = '7b332cac-32d1-4811-b408-510a20de2d01';
    
    for (const cap of capacites.filter(c => c.actif)) {
      if (!cap.secretaire_id) continue;
      
      // Diagnostic: Check if bloc site without IDs
      if (cap.site_id === BLOC_SITE_ID && 
          (!cap.besoin_operation_id || !cap.planning_genere_bloc_operatoire_id)) {
        blocWithoutIds++;
        const secInfo = week_data.secretaires.find((s: any) => s.id === cap.secretaire_id);
        console.log(`  ⚠️ Capacité BLOC sans IDs complets: ${secInfo?.first_name} ${secInfo?.name} (${cap.demi_journee}) - besoin=${cap.besoin_operation_id?.slice(0,8) || 'null'}, bloc_op=${cap.planning_genere_bloc_operatoire_id?.slice(0,8) || 'null'}`);
      }
      
      const key = cap.secretaire_id;
      if (!currentState.has(key)) {
        currentState.set(key, {
          secretaire_id: cap.secretaire_id,
          matin_site_id: null,
          matin_besoin_op_id: null,
          matin_bloc_op_id: null,
          am_site_id: null,
          am_besoin_op_id: null,
          am_bloc_op_id: null
        });
      }
      
      const state = currentState.get(key)!;
      if (cap.demi_journee === 'matin') {
        state.matin_site_id = cap.site_id;
        state.matin_besoin_op_id = cap.besoin_operation_id ?? null;
        state.matin_bloc_op_id = cap.planning_genere_bloc_operatoire_id ?? null;
      } else {
        state.am_site_id = cap.site_id;
        state.am_besoin_op_id = cap.besoin_operation_id ?? null;
        state.am_bloc_op_id = cap.planning_genere_bloc_operatoire_id ?? null;
      }
    }
    
    if (blocWithoutIds > 0) {
      console.log(`  ⚠️ ATTENTION: ${blocWithoutIds} demi-journées 'bloc' sans IDs complets détectées`);
    }
    console.log(`  ✅ État actuel capturé pour ${currentState.size} secrétaires`);

    // Calculate week assignments for scoring context (no changes here)
    const week_assignments: AssignmentSummary[] = [];
    for (const cap of week_data.capacites_effective.filter(c => c.date !== date && c.actif)) {
      const is_admin = cap.site_id === ADMIN_SITE_ID;
      const is_bloc = cap.planning_genere_bloc_operatoire_id !== null || cap.besoin_operation_id !== null;
      
      const sitePrio = week_data.secretaires_sites.find(
        ss => ss.secretaire_id === cap.secretaire_id && ss.site_id === cap.site_id
      );
      
      week_assignments.push({
        secretaire_id: cap.secretaire_id!,
        site_id: cap.site_id,
        date: cap.date,
        periode: cap.demi_journee as 'matin' | 'apres_midi',
        is_admin,
        is_bloc,
        site_priorite: sitePrio ? parseInt(sitePrio.priorite) as 1 | 2 | 3 : null
      });
    }

    // Build MILP model using combo approach with current state bonus
    const { model, combos } = buildMILPModelSoft(date, needs, fictitiousCapacites, week_data, week_assignments, currentState);

    console.log(`📊 Model: ${Object.keys(model.variables).length} vars, ${Object.keys(model.constraints).length} constraints`);

    // Solve
    console.log(`\n🎯 RÉSOLUTION MILP`);
    const solution = solver.Solve(model);
    
    console.log(`  ✅ Solution feasible: ${solution.feasible}`);
    console.log(`  ✅ Score: ${solution.result || 0}`);

    if (!solution.feasible) {
      return new Response(
        JSON.stringify({
          feasible: false,
          message: 'Aucune solution faisable trouvée',
          before: { 
            assignments: beforeAssignments,
            besoins_non_satisfaits: beforeAssignments.filter(a => a.status !== 'satisfait').length
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const selectedCombos = combos.filter(c => solution[c.varName] > 0.5);
    
    // Enforce at most ONE combo per secretary per day (dedupe safeguard)
    const selectedCombosDedup = Array.from(
      selectedCombos.reduce((map, combo) => {
        const existing = map.get(combo.secretaire_id);
        if (!existing || combo.score > existing.score) {
          map.set(combo.secretaire_id, combo);
        }
        return map;
      }, new Map<string, typeof combos[number]>() ).values()
    );
    
    console.log(`  ✅ Combos sélectionnés: ${selectedCombosDedup.length}`);
    
    // Comptage des combos ADMIN (null ou explicite)
    const adminCombosCount = selectedCombosDedup.filter(c => 
      (c.needMatin == null || (c.needMatin?.type === 'site' && c.needMatin.site_id === ADMIN_SITE_ID)) ||
      (c.needAM == null || (c.needAM?.type === 'site' && c.needAM.site_id === ADMIN_SITE_ID))
    ).length;
    console.log(`  ℹ️ Combos avec au moins une demi-journée ADMIN: ${adminCombosCount}`);
    
    console.log(`\n📊 Détails des combos sélectionnés:`);
    for (const combo of selectedCombosDedup) {
      const sec = week_data.secretaires.find(s => s.id === combo.secretaire_id);
      const matinSite = combo.needMatin ? week_data.sites.find(s => s.id === combo.needMatin!.site_id)?.nom : 'Admin/Libre';
      const amSite = combo.needAM ? week_data.sites.find(s => s.id === combo.needAM!.site_id)?.nom : 'Admin/Libre';
      console.log(`  ${sec?.name}: ${matinSite} / ${amSite} (score: ${combo.score})`);
    }
    
    const afterAssignments: any[] = [];

    for (const need of needs) {
      const assigned: any[] = [];

      for (const combo of selectedCombosDedup) {
        let matches = false;

        if (need.periode === 'matin') {
          if (need.type === 'site') {
            if (need.site_id === ADMIN_SITE_ID) {
              // Admin: match when morning is unassigned (null) OR explicitly assigned to ADMIN
              matches = (combo.needMatin == null) || (combo.needMatin?.type === 'site' && combo.needMatin.site_id === ADMIN_SITE_ID);
            } else if (combo.needMatin && combo.needMatin.type === 'site') {
              matches = combo.needMatin.site_id === need.site_id;
            }
          } else if (need.type === 'bloc_operatoire') {
            if (
              combo.needMatin &&
              combo.needMatin.type === 'bloc_operatoire' &&
              combo.needMatin.bloc_operation_id === need.bloc_operation_id &&
              combo.needMatin.besoin_operation_id === need.besoin_operation_id
            ) {
              matches = true;
            }
          }
        } else if (need.periode === 'apres_midi') {
          if (need.type === 'site') {
            if (need.site_id === ADMIN_SITE_ID) {
              // Admin: match when afternoon is unassigned (null) OR explicitly assigned to ADMIN
              matches = (combo.needAM == null) || (combo.needAM?.type === 'site' && combo.needAM.site_id === ADMIN_SITE_ID);
            } else if (combo.needAM && combo.needAM.type === 'site') {
              matches = combo.needAM.site_id === need.site_id;
            }
          } else if (need.type === 'bloc_operatoire') {
            if (
              combo.needAM &&
              combo.needAM.type === 'bloc_operatoire' &&
              combo.needAM.bloc_operation_id === need.bloc_operation_id &&
              combo.needAM.besoin_operation_id === need.besoin_operation_id
            ) {
              matches = true;
            }
          }
        }

        if (matches) {
          const sec = week_data.secretaires.find(s => s.id === combo.secretaire_id);
          // Find corresponding dryRunRecord to get 1R/2F/3F flags (will be populated later)
          // For now, we'll add flags as false, they'll be updated in the response
          assigned.push({
            id: combo.secretaire_id,
            nom: sec ? `${sec.first_name} ${sec.name}` : 'Inconnu',
            is_backup: false,
            is_1r: false,
            is_2f: false,
            is_3f: false
          });
        }
      }

      // Deduplicate by secretary id within this need
      const seen = new Set<string>();
      const assignedUnique = assigned.filter(a => {
        if (seen.has(a.id)) return false;
        seen.add(a.id);
        return true;
      });

      // Add bloc operatoire details if applicable
      let type_intervention_nom = null;
      let besoin_operation_nom = null;
      let salle_nom = null;
      let periode_display = need.periode;
      let medecin_nom = null;

      if (need.type === 'bloc_operatoire') {
        // Get besoin operation name
        if (need.besoin_operation_id) {
          const besoinOp = besoinsOperations.get(need.besoin_operation_id);
          besoin_operation_nom = besoinOp?.nom || null;
        }

        // Get type intervention and salle from planning_genere_bloc_operatoire
        if (need.bloc_operation_id) {
          const planning = planningBlocMap.get(need.bloc_operation_id);
          if (planning) {
            periode_display = planning.periode || need.periode;
            
            if (planning.type_intervention_id) {
              const typeIntervention = typesIntervention.get(planning.type_intervention_id);
              type_intervention_nom = typeIntervention?.nom || null;
            }
            
            if (planning.salle_assignee) {
              const salle = sallesOperation.get(planning.salle_assignee);
              salle_nom = salle?.name || null;
            }

            // Get medecin name
            if (planning.medecin_id) {
              const medecin = week_data.medecins_map.get(planning.medecin_id);
              medecin_nom = medecin ? `${medecin.first_name} ${medecin.name}` : null;
            }
          }
        }
      }

      afterAssignments.push({
        date: need.date,
        site_id: need.site_id,
        site_nom: need.site_nom,
        periode: periode_display,
        type: need.type,
        bloc_operation_id: need.bloc_operation_id,
        besoin_operation_id: need.besoin_operation_id,
        type_intervention_nom,
        besoin_operation_nom,
        salle_nom,
        medecin_nom,
        secretaires: assignedUnique,
        nombre_requis: Math.ceil(need.nombre_suggere),
        nombre_assigne: assignedUnique.length,
        status: assignedUnique.length >= Math.ceil(need.nombre_suggere) ? 'satisfait' :
                assignedUnique.length > 0 ? 'partiel' : 'non_satisfait'
      });
    }

    // Count unsatisfied needs
    const beforeUnsatisfied = beforeAssignments.filter(a => a.status !== 'satisfait').length;
    const afterUnsatisfied = afterAssignments.filter(a => a.status !== 'satisfait').length;

    console.log(`\n📊 Résultats:`);
    console.log(`  AVANT: ${beforeUnsatisfied} besoins non satisfaits, ${beforeAssignments.reduce((sum, a) => sum + a.secretaires.length, 0)} assignations`);
    for (const a of beforeAssignments) {
      console.log(`    ${a.site_nom} ${a.periode}: ${a.secretaires.map((s: any) => s.nom).join(', ')} (${a.status})`);
    }
    
    console.log(`  APRÈS: ${afterUnsatisfied} besoins non satisfaits, ${afterAssignments.reduce((sum, a) => sum + a.secretaires.length, 0)} assignations`);
    for (const a of afterAssignments) {
      console.log(`    ${a.site_nom} ${a.periode}: ${a.secretaires.map((s: any) => s.nom).join(', ')} (${a.status})`);
    }

    // Calculate changes
    const changes = calculateChanges(beforeAssignments, afterAssignments);
    
    console.log(`  CHANGEMENTS: ${changes.length} modifications`);
    
    // Build new assignments list for UI
    const newAssignments = changes.flatMap(change => 
      change.added.map((nom: any) => ({
        secretaire_nom: nom,
        site_nom: change.site_nom,
        demi_journee: change.periode,
        is_new: true
      }))
    );

    // Build records for dry-run to show proposed changes
    // Helper to find existing capacite by secretaire + date + period only
    const findExistingCap = (secretaireId: string, demiJournee: string) => {
      return capacites.find(c => 
        c.secretaire_id === secretaireId &&
        c.date === date &&
        c.demi_journee === demiJournee
      );
    };

    // Build records for ONLY changed assignments
    const dryRunRecords: any[] = [];
    
    for (const combo of selectedCombosDedup) {
      // Morning
      if (combo.needMatin) {
        const existingCap = findExistingCap(combo.secretaire_id, 'matin');
        
        if (existingCap) {
          const proposedSiteId = combo.needMatin.site_id;
          const proposedBesoinOpId = combo.needMatin.type === 'bloc_operatoire' ? combo.needMatin.besoin_operation_id : null;
          const proposedBlocOpId = combo.needMatin.type === 'bloc_operatoire' ? combo.needMatin.bloc_operation_id : null;
          
          // Check if there's a change
          const hasChange = 
            existingCap.site_id !== proposedSiteId ||
            existingCap.besoin_operation_id !== proposedBesoinOpId ||
            existingCap.planning_genere_bloc_operatoire_id !== proposedBlocOpId;
          
          if (hasChange) {
            dryRunRecords.push({
              capacite_effective_id: existingCap.id,
              secretaire_id: combo.secretaire_id,
              date,
              demi_journee: 'matin',
              site_id: proposedSiteId,
              besoin_operation_id: proposedBesoinOpId,
              planning_genere_bloc_operatoire_id: proposedBlocOpId,
              is_1r: false,
              is_2f: false,
              is_3f: false,
              actif: true
            });
          }
        }
      }

      // Afternoon
      if (combo.needAM) {
        const existingCap = findExistingCap(combo.secretaire_id, 'apres_midi');
        
        if (existingCap) {
          const proposedSiteId = combo.needAM.site_id;
          const proposedBesoinOpId = combo.needAM.type === 'bloc_operatoire' ? combo.needAM.besoin_operation_id : null;
          const proposedBlocOpId = combo.needAM.type === 'bloc_operatoire' ? combo.needAM.bloc_operation_id : null;
          
          // Check if there's a change
          const hasChange = 
            existingCap.site_id !== proposedSiteId ||
            existingCap.besoin_operation_id !== proposedBesoinOpId ||
            existingCap.planning_genere_bloc_operatoire_id !== proposedBlocOpId;
          
          if (hasChange) {
            dryRunRecords.push({
              capacite_effective_id: existingCap.id,
              secretaire_id: combo.secretaire_id,
              date,
              demi_journee: 'apres_midi',
              site_id: proposedSiteId,
              besoin_operation_id: proposedBesoinOpId,
              planning_genere_bloc_operatoire_id: proposedBlocOpId,
              is_1r: false,
              is_2f: false,
              is_3f: false,
              actif: true
            });
          }
        }
      }
    }

    // ========== CLOSING RESPONSIBILITIES LOGIC (CONSERVATIVE) ==========
    console.log(`\n🔒 Gestion conservatrice des responsabilités de fermeture...`);
    
    // Step 1: Identify sites needing closing for this date
    const sitesNeedingClosing: Array<{site_id: string, site_nom: string}> = [];
    
    for (const site of week_data.sites.filter(s => s.fermeture && s.actif)) {
      // Check if this site has doctors working both morning and afternoon
      const siteMatin = needs.some(n => n.site_id === site.id && n.periode === 'matin');
      const siteAM = needs.some(n => n.site_id === site.id && n.periode === 'apres_midi');
      
      if (siteMatin && siteAM) {
        sitesNeedingClosing.push({ site_id: site.id, site_nom: site.nom });
      }
    }
    
    console.log(`  🏢 ${sitesNeedingClosing.length} site(s) nécessitant fermeture: ${sitesNeedingClosing.map(s => s.site_nom).join(', ')}`);
    
    // Map to store 1R/2F/3F assignments by secretaire_id + periode
    const closingAssignments = new Map<string, {is_1r: boolean, is_2f: boolean, is_3f: boolean}>();
    
    // Step 2: For each site needing closing, apply conservative logic
    for (const siteInfo of sitesNeedingClosing) {
      const { site_id, site_nom } = siteInfo;
      
      console.log(`  📍 Analyse ${site_nom}...`);
      
      // Analyze BEFORE state: who has 1R/2F/3F currently?
      const beforeMatin = beforeAssignments.find(a => a.site_id === site_id && a.periode === 'matin');
      const beforeAM = beforeAssignments.find(a => a.site_id === site_id && a.periode === 'apres_midi');
      
      const beforeAllDay = beforeMatin?.secretaires.filter((s: any) =>
        beforeAM?.secretaires.some((am: any) => am.id === s.id)
      ) || [];
      
      const current1R = beforeAllDay.find((s: any) => s.is_1r)?.id || null;
      const current2F3F = beforeAllDay.find((s: any) => s.is_2f || s.is_3f)?.id || null;
      
      console.log(`    AVANT: 1R=${current1R ? week_data.secretaires.find(s => s.id === current1R)?.name : 'aucun'}, 2F/3F=${current2F3F ? week_data.secretaires.find(s => s.id === current2F3F)?.name : 'aucun'}`);
      
      // Analyze AFTER state: who's working all day after optimization?
      const afterAllDaySecretaires = selectedCombosDedup
        .filter(c => {
          const matinMatch = c.needMatin && c.needMatin.type === 'site' && c.needMatin.site_id === site_id;
          const amMatch = c.needAM && c.needAM.type === 'site' && c.needAM.site_id === site_id;
          return matinMatch && amMatch;
        })
        .map(c => c.secretaire_id);
      
      console.log(`    APRÈS: ${afterAllDaySecretaires.length} secrétaire(s) toute la journée: ${afterAllDaySecretaires.map(id => week_data.secretaires.find(s => s.id === id)?.name).join(', ')}`);
      
      if (afterAllDaySecretaires.length === 0) {
        console.log(`    ⚠️ Aucune secrétaire toute la journée - impossible d'assigner`);
        continue;
      }
      
      // Check if we need to conserve existing roles or re-assign
      const has1RAfter = current1R && afterAllDaySecretaires.includes(current1R);
      const has2F3FAfter = current2F3F && afterAllDaySecretaires.includes(current2F3F);
      
      if (has1RAfter && has2F3FAfter) {
        // Both roles preserved, no action needed
        console.log(`    ✅ Conservation: 1R et 2F/3F toujours présents, aucun changement`);
        
        // Store the preserved assignments
        closingAssignments.set(`${current1R}_matin`, { is_1r: true, is_2f: false, is_3f: false });
        closingAssignments.set(`${current1R}_apres_midi`, { is_1r: true, is_2f: false, is_3f: false });
        
        const is3F = beforeAllDay.find((s: any) => s.id === current2F3F)?.is_3f || false;
        closingAssignments.set(`${current2F3F}_matin`, { is_1r: false, is_2f: !is3F, is_3f: is3F });
        closingAssignments.set(`${current2F3F}_apres_midi`, { is_1r: false, is_2f: !is3F, is_3f: is3F });
        
        continue;
      }
      
      // Need to re-assign missing roles
      console.log(`    🔧 Réattribution nécessaire: 1R=${!has1RAfter ? 'manquant' : 'OK'}, 2F/3F=${!has2F3FAfter ? 'manquant' : 'OK'}`);
      
      // Ensure all candidates have a score entry
      for (const candidateId of afterAllDaySecretaires) {
        if (!currentWeekScores.has(candidateId)) {
          currentWeekScores.set(candidateId, { score: 0, count_1r: 0, count_2f: 0, count_3f: 0 });
        }
      }
      
      // Handle case with only 1 secretary all day
      if (afterAllDaySecretaires.length === 1) {
        const singleSecId = afterAllDaySecretaires[0];
        const secName = week_data.secretaires.find(s => s.id === singleSecId);
        
        // Determine if needs 3F
        const targetDayOfWeek = new Date(date).getDay();
        let needsThreeF = false;
        
        if (paulJacquier && targetDayOfWeek === 4) { // Thursday
          const { data: jacquierThur } = await supabase
            .from('besoin_effectif')
            .select('id')
            .eq('medecin_id', paulJacquier.id)
            .eq('site_id', site_id)
            .eq('date', date)
            .limit(1)
            .maybeSingle();
          
          const friday = new Date(date);
          friday.setDate(friday.getDate() + 1);
          const fridayStr = friday.toISOString().split('T')[0];
          
          const { data: jacquierFri } = await supabase
            .from('besoin_effectif')
            .select('id')
            .eq('medecin_id', paulJacquier.id)
            .eq('site_id', site_id)
            .eq('date', fridayStr)
            .limit(1)
            .maybeSingle();
          
          if (jacquierThur && jacquierFri) {
            needsThreeF = true;
            console.log(`      ℹ️ Paul Jacquier travaille jeudi et vendredi → 3F requis`);
          }
        }
        
        console.log(`    ⚠️ 1 seule secrétaire toute la journée → ${needsThreeF ? '3F' : '2F'} uniquement (${secName?.first_name} ${secName?.name})`);
        
        closingAssignments.set(`${singleSecId}_matin`, { is_1r: false, is_2f: !needsThreeF, is_3f: needsThreeF });
        closingAssignments.set(`${singleSecId}_apres_midi`, { is_1r: false, is_2f: !needsThreeF, is_3f: needsThreeF });
        
        continue;
      }
      
      // Assign 2F/3F if missing
      let responsable2F3F = current2F3F && afterAllDaySecretaires.includes(current2F3F) ? current2F3F : null;
      
      if (!responsable2F3F) {
        // Determine if needs 3F
        const targetDayOfWeek = new Date(date).getDay();
        let needsThreeF = false;
        
        if (paulJacquier && targetDayOfWeek === 4) {
          const { data: jacquierThur } = await supabase
            .from('besoin_effectif')
            .select('id')
            .eq('medecin_id', paulJacquier.id)
            .eq('site_id', site_id)
            .eq('date', date)
            .limit(1)
            .maybeSingle();
          
          const friday = new Date(date);
          friday.setDate(friday.getDate() + 1);
          const fridayStr = friday.toISOString().split('T')[0];
          
          const { data: jacquierFri } = await supabase
            .from('besoin_effectif')
            .select('id')
            .eq('medecin_id', paulJacquier.id)
            .eq('site_id', site_id)
            .eq('date', fridayStr)
            .limit(1)
            .maybeSingle();
          
          if (jacquierThur && jacquierFri) {
            needsThreeF = true;
          }
        }
        
        const isTuesday = new Date(date).getDay() === 2;
        
        // Choose secretary with lowest score
        const candidates2F3F = afterAllDaySecretaires.map(id => {
          const current = currentWeekScores.get(id)!;
          return {
            id,
            score: current.score,
            has2F3F: current.count_2f > 0 || current.count_3f > 0,
            isFlorenceTuesday: isTuesday && florenceBron && id === florenceBron.id
          };
        }).sort((a, b) => {
          if (a.isFlorenceTuesday !== b.isFlorenceTuesday) return a.isFlorenceTuesday ? 1 : -1;
          if (a.has2F3F !== b.has2F3F) return a.has2F3F ? 1 : -1;
          return a.score - b.score;
        });
        
        responsable2F3F = candidates2F3F[0].id;
        
        const score2F3F = currentWeekScores.get(responsable2F3F)!;
        score2F3F.score += needsThreeF ? 3 : 2;
        if (needsThreeF) {
          score2F3F.count_3f += 1;
        } else {
          score2F3F.count_2f += 1;
        }
        
        closingAssignments.set(`${responsable2F3F}_matin`, { is_1r: false, is_2f: !needsThreeF, is_3f: needsThreeF });
        closingAssignments.set(`${responsable2F3F}_apres_midi`, { is_1r: false, is_2f: !needsThreeF, is_3f: needsThreeF });
        
        const secName = week_data.secretaires.find(s => s.id === responsable2F3F);
        console.log(`    ➕ Nouvelle ${needsThreeF ? '3F' : '2F'}: ${secName?.first_name} ${secName?.name} (score: ${score2F3F.score})`);
      } else {
        // Keep existing
        const is3F = beforeAllDay.find((s: any) => s.id === responsable2F3F)?.is_3f || false;
        closingAssignments.set(`${responsable2F3F}_matin`, { is_1r: false, is_2f: !is3F, is_3f: is3F });
        closingAssignments.set(`${responsable2F3F}_apres_midi`, { is_1r: false, is_2f: !is3F, is_3f: is3F });
      }
      
      // Assign 1R if missing
      let responsable1R = current1R && afterAllDaySecretaires.includes(current1R) ? current1R : null;
      
      if (!responsable1R) {
        const candidates1R = afterAllDaySecretaires
          .filter(id => id !== responsable2F3F)
          .map(id => {
            const current = currentWeekScores.get(id)!;
            let adjustedScore = current.score;
            
            if ((current.count_2f + current.count_3f) >= 2) {
              adjustedScore += 10;
            }
            
            return { id, adjustedScore };
          })
          .sort((a, b) => a.adjustedScore - b.adjustedScore);
        
        if (candidates1R.length > 0) {
          responsable1R = candidates1R[0].id;
          
          const score1R = currentWeekScores.get(responsable1R)!;
          score1R.score += 1;
          score1R.count_1r += 1;
          
          closingAssignments.set(`${responsable1R}_matin`, { is_1r: true, is_2f: false, is_3f: false });
          closingAssignments.set(`${responsable1R}_apres_midi`, { is_1r: true, is_2f: false, is_3f: false });
          
          const secName = week_data.secretaires.find(s => s.id === responsable1R);
          console.log(`    ➕ Nouveau 1R: ${secName?.first_name} ${secName?.name} (score: ${score1R.score})`);
        } else {
          console.log(`    ⚠️ Impossible d'assigner 1R (même personne que 2F/3F)`);
        }
      } else {
        // Keep existing
        closingAssignments.set(`${responsable1R}_matin`, { is_1r: true, is_2f: false, is_3f: false });
        closingAssignments.set(`${responsable1R}_apres_midi`, { is_1r: true, is_2f: false, is_3f: false });
      }
      
      const sec1R = week_data.secretaires.find(s => s.id === responsable1R);
      const sec2F3F = week_data.secretaires.find(s => s.id === responsable2F3F);
      const is3FAssigned = closingAssignments.get(`${responsable2F3F}_matin`)?.is_3f || false;
      
      console.log(`    ✅ ${site_nom}: 1R=${sec1R?.first_name} ${sec1R?.name}, ${is3FAssigned ? '3F' : '2F'}=${sec2F3F?.first_name} ${sec2F3F?.name}`);
    }
    
    // Update dryRunRecords with closing responsibilities
    for (const record of dryRunRecords) {
      const key = `${record.secretaire_id}_${record.demi_journee}`;
      const assignment = closingAssignments.get(key);
      if (assignment) {
        record.is_1r = assignment.is_1r;
        record.is_2f = assignment.is_2f;
        record.is_3f = assignment.is_3f;
      }
    }
    
    // Update afterAssignments with closing responsibilities for display
    for (const afterAssignment of afterAssignments) {
      for (const sec of afterAssignment.secretaires) {
        const key = `${sec.id}_${afterAssignment.periode}`;
        const assignment = closingAssignments.get(key);
        if (assignment) {
          sec.is_1r = assignment.is_1r;
          sec.is_2f = assignment.is_2f;
          sec.is_3f = assignment.is_3f;
        }
      }
    }
    
    console.log(`✅ Responsabilités de fermeture mises à jour`);
    
    // Calculate individual changes with full details (after dryRunRecords is complete)
    const individualChanges = calculateIndividualChanges(
      dates[0],
      beforeAssignments,
      afterAssignments,
      dryRunRecords,
      week_data.secretaires,
      week_data.sites,
      besoinsOpsData || [],
      typesInterventionData || []
    );
    
    console.log(`  CHANGEMENTS INDIVIDUELS: ${individualChanges.length} modifications de secrétaires`);
    
    // Clear existing dry_run data for this date (always, even if no new changes)
    console.log(`🗑️  Suppression des anciennes propositions dry-run pour le ${date}...`);
    await supabase
      .from('capacite_effective_dry_run')
      .delete()
      .eq('date', date);

    // Write to dry_run table if there are changes to show
    if (dryRunRecords.length > 0) {
      if (afterUnsatisfied < beforeUnsatisfied) {
        console.log(`  ✅ AMÉLIORATION: ${beforeUnsatisfied - afterUnsatisfied} besoin(s) satisfait(s) en plus`);
      } else if (afterUnsatisfied === beforeUnsatisfied) {
        console.log(`  ℹ️  Même nombre de besoins non satisfaits, mais ${dryRunRecords.length} réorganisation(s) proposée(s)`);
      }
      console.log(`✅ Écriture de ${dryRunRecords.length} changement(s) dans capacite_effective_dry_run...`);

      const { error: insertError } = await supabase
        .from('capacite_effective_dry_run')
        .insert(dryRunRecords);

      if (insertError) {
        console.error('❌ Erreur insertion dry_run:', insertError);
        throw insertError;
      }
      console.log(`✅ ${dryRunRecords.length} changements écrits dans capacite_effective_dry_run`);
    } else {
      console.log(`ℹ️ Aucun changement détecté, dry_run vide pour ce jour`);
    }
      
      return new Response(
        JSON.stringify({
          success: true,
          date: dates[0],
          message: `Amélioration : ${beforeUnsatisfied - afterUnsatisfied} besoin(s) satisfait(s) en plus`,
          before: {
            total_unmet: beforeUnsatisfied,
            assignments_count: beforeAssignments.reduce((sum, a) => sum + a.secretaires.length, 0),
            assignments: beforeAssignments
          },
          after: {
            total_unmet: afterUnsatisfied,
            assignments_count: afterAssignments.reduce((sum, a) => sum + a.secretaires.length, 0),
            assignments: afterAssignments
          },
          improvement: {
            unmet_diff: afterUnsatisfied - beforeUnsatisfied,
            assignment_changes: changes.length,
            score_improvement: solution.result || 0
          },
          individual_changes: individualChanges
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

  } catch (error) {
    const err = error as Error;
    console.error('❌ Dry-run error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
