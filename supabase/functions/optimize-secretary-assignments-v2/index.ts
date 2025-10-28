import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
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

const DEBUG_VERBOSE = false;

// Helper: UUID validation
function isUuid(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

// Helper: Detect BLOC variable based on structure (last 2 segments = UUIDs)
function isBlocVar(varName: string): boolean {
  if (!varName.startsWith('assign_')) return false;
  const parts = varName.split('_');
  if (parts.length < 7) return false;
  const prev = parts[parts.length - 2];
  const last = parts[parts.length - 1];
  return isUuid(prev) && isUuid(last);
}

function calculateNeeds(
  besoins_effectifs: any[],
  medecins_map: Map<string, any>,
  planning_bloc: any[],
  types_intervention_besoins: any[],
  sites: any[]
): SiteNeed[] {
  if (DEBUG_VERBOSE) {
    console.log('🔍 Calcul des besoins...');
    console.log(`  📌 Besoins effectifs : ${besoins_effectifs.length}`);
    console.log(`  📌 Planning bloc : ${planning_bloc.length}`);
    console.log(`  📌 Sites totaux : ${sites.length}`);
  }
  
  const needs: SiteNeed[] = [];
  
  // ============================================================
  // 1. SITE NEEDS (from besoin_effectif)
  // ============================================================
  // Exclude all bloc sites
  const blocSiteIds = sites
    .filter(s => s.nom.toLowerCase().includes('bloc') || 
                  s.nom.toLowerCase().includes('opératoire'))
    .map(s => s.id);
  
  if (DEBUG_VERBOSE) {
    console.log(`  📌 Sites bloc identifiés : ${blocSiteIds.join(', ')}`);
  }
  
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
    
    needs.push(need);
  }
  
  // ============================================================
  // 2. BLOC NEEDS (from planning_genere_bloc_operatoire)
  // ============================================================
  const blocSite = sites.find(s => 
    s.nom.toLowerCase().includes('bloc') && 
    s.nom.toLowerCase().includes('opératoire')
  );
  
  if (!blocSite && DEBUG_VERBOSE) {
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
        besoin_operation_id: besoinPersonnel.besoin_operation_id,
        type_intervention_id: bloc.type_intervention_id // Pour exceptions (Gastro)
      };
      
      needs.push(need);
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
  
  // ✨ Initialize accumulative counters for the week
  const adminCounters = new Map<string, number>();
  const p2p3Counters = new Map<string, Map<string, number>>();

  // Pre-fill counters from existing capacites_effective (before optimization dates)
  for (const cap of weekData.capacites_effective) {
    // Skip dates that will be optimized
    if (sortedDates.includes(cap.date)) continue;
    
    if (!cap.secretaire_id) continue;
    
    // Count admin
    if (cap.site_id === ADMIN_SITE_ID) {
      const current = adminCounters.get(cap.secretaire_id) || 0;
      adminCounters.set(cap.secretaire_id, current + 1);
    }
    
    // Count P2/P3
    const sitePref = weekData.secretaires_sites.find(
      ss => ss.secretaire_id === cap.secretaire_id && ss.site_id === cap.site_id
    );
    
    if (sitePref && (sitePref.priorite === '2' || sitePref.priorite === '3')) {
      if (!p2p3Counters.has(cap.secretaire_id)) {
        p2p3Counters.set(cap.secretaire_id, new Map());
      }
      const secMap = p2p3Counters.get(cap.secretaire_id)!;
      const siteCount = secMap.get(cap.site_id) || 0;
      secMap.set(cap.site_id, siteCount + 1);
    }
  }

  console.log(`\n📊 Compteurs initialisés:`);
  console.log(`  Admin: ${adminCounters.size} secrétaires`);
  console.log(`  P2/P3: ${p2p3Counters.size} secrétaires`);
  
  const dailyResults: any[] = [];
  
  for (const date of sortedDates) {
    if (DEBUG_VERBOSE) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`📅 OPTIMISATION DU ${date}`);
      console.log('='.repeat(60));
    }
    
    // Calculate needs (with bloc exclusion)
    const needs = calculateNeeds(
      weekData.besoins_effectifs.filter(b => b.date === date),
      weekData.medecins_map,
      weekData.planning_bloc.filter(p => p.date === date),
      weekData.types_intervention_besoins,
      weekData.sites
    );
    
    // Get week assignments (before this day)
    const week_assignments = await getCurrentWeekAssignments(
      weekData,
      sortedDates.filter(d => d < date)
    );

    // ✨ Build context with counters
    const context = {
      week_assignments,
      today_assignments: new Map(),
      admin_counters: adminCounters,
      p2p3_counters: p2p3Counters
    };
    
    // RESET: Clear all capacities for this date before optimization
    if (DEBUG_VERBOSE) {
      console.log(`\n♻️ Reset des capacités pour ${date}...`);
    }
    const { data: resetData, error: resetError } = await supabase
      .from('capacite_effective')
      .update({
        site_id: ADMIN_SITE_ID,
        planning_genere_bloc_operatoire_id: null,
        besoin_operation_id: null,
        is_1r: false,
        is_2f: false,
        is_3f: false
      })
      .eq('date', date)
      .eq('actif', true)
      .select('id');
    
    if (resetError) {
      console.error('❌ Erreur lors du reset:', resetError);
      throw resetError;
    }
    
    // Build and solve MILP model
    const model = buildMILPModelSoft(
      date,
      needs,
      weekData.capacites_effective,
      weekData,
      context
    );
    
    if (DEBUG_VERBOSE) {
      console.log('\n🔄 Résolution du modèle MILP...');
    }
    let solution;
    try {
      solution = solver.Solve(model);
      
      if (!solution.feasible) {
        console.error(`[${date}] ❌ Modèle infaisable`);
        dailyResults.push({ 
          date, 
          assigned: 0, 
          score: 0, 
          error: 'Modèle infaisable' 
        });
        continue;
      }
      
      if (solution.result === Infinity || solution.result === -Infinity || isNaN(solution.result)) {
        console.error(`[${date}] ❌ Modèle non borné - result: ${solution.result}`);
        dailyResults.push({ 
          date, 
          assigned: 0, 
          score: 0, 
          error: 'Modèle non borné' 
        });
        continue;
      }
      
      const assignedVars = Object.entries(solution)
        .filter(([k, v]) => k.startsWith('assign_') && Number(v) > 0.5)
        .map(([k]) => k);
      
      // Count bloc assignments using structure detection
      const blocAssignedVars = assignedVars.filter(v => isBlocVar(v));
      
      // Get BLOC site ID
      const blocSite = weekData.sites.find(s => s.nom.toLowerCase().includes('bloc') && s.nom.toLowerCase().includes('opératoire'));
      const blocSiteId = blocSite?.id || '86f1047f-c4ff-441f-a064-42ee2f8ef37a';
      
      // Essential logs only
      console.log(`[${date}] solver: assigned=${assignedVars.length}, score=${solution.result}`);
      console.log(`[${date}] bloc_assignments=${blocAssignedVars.length}`);
      console.log(`[${date}] bloc_site_id=${blocSiteId}`);
      
      // Sample BLOC variable site_id
      if (blocAssignedVars.length > 0) {
        const parts = blocAssignedVars[0].split('_');
        const siteIdFromVar = parts[2];
        console.log(`[${date}] bloc_sample_site_id_in_var=${siteIdFromVar}`);
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
    
    // ============================================================
    // ANALYZE: Report needs satisfaction (Best Effort mode)
    // ============================================================
    console.log(`\n📊 Analyse des assignations pour ${date}:`);
    for (const need of needs) {
      if (need.site_id === ADMIN_SITE_ID) continue;
      
      const periodCode = need.periode === 'matin' ? '1' : '2';
      const needId = need.type === 'bloc_operatoire' && need.bloc_operation_id && need.besoin_operation_id
        ? `${need.site_id}_${date}_${periodCode}_${need.bloc_operation_id}_${need.besoin_operation_id}`
        : `${need.site_id}_${date}_${periodCode}`;
      
      const assigned = Object.entries(solution)
        .filter(([varName]) => varName.startsWith('assign_') && varName.endsWith(`_${needId}`))
        .filter(([, value]) => Number(value) > 0.5)
        .length;
      
      const site = weekData.sites.find(s => s.id === need.site_id);
      const siteName = site?.nom || need.site_id;
      
      if (assigned < need.nombre_max) {
        console.log(`  ⚠️ Besoin partiel: ${siteName} ${need.periode} - ${assigned}/${need.nombre_max} assignés`);
      } else {
        console.log(`  ✅ Besoin satisfait: ${siteName} ${need.periode} - ${assigned}/${need.nombre_max}`);
      }
    }
    
    
    // ============================================================
    // VERIFY: Check for over-assignment (optional verbose)
    // ============================================================
    if (DEBUG_VERBOSE) {
      console.log('\n🔍 Vérification des sur-assignations:');
      let hasOverAssignment = false;
      
      // Group needs by site/date/periode to check aggregated needs
      const needsBySlot = new Map<string, { needs: SiteNeed[], total_max: number }>();
      for (const need of needs) {
        const slotKey = `${need.site_id}_${need.date}_${need.periode}`;
        if (!needsBySlot.has(slotKey)) {
          needsBySlot.set(slotKey, { needs: [], total_max: 0 });
        }
        const slot = needsBySlot.get(slotKey)!;
        slot.needs.push(need);
        slot.total_max += need.nombre_max;
      }
      
      // Check each slot
      for (const [slotKey, slot] of needsBySlot) {
        const [site_id, slot_date, periode] = slotKey.split('_');
        const site = weekData.sites.find(s => s.id === site_id);
        
        // Count assigned secretaries for this slot
        let assignedForSlot = 0;
        for (const [varName, value] of Object.entries(solution)) {
          if (!varName.startsWith('assign_')) continue;
          if (Number(value) <= 0.5) continue;
          
          // Check if this variable is for this slot
          if (varName.includes(slotKey)) {
            assignedForSlot++;
          }
        }
        
        // Calculate expected max (ceiling of total need)
        const expectedMax = slot.needs.length === 1 
          ? slot.needs[0].nombre_max 
          : Math.ceil(slot.needs.reduce((sum, n) => sum + n.nombre_max, 0));
        
        if (assignedForSlot > expectedMax) {
          console.error(`  ❌ SUR-ASSIGNATION détectée: ${site?.nom || site_id} ${periode}`);
          console.error(`     Assigné: ${assignedForSlot}, Maximum attendu: ${expectedMax}`);
          hasOverAssignment = true;
        } else {
          console.log(`  ✅ ${site?.nom || site_id} ${periode}: ${assignedForSlot}/${expectedMax} secrétaires`);
        }
      }
      
      if (hasOverAssignment) {
        console.error('\n❌ ERREUR: Sur-assignation détectée! Optimisation annulée.');
        dailyResults.push({ 
          date, 
          success: false, 
          reason: 'over_assignment',
          needs_count: needs.length
        });
        continue;
      }
      
      console.log('✅ Aucune sur-assignation détectée\n');
    }
    
    // Write results
    const writeCount = await writeAssignments(
      solution,
      date,
      needs,
      weekData.capacites_effective.filter(c => c.date === date),
      supabase
    );

    console.log(`✅ ${writeCount} assignations écrites`);

    // ✨ Update counters in memory
    for (const [varName, value] of Object.entries(solution)) {
      if (Number(value) < 0.5) continue; // Variable not assigned
      
      // Parse combo variable: "combo_<secId>_<needMatinId>_<needAMId>"
      if (!varName.startsWith('combo_')) continue;
      
      const parts = varName.split('_');
      if (parts.length < 4) continue;
      
      const secId = parts[1]; // secretaire_id is second part
      
      // Find the combo to get the needs
      const needMatinIdPart = parts.slice(2, parts.length - 1).join('_');
      const needAMIdPart = parts[parts.length - 1];
      
      // Process morning assignment
      if (needMatinIdPart !== 'null') {
        const matinNeed = needs.find(n => {
          const needId = n.type === 'bloc_operatoire' && n.bloc_operation_id && n.besoin_operation_id
            ? `${n.site_id}_${date}_1_${n.bloc_operation_id}_${n.besoin_operation_id}`
            : `${n.site_id}_${date}_1`;
          return needId === needMatinIdPart;
        });
        
        if (matinNeed) {
          // Update admin counter
          if (matinNeed.site_id === ADMIN_SITE_ID) {
            const current = adminCounters.get(secId) || 0;
            adminCounters.set(secId, current + 1);
          }
          
          // Update P2/P3 counter
          const sitePref = weekData.secretaires_sites.find(
            ss => ss.secretaire_id === secId && ss.site_id === matinNeed.site_id
          );
          
          if (sitePref && (sitePref.priorite === '2' || sitePref.priorite === '3')) {
            if (!p2p3Counters.has(secId)) {
              p2p3Counters.set(secId, new Map());
            }
            const secMap = p2p3Counters.get(secId)!;
            const siteCount = secMap.get(matinNeed.site_id) || 0;
            secMap.set(matinNeed.site_id, siteCount + 1);
          }
        }
      }
      
      // Process afternoon assignment
      if (needAMIdPart !== 'null') {
        const amNeed = needs.find(n => {
          const needId = n.type === 'bloc_operatoire' && n.bloc_operation_id && n.besoin_operation_id
            ? `${n.site_id}_${date}_2_${n.bloc_operation_id}_${n.besoin_operation_id}`
            : `${n.site_id}_${date}_2`;
          return needId === needAMIdPart;
        });
        
        if (amNeed) {
          // Update admin counter
          if (amNeed.site_id === ADMIN_SITE_ID) {
            const current = adminCounters.get(secId) || 0;
            adminCounters.set(secId, current + 1);
          }
          
          // Update P2/P3 counter
          const sitePref = weekData.secretaires_sites.find(
            ss => ss.secretaire_id === secId && ss.site_id === amNeed.site_id
          );
          
          if (sitePref && (sitePref.priorite === '2' || sitePref.priorite === '3')) {
            if (!p2p3Counters.has(secId)) {
              p2p3Counters.set(secId, new Map());
            }
            const secMap = p2p3Counters.get(secId)!;
            const siteCount = secMap.get(amNeed.site_id) || 0;
            secMap.set(amNeed.site_id, siteCount + 1);
          }
        }
      }
    }

    // ✨ Diagnostic logs
    console.log(`\n📊 État des compteurs après ${date}:`);
    
    // Top 5 secretaries with most admin
    const topAdmin = Array.from(adminCounters.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    console.log(`  💼 Top Admin:`);
    topAdmin.forEach(([secId, count]) => {
      const sec = weekData.secretaires.find(s => s.id === secId);
      console.log(`    ${sec?.name || secId.slice(0,8)}: ${count} demi-journées`);
    });

    // Secretaries with P2/P3 assignments
    const p2p3Secs = Array.from(p2p3Counters.entries())
      .filter(([, siteMap]) => siteMap.size > 0);
    console.log(`  ⚠️ Assignations P2/P3:`);
    p2p3Secs.slice(0, 5).forEach(([secId, siteMap]) => {
      const sec = weekData.secretaires.find(s => s.id === secId);
      console.log(`    ${sec?.name || secId.slice(0,8)}:`);
      Array.from(siteMap.entries()).forEach(([siteId, count]) => {
        const site = weekData.sites.find(s => s.id === siteId);
        console.log(`      - ${site?.nom || siteId.slice(0,8)}: ${count} demi-journées`);
      });
    });
    
    // Appeler assign-closing-responsibles pour cette journée
    console.log(`\n🔐 Assignation des responsables de fermeture pour ${date}...`);
    try {
      // Calculer la semaine (lundi-dimanche) pour la date courante
      const d = new Date(date);
      const day = d.getDay(); // 0 = dimanche, 1 = lundi
      const diffToMonday = day === 0 ? -6 : 1 - day;
      const monday = new Date(d);
      monday.setDate(monday.getDate() + diffToMonday);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      const week_start = monday.toISOString().split('T')[0];
      const week_end = sunday.toISOString().split('T')[0];

      const { data: closingResult, error: closingError } = await supabase.functions.invoke(
        'assign-closing-responsibles',
        {
          body: { week_start, week_end, selected_dates: [date] }
        }
      );
      
      if (closingError) {
        console.error(`❌ Erreur assign-closing-responsibles pour ${date}:`, closingError);
      } else {
        console.log(`✅ Responsables de fermeture assignés pour ${date}`);
        if (closingResult?.details) {
          console.log(`   📋 Détails:`, closingResult.details);
        }
      }
    } catch (closingErr: any) {
      console.error(`❌ Exception lors de l'appel assign-closing-responsibles:`, closingErr.message);
    }
    
    dailyResults.push({
      date,
      success: true,
      score: solution.result,
      needs_count: needs.length
    });
  }
  
  // Rafraîchir les vues matérialisées après optimisation
  console.log('🔄 Refreshing materialized views...');
  try {
    const refreshUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/refresh-besoins-view`;
    const refreshResponse = await fetch(refreshUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
      }
    });

    if (!refreshResponse.ok) {
      const errorText = await refreshResponse.text();
      console.error('⚠️ Failed to refresh views:', errorText);
    } else {
      console.log('✅ Materialized views refreshed successfully');
    }
  } catch (refreshError) {
    console.error('⚠️ Exception refreshing views:', refreshError);
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
