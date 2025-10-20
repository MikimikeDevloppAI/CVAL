import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

declare const solver: any;

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
  const needs: SiteNeed[] = [];
  
  // ============================================================
  // 1. SITE NEEDS (from besoin_effectif)
  // ============================================================
  // Exclude all bloc sites
  const blocSiteIds = sites
    .filter(s => s.nom.toLowerCase().includes('bloc') || 
                  s.nom.toLowerCase().includes('opératoire'))
    .map(s => s.id);
  
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
    
    needs.push({
      site_id,
      date,
      periode: demi_journee as 'matin' | 'apres_midi',
      nombre_suggere: nombre_max,
      nombre_max,
      medecins_ids,
      type: 'site'
    });
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
      });
    }
  }
  
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
    console.log(`\n📅 Optimisation du ${date}`);
    
    // Calculate needs (with bloc exclusion)
    const needs = calculateNeeds(
      weekData.besoins_effectifs.filter(b => b.date === date),
      weekData.medecins_map,
      weekData.planning_bloc.filter(p => p.date === date),
      weekData.types_intervention_besoins,
      weekData.sites
    );
    
    console.log(`📋 Besoins calculés: ${needs.length} besoins (${needs.filter(n => n.type === 'site').length} sites, ${needs.filter(n => n.type === 'bloc_operatoire').length} bloc)`);
    
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
    
    console.log('🔄 Résolution du modèle MILP...');
    const solution = solver.Solve(model);
    
    if (!solution.feasible) {
      console.error(`❌ Pas de solution faisable pour ${date}`);
      dailyResults.push({ 
        date, 
        success: false, 
        reason: 'infeasible',
        needs_count: needs.length
      });
      continue;
    }
    
    console.log(`✅ Solution trouvée avec score: ${solution.result}`);
    
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
    console.log(`🎯 OPTIMISATION MILP V2`);
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
