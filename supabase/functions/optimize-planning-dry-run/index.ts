import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import solver from 'https://esm.sh/javascript-lp-solver@0.4.24';

// Import exact same modules as v2 to guarantee identical results
import { loadWeekData } from './data-loader.ts';
import { buildMILPModelSoft } from './milp-builder.ts';
import type { SiteNeed, CapaciteEffective, AssignmentSummary } from './types.ts';

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

// Get current assignments for comparison (simulation mode: all in admin)
function getCurrentAssignments(
  date: string,
  capacites: CapaciteEffective[],
  needs: SiteNeed[],
  secretaires: any[]
): any[] {
  const assignments: any[] = [];

  // SIMULATION MODE: Ignore existing assignments, return empty state
  // This simulates all secretaries being in "administratif" (unassigned)
  for (const need of needs) {
    assignments.push({
      site_id: need.site_id,
      site_nom: need.site_nom,
      periode: need.periode,
      type: need.type,
      bloc_operation_id: need.bloc_operation_id,
      besoin_operation_id: need.besoin_operation_id,
      secretaires: [], // Empty = everyone in admin
      nombre_requis: Math.ceil(need.nombre_suggere),
      nombre_assigne: 0, // No one assigned
      status: 'non_satisfait' // All needs unsatisfied at start
    });
  }

  return assignments;
}

// Analyze solution to get assignments
function analyzeSolution(
  solution: any,
  needs: SiteNeed[],
  capacites: CapaciteEffective[],
  secretaires: any[]
): any[] {
  const assignments: any[] = [];

  for (const need of needs) {
    const assigned: any[] = [];

    for (const [varName, value] of Object.entries(solution)) {
      if (!varName.startsWith('assign_') || Number(value) <= 0.5) continue;

      const parts = varName.split('_');
      const secretaire_id = parts[1];

      // Check if this assignment is for this need
      let matches = false;
      if (need.type === 'bloc_operatoire') {
        const prev = parts[parts.length - 2];
        const last = parts[parts.length - 1];
        matches = prev === need.bloc_operation_id && last === need.besoin_operation_id;
      } else {
        const needParts = varName.split('_').slice(2);
        const site_id = needParts[0];
        const needDate = needParts[1];
        const periodCode = needParts[2];
        const periode = periodCode === '1' ? 'matin' : 'apres_midi';
        matches = site_id === need.site_id && needDate === need.date && periode === need.periode;
      }

      if (matches) {
        const sec = secretaires.find(s => s.id === secretaire_id);
        assigned.push({
          id: secretaire_id,
          nom: sec ? `${sec.first_name} ${sec.name}` : 'Inconnu',
          is_backup: false,
          is_1r: false,
          is_2f: false,
          is_3f: false
        });
      }
    }

    assignments.push({
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

    // Get available capacities (simulation will show empty "before" state)
    const capacites = week_data.capacites_effective.filter(c => c.date === date);

    // Build MILP model using exact same function as v2
    const week_assignments: AssignmentSummary[] = [];
    const model = buildMILPModelSoft(date, needs, capacites, week_data, week_assignments);

    console.log(`📊 Model: ${Object.keys(model.variables).length} vars, ${Object.keys(model.constraints).length} constraints`);

    // Solve using exact same solver
    const solution = solver.Solve(model);

    if (!solution.feasible) {
      return new Response(
        JSON.stringify({
          feasible: false,
          all_needs_satisfied: false,
          before: { assignments: beforeAssignments },
          after: { assignments: [] },
          changes: [],
          message: 'Aucune solution trouvée'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Analyze solution to get AFTER assignments
    const afterAssignments = analyzeSolution(solution, needs, capacites, week_data.secretaires);

    // Calculate changes
    const changes = calculateChanges(beforeAssignments, afterAssignments);

    // Check if all needs satisfied
    const all_needs_satisfied = afterAssignments.every(a => a.status === 'satisfait');

    console.log(`✅ Solution: ${all_needs_satisfied ? 'Tous besoins satisfaits' : 'Partiel'}`);
    console.log(`📝 Changes: ${changes.length} modifications`);

    return new Response(
      JSON.stringify({
        feasible: true,
        all_needs_satisfied,
        before: { assignments: beforeAssignments },
        after: { assignments: afterAssignments },
        changes,
        solution_score: solution.result || 0
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
