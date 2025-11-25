import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';
import solver from 'https://esm.sh/javascript-lp-solver@0.4.24';

import type { SiteNeed, WeekData } from './types.ts';
import { ADMIN_SITE_ID, ESPLANADE_OPHTALMOLOGIE_SITE_ID } from './types.ts';
import { loadWeekData, getCurrentWeekAssignments, prepareWeekContext } from './data-loader.ts';
import { buildMILPModelSoft } from './milp-builder.ts';
import { buildWeeklyMILPModel } from './milp-builder-weekly.ts';
import { writeAssignments } from './result-writer.ts';
import { writeWeeklyAssignments } from './result-writer-weekly.ts';

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
  },
  
  error(...args: any[]) {
    console.error(...args);
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
          totalBesoin += medecin.besoin_secretaires ?? 1.2;
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
      is_bloc: !!cap.planning_genere_bloc_operatoire_id,
      is_1r: cap.is_1r || false,
      is_2f: cap.is_2f || false,
      is_3f: cap.is_3f || false
    });
  }
  
  return assignments;
}

// Load previous 2 weeks (S-2 and S-1) history for 1R/2F rotation penalties and Esplanade
async function loadPreviousWeeksHistory(
  currentWeekStart: string,
  supabase: any
): Promise<{
  closing1R2FHistory: Map<string, number>,
  esplanadeHistory: Map<string, number>
}> {
  const currentMonday = new Date(currentWeekStart + 'T00:00:00Z');
  
  // S-1: previous week
  const s1Monday = new Date(currentMonday);
  s1Monday.setUTCDate(s1Monday.getUTCDate() - 7);
  const s1Sunday = new Date(s1Monday);
  s1Sunday.setUTCDate(s1Sunday.getUTCDate() + 6);
  
  // S-2: 2 weeks before
  const s2Monday = new Date(currentMonday);
  s2Monday.setUTCDate(s2Monday.getUTCDate() - 14);
  const s2Sunday = new Date(s2Monday);
  s2Sunday.setUTCDate(s2Sunday.getUTCDate() + 6);
  
  const s1Start = s1Monday.toISOString().split('T')[0];
  const s1End = s1Sunday.toISOString().split('T')[0];
  const s2Start = s2Monday.toISOString().split('T')[0];
  const s2End = s2Sunday.toISOString().split('T')[0];
  
  logger.info(`📅 Chargement historique S-2: ${s2Start} → ${s2End}`);
  logger.info(`📅 Chargement historique S-1: ${s1Start} → ${s1End}`);
  
  const { data: capacites, error } = await supabase
    .from('capacite_effective')
    .select('*')
    .gte('date', s2Start)
    .lte('date', s1End)
    .eq('actif', true)
    .not('secretaire_id', 'is', null);
  
  if (error) {
    logger.error(`❌ Erreur chargement historique: ${error.message}`);
    return { closing1R2FHistory: new Map(), esplanadeHistory: new Map() };
  }
  
  const detailsBySecretary = new Map<string, { count1R: number, count2F3F: number }>();
  const esplanadeDaysCount = new Map<string, Set<string>>(); // secId -> Set<dates>
  const alreadyCounted = new Set<string>();
  
  for (const cap of capacites || []) {
    const secId = cap.secretaire_id;
    const roleKey = `${secId}_${cap.date}_${cap.site_id}`;
    const dateStr = cap.date;
    
    // 1. Comptage 1R/2F (existant)
    if (!detailsBySecretary.has(secId)) {
      detailsBySecretary.set(secId, { count1R: 0, count2F3F: 0 });
    }
    
    const details = detailsBySecretary.get(secId)!;
    
    if (cap.is_1r && !alreadyCounted.has(`${roleKey}_1r`)) {
      details.count1R += 1;
      alreadyCounted.add(`${roleKey}_1r`);
    }
    
    if ((cap.is_2f || cap.is_3f) && !alreadyCounted.has(`${roleKey}_2f`)) {
      details.count2F3F += 1;
      alreadyCounted.add(`${roleKey}_2f`);
    }
    
    // 2. 🆕 Comptage jours Esplanade
    if (cap.site_id === ESPLANADE_OPHTALMOLOGIE_SITE_ID) {
      if (!esplanadeDaysCount.has(secId)) {
        esplanadeDaysCount.set(secId, new Set());
      }
      esplanadeDaysCount.get(secId)!.add(dateStr);
    }
  }
  
  // Calculer les scores 1R/2F
  const closing1R2FHistory = new Map<string, number>();
  
  for (const [secId, details] of detailsBySecretary.entries()) {
    const score = details.count1R * 1 + details.count2F3F * 2;
    closing1R2FHistory.set(secId, score);
    logger.info(`  📊 ${secId.substring(0, 8)}: ${details.count1R}×1R + ${details.count2F3F}×2F/3F = ${score} pts`);
  }
  
  // 🆕 Calculer les multiplicateurs Esplanade
  const esplanadeHistory = new Map<string, number>();
  
  for (const [secId, datesSet] of esplanadeDaysCount.entries()) {
    const jours = datesSet.size;
    const multiplier = Math.max(0, jours - 2) / 2;
    esplanadeHistory.set(secId, multiplier);
  }
  
  // Résumé compact
  logger.info(`\n📊 Historique S-2 + S-1:`);
  logger.info(`  🔒 1R/2F: ${closing1R2FHistory.size} secrétaires avec historique`);
  logger.info(`  🏥 Esplanade: ${esplanadeHistory.size} secrétaires avec multiplicateur > 0`);
  
  // Top 3 des scores 1R/2F
  const top1R2F = Array.from(closing1R2FHistory.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  if (top1R2F.length > 0) {
    logger.info(`  🥇 Top 3 1R/2F: ${top1R2F.map(([_, score]) => `${score} pts`).join(', ')}`);
  }
  
  // Top 3 des multiplicateurs Esplanade
  const topEsplanade = Array.from(esplanadeHistory.entries())
    .filter(([_, mult]) => mult > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  if (topEsplanade.length > 0) {
    logger.info(`  🥇 Top 3 Esplanade: ${topEsplanade.map(([_, mult]) => `×${(1 + mult).toFixed(2)}`).join(', ')}`);
  }
  
  return { closing1R2FHistory, esplanadeHistory };
}

// Run a single optimization pass for the week
async function runOptimizationPass(
  sortedDates: string[],
  weekData: any,
  supabase: any,
  passNumber: 1 | 2,
  pass1Assignments?: Map<string, any[]>,
  closing1R2FHistory?: Map<string, number>,
  esplanadeHistory?: Map<string, number>
): Promise<{
  success: boolean;
  weekAssignments: Map<string, any[]>;
  summary: any;
}> {
  
  
  const adminCounters = new Map<string, number>();
  const p2p3Counters = new Map<string, Map<string, Set<string>>>();
  const closing1RDays = new Map<string, Set<string>>(); // secretaire_id → Set de dates uniques
  const closing2F3FDays = new Map<string, Set<string>>(); // secretaire_id → Set de dates uniques
  const penaltyMultipliers1R2F = new Map<string, number>();
  const penaltyMultipliersEsplanade = new Map<string, number>();
  
  const weekAssignments = new Map<string, any[]>();
  
  const dailyResults: any[] = [];
  
  for (const date of sortedDates) {
    
    // ============================================================
    // 🔑 INITIALISER LES COMPTEURS AVEC LE CONTEXTE GLOBAL (Pass 2 only)
    // ============================================================
    if (passNumber === 2 && pass1Assignments) {
      adminCounters.clear();
      p2p3Counters.clear();
      closing1RDays.clear();
      closing2F3FDays.clear();
      penaltyMultipliers1R2F.clear();
      penaltyMultipliersEsplanade.clear();
      
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
          
          // Compter les jours uniques où la secrétaire a un rôle 1R ou 2F/3F
          if (assign.is_1r) {
            if (!closing1RDays.has(secId)) {
              closing1RDays.set(secId, new Set());
            }
            closing1RDays.get(secId)!.add(contextDate);
          }
          
          if (assign.is_2f || assign.is_3f) {
            if (!closing2F3FDays.has(secId)) {
              closing2F3FDays.set(secId, new Set());
            }
            closing2F3FDays.get(secId)!.add(contextDate);
          }
        }
      }
      
      // 🆕 Calculer les multiplicateurs de pénalité depuis l'historique S-2 + S-1
      penaltyMultipliers1R2F.clear();
      penaltyMultipliersEsplanade.clear();
      
      if (closing1R2FHistory) {
        logger.info(`\n🔢 Calcul multiplicateurs 1R/2F depuis historique S-2 + S-1:`);
        for (const [secId, historyScore] of closing1R2FHistory.entries()) {
          const multiplier = 1 + (historyScore / 10);
          penaltyMultipliers1R2F.set(secId, multiplier);
          const sec = weekData.secretaires.find((s: any) => s.id === secId);
          logger.info(`  ${sec?.name || secId.substring(0, 8)}: ${multiplier.toFixed(2)}x (historique: ${historyScore} pts)`);
        }
      }
      
      if (esplanadeHistory) {
        for (const [secId, multiplier] of esplanadeHistory.entries()) {
          penaltyMultipliersEsplanade.set(secId, 1 + multiplier);
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
    
    // Détecter les sites nécessitant 3F (Paul Jacquier jeudi+vendredi)
    const sitesNeeding3F = new Map<string, Set<string>>();
    const PAUL_JACQUIER_ID = '121dc7d9-99dc-46bd-9b6c-d240ac6dc6c8';
    
    // Group besoins by site and check if Paul Jacquier works both Thursday and Friday
    const sitesByDate = new Map<string, Map<string, any[]>>();
    for (const besoin of weekData.besoins_effectifs) {
      if (!sitesByDate.has(besoin.date)) {
        sitesByDate.set(besoin.date, new Map());
      }
      const dateMap = sitesByDate.get(besoin.date)!;
      if (!dateMap.has(besoin.site_id)) {
        dateMap.set(besoin.site_id, []);
      }
      dateMap.get(besoin.site_id)!.push(besoin);
    }
    
    // Check each closing site
    for (const site of weekData.sites.filter((s: any) => s.fermeture)) {
      for (const checkDate of sortedDates) {
        const d = new Date(checkDate);
        const dayOfWeek = d.getDay();
        
        // Check if Thursday (4)
        if (dayOfWeek === 4) {
          const friday = new Date(d);
          friday.setDate(friday.getDate() + 1);
          const fridayStr = friday.toISOString().split('T')[0];
          
          // Check if Paul Jacquier works both days
          const thursdayBesoins = sitesByDate.get(checkDate)?.get(site.id) || [];
          const fridayBesoins = sitesByDate.get(fridayStr)?.get(site.id) || [];
          
          const paulWorksThursday = thursdayBesoins.some((b: any) => b.medecin_id === PAUL_JACQUIER_ID);
          const paulWorksFriday = fridayBesoins.some((b: any) => b.medecin_id === PAUL_JACQUIER_ID);
          
          if (paulWorksThursday && paulWorksFriday) {
            if (!sitesNeeding3F.has(checkDate)) {
              sitesNeeding3F.set(checkDate, new Set());
            }
            sitesNeeding3F.get(checkDate)!.add(site.id);
            
            if (!sitesNeeding3F.has(fridayStr)) {
              sitesNeeding3F.set(fridayStr, new Set());
            }
            sitesNeeding3F.get(fridayStr)!.add(site.id);
            
            logger.info(`  🔍 Site ${site.nom} nécessite 3F: Paul Jacquier travaille jeudi ${checkDate} et vendredi ${fridayStr}`);
          }
        }
      }
    }
    
    const context = {
      week_assignments,
      today_assignments: new Map(),
      admin_counters: adminCounters,
      p2p3_counters: p2p3Counters,
      closing_1r_counters: new Map(
        Array.from(closing1RDays.entries()).map(([id, dates]) => [id, dates.size])
      ),
      closing_2f3f_counters: new Map(
        Array.from(closing2F3FDays.entries()).map(([id, dates]) => [id, dates.size])
      ),
      sites_needing_3f: sitesNeeding3F,
      penalty_multipliers_1r2f: penaltyMultipliers1R2F,
      penalty_multipliers_esplanade: penaltyMultipliersEsplanade
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
    
    // ✅ VÉRIFICATION: Solution infaisable
    if (solution.feasible === false) {
      logger.error(`\n❌ Solution INFAISABLE pour ${date}`);
      logger.error(`   Raison probable: Pas assez de secrétaires disponibles pour respecter les contraintes de fermeture (minimum 2 secrétaires requis)`);
      logger.error(`   Le système va continuer avec les combos partiels disponibles...`);
    }
    
    
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
        
        // Compter les jours uniques où la secrétaire a un rôle 1R ou 2F/3F
        if (assign.is_1r) {
          if (!closing1RDays.has(assign.secretaire_id)) {
            closing1RDays.set(assign.secretaire_id, new Set());
          }
          closing1RDays.get(assign.secretaire_id)!.add(date);
          
          const totalDays = closing1RDays.get(assign.secretaire_id)!.size;
          logger.debug(`  → 1R: ${assign.secretaire_id.slice(0, 8)}... jour ${date} → total ${totalDays} jour(s)`);
        }
        
        if (assign.is_2f || assign.is_3f) {
          if (!closing2F3FDays.has(assign.secretaire_id)) {
            closing2F3FDays.set(assign.secretaire_id, new Set());
          }
          closing2F3FDays.get(assign.secretaire_id)!.add(date);
          
          const totalDays = closing2F3FDays.get(assign.secretaire_id)!.size;
          logger.debug(`  → 2F/3F: ${assign.secretaire_id.slice(0, 8)}... jour ${date} → total ${totalDays} jour(s)`);
        }
      }
    }
    
    
    dailyResults.push({
      date,
      assigned: writeCount,
      score: solution.result
    });
  }
  
  // ============================================================
  // SYNTHÈSE FIN DE PASSE
  // ============================================================
  logger.info(`\n${'='.repeat(60)}`);
  logger.info(`📊 SYNTHÈSE PASSE ${passNumber} - Rôles de fermeture hebdo`);
  logger.info(`${'='.repeat(60)}`);
  
  const exceeding2F3F: Array<{ name: string, count: number }> = [];
  const exceeding3Total: Array<{ name: string, count1R: number, count2F3F: number, total: number }> = [];
  
  for (const sec of weekData.secretaires) {
    const count1R = closing1RDays.get(sec.id)?.size || 0;
    const count2F3F = closing2F3FDays.get(sec.id)?.size || 0;
    const total = count1R + count2F3F;
    
    if (count2F3F > 2) {
      exceeding2F3F.push({ name: `${sec.first_name} ${sec.name}`, count: count2F3F });
    }
    
    if (total > 3) {
      exceeding3Total.push({ 
        name: `${sec.first_name} ${sec.name}`, 
        count1R, 
        count2F3F, 
        total 
      });
    }
  }
  
  if (exceeding2F3F.length > 0) {
    exceeding2F3F.sort((a, b) => b.count - a.count);
    logger.info(`\n⚠️ Secrétaires avec >2 rôles 2F/3F cette semaine:`);
    for (const { name, count } of exceeding2F3F) {
      logger.info(`  ${name}: ${count} fois 2F/3F`);
    }
  } else {
    logger.info(`\n✅ Aucun secrétaire ne dépasse 2 rôles 2F/3F cette semaine`);
  }
  
  if (exceeding3Total.length > 0) {
    exceeding3Total.sort((a, b) => b.total - a.total);
    logger.info(`\n⚠️ Secrétaires avec >3 rôles de fermeture total (1R+2F+3F) cette semaine:`);
    for (const { name, count1R, count2F3F, total } of exceeding3Total) {
      logger.info(`  ${name}: 1R=${count1R}, 2F/3F=${count2F3F} → Total=${total}`);
    }
  } else {
    logger.info(`\n✅ Aucun secrétaire ne dépasse 3 rôles de fermeture total cette semaine`);
  }
  
  logger.info(`${'='.repeat(60)}\n`);
  
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
  supabase: any,
  previousWeeksHistory?: { closing1R2FHistory: Map<string, number>, esplanadeHistory: Map<string, number> }
): Promise<any> {
  const sortedDates = dates.sort();
  
  logger.info(`\n🚀 Optimisation de la semaine: ${sortedDates[0]} → ${sortedDates[sortedDates.length - 1]}`);
  
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
    1,
    undefined,
    previousWeeksHistory?.closing1R2FHistory,
    previousWeeksHistory?.esplanadeHistory
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
    pass1Results.weekAssignments,
    previousWeeksHistory?.closing1R2FHistory,
    previousWeeksHistory?.esplanadeHistory
  );
  
  logger.info('\n♻️ Rafraîchissement des vues matérialisées...');
  await supabase.rpc('refresh_besoins_view');
  
  return {
    success: true,
    pass1_summary: pass1Results.summary,
    pass2_summary: pass2Results.summary,
    message: `✅ Optimisation en 2 passes terminée pour ${sortedDates.length} jours (avec assignation 1R/2F/3F intégrée)`
  };
}

// ============================================================
// OPTIMISATION GLOBALE HEBDOMADAIRE (NOUVEAU)
// ============================================================
async function optimizeSingleWeekGlobal(
  dates: string[],
  supabase: any,
  previousWeeksHistory?: {
    closing1R2FHistory: Map<string, number>;
    esplanadeHistory: Map<string, number>;
  }
): Promise<any> {
  const sortedDates = dates.sort();
  logger.info(`\n${'='.repeat(80)}`);
  logger.info(`🚀 OPTIMISATION GLOBALE HEBDOMADAIRE: ${sortedDates[0]} → ${sortedDates[sortedDates.length - 1]}`);
  logger.info(`${'='.repeat(80)}\n`);
  
  // 1. Charger données semaine
  const weekData = await loadWeekData(sortedDates, supabase);
  
  // 2. Préparer contexte global
  const weekContext = prepareWeekContext(sortedDates, weekData);
  
  // 3. Construire modèle MILP global
  logger.info(`\n🔨 Construction du modèle MILP global...`);
  const model = buildWeeklyMILPModel(
    weekContext,
    weekData,
    {
      closing1R2F: previousWeeksHistory?.closing1R2FHistory || new Map(),
      esplanade: previousWeeksHistory?.esplanadeHistory || new Map()
    }
  );
  
  logger.info(`  ✅ Modèle construit`);
  logger.info(`  📊 Variables: ${Object.keys(model.variables).length}`);
  logger.info(`  📊 Binaires: ${Object.keys(model.binaries || {}).length}`);
  logger.info(`  📊 Contraintes: ${Object.keys(model.constraints).length}`);
  
  // 4. Résoudre
  logger.info(`\n⚡ Résolution MILP...`);
  const startTime = Date.now();
  const solution = solver.Solve(model);
  const endTime = Date.now();
  
  const executionTime = ((endTime - startTime) / 1000).toFixed(2);
  logger.info(`  ✅ Résolu en ${executionTime}s`);
  logger.info(`  📊 Score total: ${solution.result || 0}`);
  logger.info(`  📊 Feasible: ${solution.feasible !== false ? 'Oui' : 'Non'}`);
  
  if (solution.feasible === false) {
    logger.error(`  ❌ Solution infaisable!`);
    return {
      success: false,
      dates: sortedDates,
      error: 'Solution infaisable',
      executionTime
    };
  }
  
  // 5. Écrire résultats
  logger.info(`\n💾 Écriture des résultats...`);
  const assignmentCount = await writeWeeklyAssignments(
    solution,
    weekContext,
    weekData,
    supabase
  );
  
  // 6. Refresh materialized views
  logger.info(`\n♻️ Rafraîchissement des vues matérialisées...`);
  try {
    const { error: refreshError } = await supabase.rpc('refresh_all_besoins_summaries');
    if (refreshError) {
      logger.error(`  ⚠️ Erreur refresh: ${refreshError.message}`);
    } else {
      logger.info(`  ✅ Vues rafraîchies`);
    }
  } catch (e) {
    logger.error(`  ⚠️ Erreur refresh: ${e}`);
  }
  
  logger.info(`\n${'='.repeat(80)}`);
  logger.info(`✅ OPTIMISATION GLOBALE TERMINÉE`);
  logger.info(`  📅 Dates: ${sortedDates.join(', ')}`);
  logger.info(`  ✅ ${assignmentCount} assignations`);
  logger.info(`  ⏱️ ${executionTime}s`);
  logger.info(`  📊 Score: ${solution.result || 0}`);
  logger.info(`${'='.repeat(80)}\n`);
  
  return {
    success: true,
    dates: sortedDates,
    assignments: assignmentCount,
    score: solution.result || 0,
    executionTime,
    feasible: solution.feasible !== false
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { dates, logLevel, focus, useWeeklyOptimization } = await req.json();
    
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
    
    const allResults: any[] = [];
    
    for (const [weekStart, weekDates] of weekGroups.entries()) {
      logger.info(`\n🗓️ Optimisation de la semaine du ${weekStart} (${weekDates.length} jours)`);
      
      // 🆕 Charger l'historique des 2 semaines précédentes
      const previousWeeksHistory = await loadPreviousWeeksHistory(weekStart, supabase);
      
      let weekResults;
      
        const useGlobalWeekly = useWeeklyOptimization && weekDates.length <= 5;
        if (useGlobalWeekly) {
          // 🆕 Nouvelle optimisation globale hebdomadaire (semaine limitée pour éviter le dépassement CPU)
          logger.info(`\n🎯 Utilisation de l'optimisation GLOBALE HEBDOMADAIRE (jours=${weekDates.length})`);
          weekResults = await optimizeSingleWeekGlobal(
            weekDates,
            supabase,
            previousWeeksHistory
          );
        } else {
          if (useWeeklyOptimization && !useGlobalWeekly) {
            logger.info(`\n⚠️ Semaine trop chargée (${weekDates.length} jours), bascule sur l'algorithme JOUR PAR JOUR (2 passes) pour respecter les limites CPU`);
          }
          // Ancien algorithme jour par jour
          logger.info(`\n📅 Utilisation de l'algorithme JOUR PAR JOUR (2 passes)`);
          weekResults = await optimizeSingleWeek(
            weekDates,
            supabase,
            previousWeeksHistory
          );
      }
      
      allResults.push(weekResults);
    }
    
    return new Response(
      JSON.stringify({
        success: true,
        message: `Optimisation terminée pour ${dates.length} dates`,
        results: allResults
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
