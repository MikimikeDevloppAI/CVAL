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
          totalBesoin += medecin.besoin_secretaires || 1.2;
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { date } = await req.json();

    if (!date) {
      throw new Error('Date is required');
    }

    console.log(`🧪 Dry-run optimization for ${date}`);

    // Load data using exact same function as v2
    const week_data = await loadWeekData([date], supabase);
    
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

    // Capture current state from REAL capacities (for bonus +30)
    console.log(`\n🎯 Capture de l'état actuel pour bonus +30...`);
    const currentState = new Map<string, CurrentState>();
    
    for (const cap of capacites) {
      if (!cap.secretaire_id) continue;
      
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
        state.matin_besoin_op_id = cap.besoin_operation_id || null;
        state.matin_bloc_op_id = cap.planning_genere_bloc_operatoire_id || null;
      } else {
        state.am_site_id = cap.site_id;
        state.am_besoin_op_id = cap.besoin_operation_id || null;
        state.am_bloc_op_id = cap.planning_genere_bloc_operatoire_id || null;
      }
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
              // Admin: match when morning is unassigned (null)
              matches = combo.needMatin == null;
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
              matches = combo.needAM == null;
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
          assigned.push({
            id: combo.secretaire_id,
            nom: sec ? `${sec.first_name} ${sec.name}` : 'Inconnu',
            is_backup: false
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

    // Write to dry_run table if there are changes to show
    if (dryRunRecords.length > 0) {
      if (afterUnsatisfied < beforeUnsatisfied) {
        console.log(`  ✅ AMÉLIORATION: ${beforeUnsatisfied - afterUnsatisfied} besoin(s) satisfait(s) en plus`);
      } else if (afterUnsatisfied === beforeUnsatisfied) {
        console.log(`  ℹ️  Même nombre de besoins non satisfaits, mais ${dryRunRecords.length} réorganisation(s) proposée(s)`);
      }
      console.log(`✅ Écriture de ${dryRunRecords.length} changement(s) dans capacite_effective_dry_run...`);

      // Clear existing dry_run data for this date
      await supabase
        .from('capacite_effective_dry_run')
        .delete()
        .eq('date', date);

      const { error: insertError } = await supabase
        .from('capacite_effective_dry_run')
        .insert(dryRunRecords);

      if (insertError) {
        console.error('❌ Erreur insertion dry_run:', insertError);
        throw insertError;
      }
      console.log(`✅ ${dryRunRecords.length} changements écrits dans capacite_effective_dry_run`);
    } else {
      console.log(`ℹ️ Aucun changement détecté, dry_run vide`);
    }
      
      return new Response(
        JSON.stringify({
          success: true,
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
          }
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
