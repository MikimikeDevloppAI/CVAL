import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'; // redeploy trigger 2025-10-20T20:30:00Z
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';
import solver from 'https://esm.sh/javascript-lp-solver@0.4.24';

import type { SiteNeed, WeekData } from './types.ts';
import { ADMIN_SITE_ID } from './types.ts';
import { loadWeekData, getCurrentWeekAssignments } from './data-loader.ts';
import { buildMILPModelSoft } from './milp-builder.ts';
import { writeAssignments } from './result-writer.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function calculateNeeds(
  besoins_effectifs: any[],
  medecins_map: Map<string, any>,
  planning_bloc: any[],
  types_intervention_besoins: any[],
  sites: any[]
): SiteNeed[] {
  console.log('🔍 Calcul des besoins...');
  console.log(`  📌 Besoins effectifs : ${besoins_effectifs.length}`);
  console.log(`  📌 Planning bloc : ${planning_bloc.length}`);
  console.log(`  📌 Sites totaux : ${sites.length}`);
  
  const needs: SiteNeed[] = [];
  
  // ============================================================
  // 1. SITE NEEDS (from besoin_effectif)
  // ============================================================
  // Exclude all bloc sites
  const blocSiteIds = sites
    .filter(s => s.nom.toLowerCase().includes('bloc') || 
                  s.nom.toLowerCase().includes('opératoire'))
    .map(s => s.id);
  
  console.log(`  📌 Sites bloc identifiés : ${blocSiteIds.join(', ')}`);
  
  // Group by site + date + demi_journee
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
  
  for (const [key, besoins] of siteGroups) {
    const [site_id, date, demi_journee] = key.split('|');
    
    let totalBesoin = 0;
    const medecins_ids: string[] = [];
    
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
    
    const need = {
      site_id,
      date,
      periode: demi_journee as 'matin' | 'apres_midi',
      nombre_suggere: nombre_max,
      nombre_max,
      medecins_ids,
      type: 'site' as const
    };
    
    console.log(`\n  ✅ Besoin SITE calculé:`, {
      type: need.type,
      site_id: need.site_id,
      date: need.date,
      periode: need.periode,
      nombre_suggere: need.nombre_suggere,
      nombre_max: need.nombre_max,
      medecins_count: need.medecins_ids.length
    });
    
    needs.push(need);
  }
  
  // ============================================================
  // 2. BLOC NEEDS (from planning_genere_bloc_operatoire)
  // ============================================================
  const blocSite = sites.find(s => 
    s.nom.toLowerCase().includes('bloc') && 
    s.nom.toLowerCase().includes('opératoire')
  );
  
  if (!blocSite) {
    console.warn('⚠️ Site "Bloc opératoire" non trouvé');
  }
  
  for (const bloc of planning_bloc) {
    // Get personnel needs for this intervention type
    const besoinsPersonnel = types_intervention_besoins.filter(
      tb => tb.type_intervention_id === bloc.type_intervention_id && tb.actif
    );
    
    for (const besoinPersonnel of besoinsPersonnel) {
      const need = {
        site_id: blocSite?.id || bloc.site_id,
        date: bloc.date,
        periode: bloc.periode,
        nombre_suggere: besoinPersonnel.nombre_requis,
        nombre_max: besoinPersonnel.nombre_requis,
        medecins_ids: bloc.medecin_id ? [bloc.medecin_id] : [],
        type: 'bloc_operatoire' as const,
        bloc_operation_id: bloc.id,
        besoin_operation_id: besoinPersonnel.besoin_operation_id
      };
      
      console.log(`\n  ✅ Besoin BLOC calculé:`, {
        type: need.type,
        site_id: need.site_id,
        date: need.date,
        periode: need.periode,
        nombre_max: need.nombre_max,
        bloc_operation_id: need.bloc_operation_id,
        besoin_operation_id: need.besoin_operation_id
      });
      
      needs.push(need);
    }
  }
  
  console.log(`\n✅ Total besoins calculés: ${needs.length} (Sites: ${needs.filter(n => n.type === 'site').length}, Bloc: ${needs.filter(n => n.type === 'bloc_operatoire').length})`);
  
  return needs;
}

async function optimizeSingleWeek(
  dates: string[],
  supabase: any
): Promise<any> {
  const sortedDates = dates.sort();
  
  console.log(`\n🚀 Optimisation de la semaine: ${sortedDates[0]} → ${sortedDates[sortedDates.length - 1]}`);
  
  // Load full week data
  const weekData = await loadWeekData(dates, supabase);
  
  const dailyResults: any[] = [];
  
  for (const date of sortedDates) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📅 OPTIMISATION DU ${date}`);
    console.log('='.repeat(60));
    
    // Calculate needs (with bloc exclusion)
    const needs = calculateNeeds(
      weekData.besoins_effectifs.filter(b => b.date === date),
      weekData.medecins_map,
      weekData.planning_bloc.filter(p => p.date === date),
      weekData.types_intervention_besoins,
      weekData.sites
    );
    
    console.log(`\n📋 Besoins calculés: ${needs.length} besoins`);
    console.log(`  Sites: ${needs.filter(n => n.type === 'site').length}`);
    console.log(`  Bloc: ${needs.filter(n => n.type === 'bloc_operatoire').length}`);
    
    // Détail des besoins par site
    const needsBySite = new Map<string, number>();
    for (const need of needs) {
      needsBySite.set(need.site_id, (needsBySite.get(need.site_id) || 0) + 1);
    }
    console.log('\n  📊 Répartition par site:');
    for (const [site_id, count] of needsBySite) {
      const site = weekData.sites.find(s => s.id === site_id);
      console.log(`    ${site?.nom || site_id}: ${count} besoins`);
    }
    
    // Get week assignments (before this day)
    const week_assignments = await getCurrentWeekAssignments(
      weekData,
      sortedDates.filter(d => d < date)
    );
    
    // Build and solve MILP model
    const model = buildMILPModelSoft(
      date,
      needs,
      weekData.capacites_effective,
      weekData,
      week_assignments
    );
    
    console.log('\n🔄 Résolution du modèle MILP...');
    let solution;
    try {
      solution = solver.Solve(model);
      
      console.log(`\n📊 Résultat du solveur:`);
      console.log(`  feasible: ${solution.feasible}`);
      console.log(`  bounded: ${solution.bounded}`);
      console.log(`  result: ${solution.result}`);
      
      if (!solution.feasible) {
        console.error(`❌ Modèle infaisable - aucune solution trouvée`);
        dailyResults.push({ 
          date, 
          assigned: 0, 
          score: 0, 
          error: 'Modèle infaisable' 
        });
        continue;
      }
      
      if (solution.result === Infinity || solution.result === -Infinity || isNaN(solution.result)) {
        console.error(`❌ Modèle non borné ou invalide - result: ${solution.result}`);
        dailyResults.push({ 
          date, 
          assigned: 0, 
          score: 0, 
          error: 'Modèle non borné' 
        });
        continue;
      }
      
      const assignedVars = Object.entries(solution)
        .filter(([k, v]) => k.startsWith('assign_') && v === 1)
        .map(([k]) => k);
      console.log(`  ✅ ${assignedVars.length} assignations trouvées (score: ${solution.result})`);
      
      if (assignedVars.length > 0) {
        assignedVars.slice(0, 10).forEach((v, i) => console.log(`    [${i+1}] ${v}`));
        if (assignedVars.length > 10) {
          console.log(`    ... et ${assignedVars.length - 10} autres assignations`);
        }
      } else {
        console.warn('⚠️ Aucune variable assignée malgré un modèle faisable.');
      }
    } catch (error: any) {
      console.error(`\n❌ ERREUR lors de la résolution du solveur:`, error);
      console.error(`  Message: ${error.message}`);
      console.error(`  Stack: ${error.stack}`);
      dailyResults.push({ 
        date, 
        success: false, 
        reason: 'solver_error',
        error: error.message
      });
      continue;
    }
    
    if (!solution.feasible) {
      console.error(`\n❌ ÉCHEC: Aucune solution faisable trouvée pour ${date}`);
      console.error(`  Raison possible: contraintes trop restrictives`);
      console.error(`  Besoins: ${needs.length}, Contraintes: ${Object.keys(model.constraints).length}`);
      dailyResults.push({ 
        date, 
        success: false, 
        reason: 'infeasible',
        needs_count: needs.length
      });
      continue;
    }
    
    const assignedCount = Object.entries(solution).filter(([key, value]) => key.startsWith('assign_') && value === 1).length;
    console.log(`\n✅ Solution trouvée!`);
    console.log(`  🏆 Score total: ${solution.result}`);
    console.log(`  📊 Assignations: ${assignedCount}`);
    
    // Write results
    await writeAssignments(
      solution,
      date,
      needs,
      weekData.capacites_effective.filter(c => c.date === date),
      supabase
    );
    
    dailyResults.push({
      date,
      success: true,
      score: solution.result,
      needs_count: needs.length
    });
  }
  
  return { 
    success: true, 
    week_start: sortedDates[0],
    week_end: sortedDates[sortedDates.length - 1],
    daily_results: dailyResults 
  };
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { dates } = await req.json();

    if (!dates || !Array.isArray(dates) || dates.length === 0) {
      throw new Error('Le paramètre "dates" est requis et doit être un tableau non vide');
    }

    console.log(`\n========================================`);
    console.log(`🎯 OPTIMISATION MILP V2 - Build ${new Date().toISOString()}`);
    console.log(`📅 Dates à optimiser: ${dates.length} jour(s)`);
    console.log(`========================================\n`);

    // Group dates by week
    const weekGroups = new Map<string, string[]>();
    
    for (const date of dates) {
      const d = new Date(date);
      const day = d.getDay();
      const diffToMonday = day === 0 ? -6 : 1 - day;
      const monday = new Date(d);
      monday.setDate(monday.getDate() + diffToMonday);
      const weekKey = monday.toISOString().split('T')[0];
      
      if (!weekGroups.has(weekKey)) {
        weekGroups.set(weekKey, []);
      }
      weekGroups.get(weekKey)!.push(date);
    }

    console.log(`📊 Nombre de semaines à optimiser: ${weekGroups.size}`);

    if (weekGroups.size === 1) {
      // Single week optimization
      const weekDates = Array.from(weekGroups.values())[0];
      const result = await optimizeSingleWeek(weekDates, supabase);
      
      return new Response(
        JSON.stringify(result),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } else {
      // Multi-week optimization (parallel)
      console.log('🔀 Optimisation multi-semaines en parallèle');
      
      const promises = Array.from(weekGroups.values()).map(weekDates => 
        optimizeSingleWeek(weekDates, supabase)
      );
      
      const results = await Promise.all(promises);
      
      return new Response(
        JSON.stringify({
          success: true,
          weeks_optimized: weekGroups.size,
          results
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  } catch (error: any) {
    console.error('❌ Erreur:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
