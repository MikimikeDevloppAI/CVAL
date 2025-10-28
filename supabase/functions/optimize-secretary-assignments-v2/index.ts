import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';
import solver from 'https://esm.sh/javascript-lp-solver@0.4.24';

import type { SiteNeed, WeekData } from './types.ts';
import { ADMIN_SITE_ID, ESPLANADE_OPHTALMOLOGIE_SITE_ID } from './types.ts';
import { loadWeekData, getCurrentWeekAssignments } from './data-loader.ts';
import { buildMILPModelSoft } from './milp-builder.ts';
import { writeAssignments } from './result-writer.ts';

// ============================================================
// LOGGER SYSTEM
// ============================================================
export const logger = {
  level: 'info' as 'info' | 'debug',
  focus: null as { date?: string, secretaire_ids?: string[], secretaire_names?: string[] } | null,
  focusIds: new Set<string>(),
  
  setLevel(level: 'info' | 'debug') {
    this.level = level;
  },
  
  setFocus(focus: { date?: string, secretaire_ids?: string[], secretaire_names?: string[] } | null, weekData?: any) {
    this.focus = focus;
    this.focusIds.clear();
    
    if (focus && weekData) {
      if (focus.secretaire_ids) {
        focus.secretaire_ids.forEach(id => this.focusIds.add(id));
      }
      
      if (focus.secretaire_names && weekData.secretaires) {
        for (const name of focus.secretaire_names) {
          const nameLower = name.toLowerCase();
          const matches = weekData.secretaires.filter((s: any) => 
            s.name?.toLowerCase().includes(nameLower)
          );
          matches.forEach((s: any) => this.focusIds.add(s.id));
          
          if (matches.length > 0) {
            console.log(`🔍 Focus: "${name}" matched ${matches.length} secretary(ies): ${matches.map((s: any) => s.name).join(', ')}`);
          }
        }
      }
      
      if (this.focusIds.size > 0) {
        console.log(`🎯 Focus mode active for ${this.focusIds.size} secretary(ies) on date: ${focus.date || 'all dates'}`);
      }
    }
  },
  
  isFocused(secretaire_id: string, date?: string): boolean {
    if (!this.focus || this.focusIds.size === 0) return false;
    
    const idMatch = this.focusIds.has(secretaire_id);
    const dateMatch = !this.focus.date || !date || this.focus.date === date;
    
    return idMatch && dateMatch;
  },
  
  info(...args: any[]) {
    console.log(...args);
  },
  
  debug(...args: any[]) {
    if (this.level === 'debug') {
      console.log(...args);
    }
  }
};

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
        type_intervention_id: bloc.type_intervention_id,
        salle_assignee: bloc.salle_assignee
      };
      
      needs.push(need);
    }
  }
  
  return needs;
}

// Helper: Load today's assignments from database
async function loadTodayAssignments(
  date: string,
  supabase: any
): Promise<any[]> {
  const { data: capacites, error } = await supabase
    .from('capacite_effective')
    .select('*')
    .eq('date', date)
    .eq('actif', true)
    .not('secretaire_id', 'is', null);
  
  if (error) throw error;
  
  const assignments: any[] = [];
  
  for (const cap of capacites || []) {
    assignments.push({
      secretaire_id: cap.secretaire_id,
      site_id: cap.site_id,
      date: cap.date,
      periode: cap.demi_journee,
      is_admin: cap.site_id === ADMIN_SITE_ID,
      is_bloc: !!cap.planning_genere_bloc_operatoire_id
    });
  }
  
  return assignments;
}

// Run a single optimization pass for the week
async function runOptimizationPass(
  sortedDates: string[],
  weekData: any,
  supabase: any,
  passNumber: 1 | 2,
  pass1Assignments?: Map<string, any[]>
): Promise<{
  success: boolean;
  weekAssignments: Map<string, any[]>;
  summary: any;
}> {
  
  const adminCounters = new Map<string, number>();
  const p2p3Counters = new Map<string, Map<string, Set<string>>>();
  
  const weekAssignments = new Map<string, any[]>();
  
  const dailyResults: any[] = [];
  
  for (const date of sortedDates) {
    logger.info(`\n${'='.repeat(60)}`);
    logger.info(`📅 PASSE ${passNumber} - Optimisation du ${date}`);
    logger.info('='.repeat(60));
    
    // ============================================================
    // 🔑 INITIALISER LES COMPTEURS AVEC LE CONTEXTE GLOBAL (Pass 2 only)
    // ============================================================
    if (passNumber === 2 && pass1Assignments) {
      adminCounters.clear();
      p2p3Counters.clear();
      
      const contextDates = sortedDates.filter(d => d !== date);
      const pass2Dates: string[] = [];
      const pass1Dates: string[] = [];
      
      for (const contextDate of contextDates) {
        let assignmentsForDate: any[];
        
        if (weekAssignments.has(contextDate)) {
          assignmentsForDate = weekAssignments.get(contextDate)!;
          pass2Dates.push(contextDate);
        } 
        else if (pass1Assignments.has(contextDate)) {
          assignmentsForDate = pass1Assignments.get(contextDate)!;
          pass1Dates.push(contextDate);
        } else {
          continue;
        }
        
        for (const assign of assignmentsForDate) {
          const secId = assign.secretaire_id;
          
          if (assign.site_id === ADMIN_SITE_ID) {
            adminCounters.set(secId, (adminCounters.get(secId) || 0) + 1);
          }
          
          const sitePref = weekData.secretaires_sites.find(
            (ss: any) => ss.secretaire_id === secId && ss.site_id === assign.site_id
          );
          
          if (sitePref && 
              (sitePref.priorite === '2' || sitePref.priorite === '3') &&
              assign.site_id === ESPLANADE_OPHTALMOLOGIE_SITE_ID) {
            
            if (!p2p3Counters.has(secId)) {
              p2p3Counters.set(secId, new Map());
            }
            const secMap = p2p3Counters.get(secId)!;
            
            if (!secMap.has(assign.site_id)) {
              secMap.set(assign.site_id, new Set());
            }
            
            secMap.get(assign.site_id)!.add(contextDate);
          }
        }
      }
      
      logger.info(`\n📊 Compteurs Pass 2 initialisés avec contexte global:`);
      logger.info(`  📅 Dates P2 (déjà optimisées): ${pass2Dates.length > 0 ? pass2Dates.join(', ') : 'aucune'}`);
      logger.info(`  📅 Dates P1 (futures): ${pass1Dates.length > 0 ? pass1Dates.join(', ') : 'aucune'}`);
      
      const topAdmin = Array.from(adminCounters.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([id, count]) => {
          const sec = weekData.secretaires.find((s: any) => s.id === id);
          return `${sec?.name || id.slice(0,8)}=${count}`;
        });
      
      logger.info(`  💼 Admin top 5: ${topAdmin.join(', ')}`);
      logger.info(`  ⚠️ P2/P3 Esplanade: ${p2p3Counters.size} secrétaires`);
      
      if (logger.focus && logger.focusIds.size > 0) {
        logger.info(`\n🔍 Focus secretaries for ${date}:`);
        for (const secId of logger.focusIds) {
          const sec = weekData.secretaires.find((s: any) => s.id === secId);
          const adminCount = adminCounters.get(secId) || 0;
          const esplanadeSet = p2p3Counters.get(secId)?.get(ESPLANADE_OPHTALMOLOGIE_SITE_ID);
          const esplanadeDays = esplanadeSet ? esplanadeSet.size : 0;
          
          logger.info(`  👤 ${sec?.name || secId.slice(0,8)}: Admin=${adminCount}, Esplanade P2/P3=${esplanadeDays} jours`);
        }
      }
    }
    
    // ============================================================
    // CALCUL DES BESOINS
    // ============================================================
    const besoinsForDay = weekData.besoins_effectifs.filter((b: any) => b.date === date);
    const planningBlocForDay = weekData.planning_bloc.filter((p: any) => p.date === date);
    
    const needs = calculateNeeds(
      besoinsForDay,
      weekData.medecins_map,
      planningBlocForDay,
      weekData.types_intervention_besoins,
      weekData.sites
    );
    
    needs.push(...weekData.admin_needs.filter((n: any) => n.date === date));
    
    logger.info(`\n📋 ${needs.length} besoins identifiés pour ${date}`);
    
    // ============================================================
    // RESET DES CAPACITÉS
    // ============================================================
    await supabase
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
      .eq('actif', true);
    
    // ============================================================
    // GET WEEK ASSIGNMENTS
    // ============================================================
    const week_assignments = await getCurrentWeekAssignments(
      weekData,
      sortedDates.filter(d => d < date && weekAssignments.has(d))
    );
    
    // ============================================================
    // BUILD CONTEXT
    // ============================================================
    const context = {
      week_assignments,
      today_assignments: new Map(),
      admin_counters: adminCounters,
      p2p3_counters: p2p3Counters
    };
    
    // ============================================================
    // BUILD & SOLVE MILP
    // ============================================================
    const capacitesForDay = weekData.capacites_effective.filter((c: any) => c.date === date);
    
    const model = buildMILPModelSoft(
      date,
      needs,
      capacitesForDay,
      weekData,
      context
    );
    
    const solution = solver.Solve(model);
    
    logger.info(`\n✅ Solution - Score: ${solution.result?.toFixed(1) || 'N/A'}`);
    
    const selectedCombos: any[] = [];
    for (const [varName, value] of Object.entries(solution)) {
      if (varName !== 'feasible' && varName !== 'result' && varName !== 'bounded' && value === 1) {
        const combo = (model as any)._combos?.find((c: any) => c.varName === varName);
        if (combo) {
          selectedCombos.push(combo);
        }
      }
    }
    
    logger.info(`  Assignées: ${selectedCombos.length} secrétaires`);
    
    // ============================================================
    // WRITE ASSIGNMENTS
    // ============================================================
    const writeCount = await writeAssignments(
      solution,
      date,
      needs,
      capacitesForDay,
      supabase
    );
    
    logger.info(`✅ ${writeCount} assignations écrites`);
    
    // ============================================================
    // STOCKER LES ASSIGNMENTS DE CE JOUR
    // ============================================================
    const todayAssignments = await loadTodayAssignments(date, supabase);
    weekAssignments.set(date, todayAssignments);
    
    // ============================================================
    // UPDATE COUNTERS (for Pass 1 only)
    // ============================================================
    if (passNumber === 1) {
      for (const assign of todayAssignments) {
        if (assign.site_id === ADMIN_SITE_ID) {
          adminCounters.set(assign.secretaire_id, (adminCounters.get(assign.secretaire_id) || 0) + 1);
        }
        
        const sitePref = weekData.secretaires_sites.find(
          (ss: any) => ss.secretaire_id === assign.secretaire_id && ss.site_id === assign.site_id
        );
        
        if (sitePref && 
            (sitePref.priorite === '2' || sitePref.priorite === '3') &&
            assign.site_id === ESPLANADE_OPHTALMOLOGIE_SITE_ID) {
          
          if (!p2p3Counters.has(assign.secretaire_id)) {
            p2p3Counters.set(assign.secretaire_id, new Map());
          }
          const secMap = p2p3Counters.get(assign.secretaire_id)!;
          
          if (!secMap.has(assign.site_id)) {
            secMap.set(assign.site_id, new Set());
          }
          
          secMap.get(assign.site_id)!.add(date);
        }
      }
    }
    
    // ============================================================
    // LOGS DE DIAGNOSTIC (debug only)
    // ============================================================
    if (logger.level === 'debug') {
      logger.debug(`\n📊 État des compteurs après ${date}:`);
      
      const topAdminCounters = Array.from(adminCounters.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
      
      logger.debug(`\n💼 Top 10 Admin assignments (semaine):`);
      for (const [secId, count] of topAdminCounters) {
        const sec = weekData.secretaires.find((s: any) => s.id === secId);
        const target = sec?.nombre_demi_journees_admin || 'N/A';
        logger.debug(`  ${sec?.name || secId.slice(0, 8)}: ${count}/${target}`);
      }
      
      const esplanadeOverload: Array<{ secId: string, name: string, days: number }> = [];
      for (const [secId, siteMap] of p2p3Counters) {
        const esplanadeSet = siteMap.get(ESPLANADE_OPHTALMOLOGIE_SITE_ID);
        if (esplanadeSet && esplanadeSet.size >= 2) {
          const sec = weekData.secretaires.find((s: any) => s.id === secId);
          esplanadeOverload.push({
            secId,
            name: sec?.name || secId.slice(0, 8),
            days: esplanadeSet.size
          });
        }
      }
      
      if (esplanadeOverload.length > 0) {
        esplanadeOverload.sort((a, b) => b.days - a.days);
        logger.debug(`\n⚠️ Secrétaires P2/P3 avec 2+ jours Esplanade Ophtalmo:`);
        for (const { name, days } of esplanadeOverload.slice(0, 10)) {
          logger.debug(`  ${name}: ${days} jours`);
        }
      }
    }
    
    dailyResults.push({
      date,
      assigned: writeCount,
      score: solution.result
    });
  }
  
  return {
    success: true,
    weekAssignments,
    summary: {
      dates: sortedDates,
      daily_results: dailyResults
    }
  };
}

async function optimizeSingleWeek(
  dates: string[],
  supabase: any
): Promise<any> {
  const sortedDates = dates.sort();
  
  logger.info(`\n🚀 Optimisation de la semaine: ${sortedDates[0]} → ${sortedDates[sortedDates.length - 1]}`);
  logger.info(`📦 Chargement unique des données de la semaine...`);
  
  const weekData = await loadWeekData(dates, supabase);
  
  if (logger.focus) {
    logger.setFocus(logger.focus, weekData);
  }
  
  // ============================================================
  // PASSE 1
  // ============================================================
  logger.info('\n' + '='.repeat(80));
  logger.info('🔄 PASSE 1: Optimisation initiale de la semaine');
  logger.info('='.repeat(80));
  
  const pass1Results = await runOptimizationPass(
    sortedDates,
    weekData,
    supabase,
    1
  );
  
  if (!pass1Results.success) {
    return pass1Results;
  }
  
  // ============================================================
  // PASSE 2
  // ============================================================
  logger.info('\n' + '='.repeat(80));
  logger.info('🔄 PASSE 2: Ré-optimisation avec contexte global de la semaine');
  logger.info('='.repeat(80));
  
  const pass2Results = await runOptimizationPass(
    sortedDates,
    weekData,
    supabase,
    2,
    pass1Results.weekAssignments
  );
  
  logger.info('\n♻️ Rafraîchissement des vues matérialisées...');
  await supabase.rpc('refresh_besoins_view');
  
  const lastDate = sortedDates[sortedDates.length - 1];
  logger.info(`\n🎯 Assignation des responsables de fermeture pour ${lastDate}...`);
    const { error: closingError } = await supabase.functions.invoke('assign-closing-responsibles', {
      body: { dates: sortedDates }
    });
  if (closingError) {
    logger.info('⚠️ Erreur lors de l\'assignation des responsables de fermeture:', closingError);
  }
  
  return {
    success: true,
    pass1_summary: pass1Results.summary,
    pass2_summary: pass2Results.summary,
    message: `✅ Optimisation en 2 passes terminée pour ${sortedDates.length} jours`
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { dates, logLevel, focus } = await req.json();
    
    logger.setLevel(logLevel || 'info');
    
    if (focus) {
      logger.setFocus(focus);
    }
    
    if (!dates || !Array.isArray(dates) || dates.length === 0) {
      throw new Error('Missing or invalid "dates" parameter (must be a non-empty array)');
    }
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    logger.info(`\n🎯 Optimisation demandée pour ${dates.length} dates`);
    
    const weekGroups = new Map<string, string[]>();
    
    for (const date of dates) {
      const d = new Date(date + 'T00:00:00Z');
      const dayOfWeek = d.getUTCDay();
      const daysUntilMonday = (dayOfWeek === 0 ? -6 : 1 - dayOfWeek);
      const monday = new Date(d);
      monday.setUTCDate(d.getUTCDate() + daysUntilMonday);
      const mondayStr = monday.toISOString().split('T')[0];
      
      if (!weekGroups.has(mondayStr)) {
        weekGroups.set(mondayStr, []);
      }
      weekGroups.get(mondayStr)!.push(date);
    }
    
    logger.info(`📅 ${weekGroups.size} semaine(s) à optimiser`);
    
    const weekPromises = Array.from(weekGroups.values()).map(weekDates => 
      optimizeSingleWeek(weekDates, supabase)
    );
    
    const results = await Promise.all(weekPromises);
    
    return new Response(
      JSON.stringify({
        success: true,
        message: `Optimisation terminée pour ${dates.length} dates`,
        results
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('Error during optimization:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
