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
    
    const site = sites.find(s => s.id === besoin.site_id);
    // Exclure les sites de type "bloc opératoire" des besoins site
    const siteName = (site?.nom || '').toLowerCase();
    if (siteName.includes('bloc')) continue;
    
    const key = `${besoin.site_id}_${besoin.demi_journee}`;
    const medecin = medecins_map.get(besoin.medecin_id);
    if (!medecin) continue;

    if (!needsMap.has(key)) {
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
    need.nombre_max = Math.ceil(need.nombre_suggere);
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




    // Get current assignments BEFORE optimization
    const beforeAssignments = getCurrentAssignments(
      date,
      week_data.capacites_effective,
      needs,
      week_data.secretaires
    );

    // Compute residual maxima (prevent overfilling already satisfied sites)
    console.log(`\n🧮 Calcul des maxima résiduels par site/période:`);
    const beforeMap = new Map<string, number>();
    for (const a of beforeAssignments) {
      if (a.type === 'site' && a.site_id !== ADMIN_SITE_ID) {
        const k = `${a.site_id}_${a.periode}`;
        beforeMap.set(k, (beforeMap.get(k) || 0) + a.secretaires.length);
      } else if (a.type === 'bloc_operatoire' && a.bloc_operation_id && a.besoin_operation_id) {
        const k = `bloc_${a.bloc_operation_id}_${a.besoin_operation_id}_${a.periode}`;
        beforeMap.set(k, (beforeMap.get(k) || 0) + a.secretaires.length);
      }
    }

    for (const need of needs) {
      const requis = Math.ceil(need.nombre_suggere);
      const k = need.type === 'site'
        ? `${need.site_id}_${need.periode}`
        : `bloc_${need.bloc_operation_id}_${need.besoin_operation_id}_${need.periode}`;
      const assignedBefore = beforeMap.get(k) || 0;
      const residual = Math.max(0, requis - assignedBefore);
      console.log(`  ${need.site_nom} ${need.periode}: requis=${requis}, avant=${assignedBefore}, max_residuel=${residual}`);
      need.nombre_max = residual;
    }

    // Get available capacities for optimization
    const capacites = week_data.capacites_effective.filter(c => c.date === date);

    // Calculate existing full-day assignments for closure sites
    console.log(`\n🏢 Calcul des journées complètes existantes pour sites de fermeture:`);
    const fullDayCountsBySite = new Map<string, number>();
    
    for (const site of week_data.sites.filter(s => s.fermeture)) {
      const matinCaps = capacites.filter(c => 
        c.date === date && 
        c.demi_journee === 'matin' && 
        c.site_id === site.id
      );
      
      const afternoonCaps = capacites.filter(c => 
        c.date === date && 
        c.demi_journee === 'apres_midi' && 
        c.site_id === site.id
      );
      
      // Count how many secretaries have BOTH morning AND afternoon on this site
      const matinSecIds = new Set(matinCaps.map(c => c.secretaire_id));
      const afternoonSecIds = new Set(afternoonCaps.map(c => c.secretaire_id));
      
      const fullDayCount = Array.from(matinSecIds).filter(id => afternoonSecIds.has(id)).length;
      fullDayCountsBySite.set(site.id, fullDayCount);
      
      console.log(`  Site fermeture ${site.nom}: ${fullDayCount} journées complètes existantes`);
    }

    // Build MILP model using combo approach with current state penalties
    const { model, combos } = buildMILPModelCombo(date, needs, capacites, week_data, beforeAssignments, fullDayCountsBySite);

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

      afterAssignments.push({
        date: need.date,
        site_id: need.site_id,
        site_nom: need.site_nom,
        periode: need.periode,
        type: need.type,
        bloc_operation_id: need.bloc_operation_id,
        besoin_operation_id: need.besoin_operation_id,
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
