import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import solver from 'https://esm.sh/javascript-lp-solver@0.4.24';

import { loadWeekData } from './data-loader.ts';
import { buildMILPModelCombo } from './milp-builder-combo.ts';
import type { SiteNeed, CapaciteEffective, AssignmentSummary } from './types.ts';
import { ADMIN_SITE_ID } from './types.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Calculate needs exactly like v2
function calculateNeeds(
  date: string,
  besoins_effectifs: any[],
  medecins_map: Map<string, any>,
  planning_bloc: any[],
  types_intervention_besoins: any[],
  sites: any[]
): SiteNeed[] {
  const needsMap = new Map<string, SiteNeed>();

  // Site needs
  for (const besoin of besoins_effectifs) {
    if (besoin.date !== date || besoin.type !== 'medecin') continue;
    
    const key = `${besoin.site_id}_${besoin.demi_journee}`;
    const medecin = medecins_map.get(besoin.medecin_id);
    if (!medecin) continue;

    if (!needsMap.has(key)) {
      const site = sites.find(s => s.id === besoin.site_id);
      needsMap.set(key, {
        site_id: besoin.site_id,
        date,
        periode: besoin.demi_journee,
        nombre_suggere: 0,
        nombre_max: 999,
        medecins_ids: [],
        type: 'site',
        site_nom: site?.nom || 'Site inconnu'
      });
    }

    const need = needsMap.get(key)!;
    need.medecins_ids.push(besoin.medecin_id);
    need.nombre_suggere += medecin.besoin_secretaires || 1.2;
    need.nombre_max = Math.max(need.nombre_max, Math.ceil(need.nombre_suggere * 1.5));
  }

  // Bloc needs
  for (const bloc of planning_bloc) {
    if (bloc.date !== date || bloc.statut === 'annule') continue;

    const tibs = types_intervention_besoins.filter(
      tib => tib.type_intervention_id === bloc.type_intervention_id && tib.actif
    );

    for (const tib of tibs) {
      const key = `bloc_${bloc.id}_${tib.besoin_operation_id}`;
      const site = sites.find(s => s.nom.toLowerCase().includes('bloc'));
      
      needsMap.set(key, {
        site_id: site?.id || '86f1047f-c4ff-441f-a064-42ee2f8ef37a',
        date,
        periode: bloc.periode,
        nombre_suggere: tib.nombre_requis,
        nombre_max: tib.nombre_requis,
        medecins_ids: bloc.medecin_id ? [bloc.medecin_id] : [],
        type: 'bloc_operatoire',
        bloc_operation_id: bloc.id,
        besoin_operation_id: tib.besoin_operation_id,
        site_nom: site?.nom || 'Bloc opératoire'
      });
    }
  }

  return Array.from(needsMap.values());
}

// Get current assignments for comparison
function getCurrentAssignments(
  date: string,
  capacites: CapaciteEffective[],
  needs: SiteNeed[],
  secretaires: any[]
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

    assignments.push({
      date: need.date,
      site_id: need.site_id,
      site_nom: need.site_nom,
      periode: need.periode,
      type: need.type,
      bloc_operation_id: need.bloc_operation_id,
      besoin_operation_id: need.besoin_operation_id,
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
    
    // Calculate needs using exact same logic as v2
    const needs = calculateNeeds(
      date,
      week_data.besoins_effectifs,
      week_data.medecins_map,
      week_data.planning_bloc,
      week_data.types_intervention_besoins,
      week_data.sites
    );

    // Merge with admin needs
    const admin_need = week_data.admin_needs.find(n => n.date === date);
    if (admin_need) {
      needs.push(admin_need);
    }

    // Get current assignments BEFORE optimization
    const beforeAssignments = getCurrentAssignments(
      date,
      week_data.capacites_effective,
      needs,
      week_data.secretaires
    );

    // Get available capacities for optimization
    const capacites = week_data.capacites_effective.filter(c => c.date === date);

    // Build MILP model using combo approach with current state penalties
    const { model, combos } = buildMILPModelCombo(date, needs, capacites, week_data, beforeAssignments);

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

    // Analyze solution from combos
    const selectedCombos = combos.filter(c => solution[c.varName] > 0.5);
    
    console.log(`  ✅ Combos sélectionnés: ${selectedCombos.length}`);
    console.log(`\n📊 Détails des combos sélectionnés:`);
    for (const combo of selectedCombos) {
      const sec = week_data.secretaires.find(s => s.id === combo.secretaire_id);
      const matinSite = combo.needMatin ? week_data.sites.find(s => s.id === combo.needMatin!.site_id)?.nom : 'Admin/Libre';
      const amSite = combo.needAM ? week_data.sites.find(s => s.id === combo.needAM!.site_id)?.nom : 'Admin/Libre';
      console.log(`  ${sec?.name}: ${matinSite} / ${amSite} (score: ${combo.score})`);
    }
    
    const afterAssignments: any[] = [];

    for (const need of needs) {
      const assigned: any[] = [];

      for (const combo of selectedCombos) {
        let matches = false;
        
        // Check if this combo covers this need
        if (need.periode === 'matin' && combo.needMatin) {
          // Match site_id and type first
          if (combo.needMatin.site_id === need.site_id && combo.needMatin.type === need.type) {
            // For bloc_operatoire, also check bloc-specific IDs
            if (need.type === 'bloc_operatoire') {
              matches = combo.needMatin.bloc_operation_id === need.bloc_operation_id &&
                       combo.needMatin.besoin_operation_id === need.besoin_operation_id;
            } else {
              // For site type, site_id and type match is enough
              matches = true;
            }
          }
        } else if (need.periode === 'apres_midi' && combo.needAM) {
          // Match site_id and type first
          if (combo.needAM.site_id === need.site_id && combo.needAM.type === need.type) {
            // For bloc_operatoire, also check bloc-specific IDs
            if (need.type === 'bloc_operatoire') {
              matches = combo.needAM.bloc_operation_id === need.bloc_operation_id &&
                       combo.needAM.besoin_operation_id === need.besoin_operation_id;
            } else {
              // For site type, site_id and type match is enough
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

      afterAssignments.push({
        date: need.date,
        site_id: need.site_id,
        site_nom: need.site_nom,
        periode: need.periode,
        type: need.type,
        bloc_operation_id: need.bloc_operation_id,
        besoin_operation_id: need.besoin_operation_id,
        secretaires: assigned,
        nombre_requis: Math.ceil(need.nombre_suggere),
        nombre_assigne: assigned.length,
        status: assigned.length >= Math.ceil(need.nombre_suggere) ? 'satisfait' : 
                assigned.length > 0 ? 'partiel' : 'non_satisfait'
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

    // Write to dry_run table if improvement found
    if (afterUnsatisfied < beforeUnsatisfied) {
      console.log(`  ✅ AMÉLIORATION: ${beforeUnsatisfied - afterUnsatisfied} besoin(s) satisfait(s) en plus`);
      console.log(`✅ Écriture dans capacite_effective_dry_run...`);

      // Clear existing dry_run data for this date
      await supabase
        .from('capacite_effective_dry_run')
        .delete()
        .eq('date', date);

      // Write new assignments (INCLUDING ADMIN)
      const dryRunRecords: any[] = [];
      
      for (const combo of selectedCombos) {
        // Morning assignment (include Admin)
        if (combo.needMatin) {
          dryRunRecords.push({
            secretaire_id: combo.secretaire_id,
            date,
            demi_journee: 'matin',
            site_id: combo.needMatin.site_id,
            besoin_operation_id: combo.needMatin.besoin_operation_id,
            planning_genere_bloc_operatoire_id: combo.needMatin.bloc_operation_id,
            is_1r: false,
            is_2f: false,
            is_3f: false,
            actif: true
          });
        }

        // Afternoon assignment (include Admin)
        if (combo.needAM) {
          dryRunRecords.push({
            secretaire_id: combo.secretaire_id,
            date,
            demi_journee: 'apres_midi',
            site_id: combo.needAM.site_id,
            besoin_operation_id: combo.needAM.besoin_operation_id,
            planning_genere_bloc_operatoire_id: combo.needAM.bloc_operation_id,
            is_1r: false,
            is_2f: false,
            is_3f: false,
            actif: true
          });
        }
      }

      if (dryRunRecords.length > 0) {
        const { error: insertError } = await supabase
          .from('capacite_effective_dry_run')
          .insert(dryRunRecords);

        if (insertError) {
          console.error('❌ Erreur insertion dry_run:', insertError);
          throw insertError;
        }
      }

      console.log(`✅ ${dryRunRecords.length} assignations écrites dans capacite_effective_dry_run`);
      
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
    } else {
      console.log(`  ⚠️ Aucune amélioration trouvée`);
      
      return new Response(
        JSON.stringify({
          success: true,
          message: afterUnsatisfied === beforeUnsatisfied 
            ? `Situation maintenue (${afterUnsatisfied} besoins non satisfaits)`
            : `Dégradation : ${afterUnsatisfied - beforeUnsatisfied} besoin(s) non satisfait(s) en plus`,
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
    }

  } catch (error) {
    const err = error as Error;
    console.error('❌ Dry-run error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
