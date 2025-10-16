import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import solver from 'https://esm.sh/javascript-lp-solver@0.4.24';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const SITE_PORT_EN_TRUIE = '043899a1-a232-4c4b-9d7d-0eb44dad00ad';
const PENALTY_SITE_CHANGE = 50;
const PENALTY_PORT_EN_TRUIE = 20;

function isCliniqueLaValleeCompatible(siteName: string): boolean {
  return siteName.startsWith('Clinique La Vallée');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('🏢 Phase 2: Starting sites optimization');
    
    const supabaseServiceRole = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { single_day, week_start, week_end, exclude_bloc_assigned, selected_dates, planning_id } = await req.json().catch(() => ({}));
    
    const isWeekMode = !single_day && week_start && week_end;
    
    if (!isWeekMode && !single_day) {
      throw new Error('Either single_day OR (week_start AND week_end) must be provided');
    }

    if (isWeekMode) {
      if (selected_dates && selected_dates.length > 0) {
        console.log(`📅 Week mode (partial): Optimizing ${selected_dates.length} date(s):`, selected_dates);
      } else {
        console.log(`📅 Week mode: Optimizing ${week_start} to ${week_end}`);
      }
      return await optimizeWeek(supabaseServiceRole, week_start, week_end, exclude_bloc_assigned, selected_dates, planning_id);
    } else {
      console.log(`📅 Day mode: Optimizing ${single_day}`);
      return await optimizeDay(supabaseServiceRole, single_day, exclude_bloc_assigned);
    }

  } catch (error) {
    console.error('❌ Sites optimization error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

// Helper to get dates in range
function getDatesInRange(start: string, end: string): string[] {
  const dates = [];
  const current = new Date(start);
  const endDate = new Date(end);
  
  while (current <= endDate) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }
  
  return dates;
}

// Single day optimization
async function optimizeDay(supabase: any, date: string, exclude_bloc_assigned: boolean = false) {
  const dates = [date];
  return await optimizeMultipleDays(supabase, dates, exclude_bloc_assigned);
}

// Week optimization  
async function optimizeWeek(supabase: any, weekStart: string, weekEnd: string, exclude_bloc_assigned: boolean = false, selected_dates?: string[], planning_id?: string) {
  let dates = getDatesInRange(weekStart, weekEnd);
  // If selected_dates provided, only process those
  if (selected_dates && selected_dates.length > 0) {
    dates = selected_dates;
  }
  return await optimizeMultipleDays(supabase, dates, exclude_bloc_assigned, weekStart, weekEnd, selected_dates, planning_id);
}

// Main optimization function (works for 1 day or multiple days)
async function optimizeMultipleDays(supabase: any, dates: string[], exclude_bloc_assigned: boolean = false, week_start?: string, week_end?: string, selected_dates?: string[], provided_planning_id?: string) {
  console.log(`\n🗓️ Optimizing ${dates.length} day(s): ${dates.join(', ')}`);
  
  const weekStartStr = week_start || dates[0];
  const weekEndStr = week_end || dates[dates.length - 1];
  
  // 1. Fetch all data
  const [secretaires, sites, besoins, capacites, blocPersonnel, blocVacantPosts, secretairesSites, secretairesMedecins] = await Promise.all([
    supabase.from('secretaires').select('*').eq('actif', true).then((r: any) => r.data || []),
    supabase.from('sites').select('*').eq('actif', true).then((r: any) => r.data || []),
    supabase.from('besoin_effectif').select('*, medecins(first_name, name, besoin_secretaires)')
      .in('date', dates)
      .eq('actif', true)
      .eq('type', 'medecin')
      .then((r: any) => r.data || []),
    supabase.from('capacite_effective').select('*')
      .in('date', dates)
      .eq('actif', true)
      .then((r: any) => r.data || []),
    supabase.from('planning_genere_personnel')
      .select('secretaire_id, date, periode')
      .in('date', dates)
      .eq('type_assignation', 'bloc')
      .not('secretaire_id', 'is', null)
      .then((r: any) => r.data || []),
    supabase.from('planning_genere_personnel')
      .select('id, date, periode, type_besoin_bloc, ordre, planning_genere_bloc_operatoire_id')
      .in('date', dates)
      .eq('type_assignation', 'bloc')
      .is('secretaire_id', null)
      .then((r: any) => r.data || []),
    supabase.from('secretaires_sites')
      .select('secretaire_id, site_id, priorite')
      .then((r: any) => r.data || []),
    supabase.from('secretaires_medecins')
      .select('secretaire_id, medecin_id, priorite')
      .then((r: any) => r.data || [])
  ]);

  // Create priority map for quick lookup: `${secId}_${siteId}` -> priorite
  const secSitePriorityMap = new Map<string, string>();
  for (const ss of secretairesSites) {
    secSitePriorityMap.set(`${ss.secretaire_id}_${ss.site_id}`, ss.priorite);
  }

  // Create medecin priority map: `${secId}_${medecinId}` -> priorite
  const secMedecinPriorityMap = new Map<string, string>();
  for (const sm of secretairesMedecins) {
    secMedecinPriorityMap.set(`${sm.secretaire_id}_${sm.medecin_id}`, sm.priorite);
  }

  console.log(`✓ ${secretaires.length} secretaires, ${sites.length} sites, ${besoins.length} besoins, ${blocVacantPosts.length} bloc postes vacants`);

  // 2. Use provided planning_id or fallback to create/find one
  let planning_id = provided_planning_id;
  
  if (!planning_id) {
    // Fallback: normalize to ISO week and search/create
    const firstDate = new Date(dates[0] + 'T00:00:00Z');
    const dayOfWeek = firstDate.getUTCDay();
    const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const isoWeekStart = new Date(firstDate);
    isoWeekStart.setUTCDate(firstDate.getUTCDate() - daysFromMonday);
    const isoWeekEnd = new Date(isoWeekStart);
    isoWeekEnd.setUTCDate(isoWeekStart.getUTCDate() + 6);
    
    const weekStart = isoWeekStart.toISOString().split('T')[0];
    const weekEnd = isoWeekEnd.toISOString().split('T')[0];
    
    const { data: existingPlanning } = await supabase
      .from('planning')
      .select('*')
      .eq('date_debut', weekStart)
      .eq('date_fin', weekEnd)
      .maybeSingle();

    if (existingPlanning) {
      planning_id = existingPlanning.id;
      console.log(`📋 Found existing planning: ${planning_id}`);
    } else {
      const { data: newPlanning } = await supabase
        .from('planning')
        .insert({ date_debut: weekStart, date_fin: weekEnd, statut: 'en_cours' })
        .select()
        .single();
      planning_id = newPlanning.id;
      console.log(`📋 Created new planning: ${planning_id}`);
    }
  } else {
    console.log(`📋 Using provided planning_id: ${planning_id}`);
  }

  // 3. Identify bloc assignments (by date+period)
  const blocAssignments = extractBlocAssignments(blocPersonnel, dates);
  
  // Debug: log bloc assignments
  let totalBlocSecs = 0;
  for (const [key, secs] of blocAssignments) {
    totalBlocSecs += secs.size;
  }
  console.log(`  🔍 Total secrétaires au bloc cette semaine: ${totalBlocSecs}`);

  // 4. Identify flexible secretaries
  const flexibleSecs = new Map<string, number>();
  for (const sec of secretaires) {
    if (sec.horaire_flexible && sec.pourcentage_temps) {
      const requiredDays = Math.round((sec.pourcentage_temps / 100) * 5);
      flexibleSecs.set(sec.id, requiredDays);
      console.log(`  📊 Flexible: ${sec.first_name} ${sec.name} → ${requiredDays} full days`);
    }
  }

  // 5. Build and solve MILP
  const solution = await buildMILP(besoins, secretaires, capacites, blocAssignments, blocVacantPosts, sites, dates, flexibleSecs, supabase, weekStartStr, weekEndStr, secSitePriorityMap, secMedecinPriorityMap, selected_dates);

  if (!solution.feasible) {
    console.error('❌ MILP not feasible!');
    return new Response(JSON.stringify({ success: false, error: 'No feasible solution' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  console.log(`✅ MILP solved: objective = ${solution.result}`);

  // 6. Apply solution - INSERT directly into planning_genere_personnel
  if (!planning_id) {
    throw new Error('planning_id must be defined before applying solution');
  }
  await applySolution(supabase, besoins, sites, solution, planning_id, dates, secretaires, capacites, blocVacantPosts);

  return new Response(JSON.stringify({
    success: true,
    days: dates.length,
    besoins: besoins.length
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// This function is no longer needed - rows are now pre-generated by the orchestrator

// Extract bloc assignments: Map<date_period, Set<secretaire_id>>
function extractBlocAssignments(blocPersonnel: any[], dates: string[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  
  // Initialize empty sets for all date/period combinations
  for (const date of dates) {
    for (const periode of ['matin', 'apres_midi']) {
      map.set(`${date}_${periode}`, new Set());
    }
  }
  
  // Populate with actual bloc assignments
  for (const assignment of blocPersonnel) {
    const key = `${assignment.date}_${assignment.periode}`;
    const set = map.get(key) || new Set();
    set.add(assignment.secretaire_id);
    map.set(key, set);
  }
  
  console.log(`  📋 Bloc assignments extracted: ${blocPersonnel.length} personnel entries`);
  for (const [key, secs] of map) {
    if (secs.size > 0) {
      console.log(`    ${key}: ${secs.size} secrétaires au bloc`);
    }
  }
  
  return map;
}

// Check if secretary can perform a bloc role
function canPerformBlocRole(secretaire: any, type_besoin_bloc: string | null): boolean {
  if (!type_besoin_bloc) return false;
  
  switch (type_besoin_bloc) {
    case 'instrumentiste':
      return secretaire.instrumentaliste === true;
    case 'aide_salle':
      return secretaire.aide_de_salle === true;
    case 'instrumentiste_aide_salle':
      return secretaire.instrumentaliste === true || secretaire.aide_de_salle === true;
    case 'anesthesiste':
      return secretaire.anesthesiste === true;
    case 'accueil_dermato':
      return secretaire.bloc_dermato_accueil === true;
    case 'accueil_ophtalmo':
      return secretaire.bloc_ophtalmo_accueil === true;
    case 'accueil':
      return secretaire.bloc_dermato_accueil === true || secretaire.bloc_ophtalmo_accueil === true;
    default:
      return false;
  }
}

// Build MILP - aggregate besoins by site/demi-journée
async function buildMILP(
  besoins: any[],
  secretaires: any[],
  capacites: any[],
  blocAssignments: Map<string, Set<string>>,
  blocVacantPosts: any[],
  sites: any[],
  dates: string[],
  flexibleSecs: Map<string, number>,
  supabase: any,
  weekStartStr: string,
  weekEndStr: string,
  secSitePriorityMap: Map<string, string>,
  secMedecinPriorityMap: Map<string, string>,
  selected_dates?: string[]
): Promise<any> {
  console.log('\n🔍 Building MILP by aggregating site needs...');
  
  const model: any = {
    optimize: 'score',
    opType: 'max',
    constraints: {},
    variables: {},
    ints: {}
  };

  // Maps
  const capacitesMap = new Map();
  for (const cap of capacites) {
    const secId = cap.secretaire_id || cap.backup_id;
    const periodes = cap.demi_journee === 'toute_journee' ? ['matin', 'apres_midi'] : [cap.demi_journee];
    for (const p of periodes) {
      capacitesMap.set(`${cap.date}_${secId}_${p}`, cap);
    }
  }

  const sitesMap = new Map(sites.map((s: any) => [s.id, s]));

  // === FETCH ABSENCES FOR FLEXIBLE SECRETARIES ===
  console.log('  🚫 Fetching absences for flexible secretaries...');
  
  const flexSecIds = Array.from(flexibleSecs.keys());
  const absencesData = flexSecIds.length > 0 
    ? await supabase
        .from('absences')
        .select('*')
        .in('secretaire_id', flexSecIds)
        .in('statut', ['approuve', 'en_attente'])
        .or(`date_debut.lte.${dates[dates.length - 1]},date_fin.gte.${dates[0]}`)
        .then((r: any) => r.data || [])
    : [];
  
  // Build absence maps: full-day and partial-day (by period)
  const absencesFullDay = new Map<string, Set<string>>(); // secId -> Set<date>
  const absencesPartialMatin = new Map<string, Set<string>>();
  const absencesPartialApresMidi = new Map<string, Set<string>>();
  
  for (const abs of absencesData) {
    const secId = abs.secretaire_id;
    const isFullDay = !abs.heure_debut && !abs.heure_fin;
    
    // Generate all dates in absence range
    let currentDate = new Date(abs.date_debut + 'T00:00:00Z');
    const endDate = new Date(abs.date_fin + 'T00:00:00Z');
    
    while (currentDate <= endDate) {
      const dateStr = currentDate.toISOString().split('T')[0];
      
      if (dates.includes(dateStr)) {
        if (isFullDay) {
          if (!absencesFullDay.has(secId)) absencesFullDay.set(secId, new Set());
          absencesFullDay.get(secId)!.add(dateStr);
        } else {
          // Partial absence - determine period based on hours
          const startHour = parseInt(abs.heure_debut?.split(':')[0] || '0');
          const endHour = parseInt(abs.heure_fin?.split(':')[0] || '24');
          
          // Morning: 07:30-12:30 (7-12)
          if (startHour < 12) {
            if (!absencesPartialMatin.has(secId)) absencesPartialMatin.set(secId, new Set());
            absencesPartialMatin.get(secId)!.add(dateStr);
          }
          // Afternoon: 13:00-17:00 (13-17)
          if (endHour > 12) {
            if (!absencesPartialApresMidi.has(secId)) absencesPartialApresMidi.set(secId, new Set());
            absencesPartialApresMidi.get(secId)!.add(dateStr);
          }
        }
      }
      
      currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    }
  }
  
  console.log(`  ✅ Absences fetched: ${absencesData.length} records for ${flexSecIds.length} flexible secretaries`);
  for (const [secId, dates] of absencesFullDay) {
    const sec = secretaires.find(s => s.id === secId);
    console.log(`    - ${sec?.first_name} ${sec?.name}: ${dates.size} jours d'absence complète`);
  }

  // === CALCULATE FLEXIBLE SECRETARIES REMAINING DAYS (ALWAYS, even in single-day mode) ===
  console.log('  📅 Calculating flexible secretaries remaining days...');
  
  const flexibleRemaining = new Map<string, number>();
  const daysAlreadyWorked = new Map<string, number>();
  
  for (const [flexSecId, requiredDays] of flexibleSecs) {
    const sec = secretaires.find((s: any) => s.id === flexSecId);
    if (!sec) continue;

    // Calculate available days = total days in week minus full-day absences
    const totalDaysInWeek = dates.filter(d => {
      const dateObj = new Date(d + 'T00:00:00Z');
      return dateObj.getUTCDay() !== 6; // Exclude Saturdays
    }).length;
    
    const fullDayAbsences = absencesFullDay.get(flexSecId) || new Set();
    const availableDays = totalDaysInWeek - fullDayAbsences.size;
    
    // Query existing assignments excluding selected_dates
    const { data: existingAssignments } = await supabase
      .from('planning_genere_personnel')
      .select('date, periode')
      .eq('secretaire_id', flexSecId)
      .in('type_assignation', ['site', 'bloc', 'administratif'])
      .gte('date', weekStartStr)
      .lte('date', weekEndStr);

    const periodsByDate = new Map<string, Set<string>>();
    for (const assignment of existingAssignments || []) {
      // Skip dates being re-optimized
      if (selected_dates && selected_dates.includes(assignment.date)) {
        continue;
      }
      
      if (!periodsByDate.has(assignment.date)) {
        periodsByDate.set(assignment.date, new Set());
      }
      periodsByDate.get(assignment.date)!.add(assignment.periode);
    }

    // Count only FULL days (both matin + apres_midi) EXCLUDING Saturdays
    const fullDays = new Set<string>();
    for (const [date, periods] of periodsByDate.entries()) {
      if (periods.has('matin') && periods.has('apres_midi')) {
        // Check if it's a Saturday
        const dateObj = new Date(date + 'T00:00:00Z');
        const dayOfWeek = dateObj.getUTCDay(); // 0=Sunday, 6=Saturday
        
        // DO NOT count Saturdays in the quota
        if (dayOfWeek !== 6) {
          fullDays.add(date);
        }
      }
    }

    const alreadyWorked = fullDays.size;
    // Adjust required days based on available days
    const adjustedRequired = Math.min(requiredDays, availableDays);
    const remaining = Math.max(0, adjustedRequired - alreadyWorked);
    
    daysAlreadyWorked.set(flexSecId, alreadyWorked);
    flexibleRemaining.set(flexSecId, remaining);
    
    console.log(`    ${sec.first_name} ${sec.name}: requis ${requiredDays}, disponibles ${availableDays}, déjà ${alreadyWorked}, restants ${remaining}`);
  }

  // === 1. PRE-PROCESS: AGGREGATE BESOINS BY (date, site_id, periode) ===
  console.log('  📊 Aggregating besoins by site/periode...');
  
  const siteNeedsMap = new Map<string, {
    date: string;
    site_id: string;
    periode: string;
    total_need: number;
    medecin_ids: Set<string>;
  }>();
  
  for (const besoin of besoins) {
    const periodes = besoin.demi_journee === 'toute_journee' 
      ? ['matin', 'apres_midi'] 
      : [besoin.demi_journee];
    
    for (const periode of periodes) {
      const key = `${besoin.date}|${besoin.site_id}|${periode}`;
      
      if (!siteNeedsMap.has(key)) {
        siteNeedsMap.set(key, {
          date: besoin.date,
          site_id: besoin.site_id,
          periode,
          total_need: 0,
          medecin_ids: new Set()
        });
      }
      
      const entry = siteNeedsMap.get(key)!;
      entry.total_need += besoin.medecins?.besoin_secretaires || 1.2;
      if (besoin.medecin_id) {
        entry.medecin_ids.add(besoin.medecin_id);
      }
    }
  }
  
  const siteNeeds = Array.from(siteNeedsMap.values());
  const totalSlots = siteNeeds.reduce((sum, sn) => sum + Math.ceil(sn.total_need), 0);
  
  console.log(`  ✅ ${siteNeeds.length} site bins, ${totalSlots} total slots required`);

  // === 2. ASSIGNMENT VARIABLES BY SITE SLOT ===
  console.log('  📝 Creating assignment variables per site slot...');
  
  let varCount = 0;
  
  for (const siteNeed of siteNeeds) {
    const { date, site_id, periode, total_need, medecin_ids } = siteNeed;
    const slots = Math.ceil(total_need);
    const blocKey = `${date}_${periode}`;
    const blocSecs = blocAssignments.get(blocKey) || new Set();

    for (let ordre = 1; ordre <= slots; ordre++) {
      const constraintKey = `need|${date}|${site_id}|${periode}|${ordre}`;
      
      for (const sec of secretaires) {
        // Skip if at bloc this period
        if (blocSecs.has(sec.id)) continue;

        // Check capacity or flexible
        const isFlexible = flexibleSecs.has(sec.id);
        const hasCapacity = capacitesMap.has(`${date}_${sec.id}_${periode}`);
        
        if (!hasCapacity && !isFlexible) continue;
        
        // CRITICAL: Check absences for flexible secretaries ONLY
        if (isFlexible) {
          // Check full-day absence
          const fullDayAbs = absencesFullDay.get(sec.id);
          if (fullDayAbs && fullDayAbs.has(date)) {
            continue; // Skip this flexible secretary - full day absence
          }
          
          // Check partial absence for this period
          const partialAbs = periode === 'matin' 
            ? absencesPartialMatin.get(sec.id)
            : absencesPartialApresMidi.get(sec.id);
          if (partialAbs && partialAbs.has(date)) {
            continue; // Skip this flexible secretary - partial absence for this period
          }
        }
        
        // CRITICAL: Flexible secretaries can only be assigned on Saturday if they have explicit capacity
        if (isFlexible && !hasCapacity) {
          const dateObj = new Date(date + 'T00:00:00Z');
          const isSaturday = dateObj.getUTCDay() === 6;
          if (isSaturday) {
            continue; // Don't create variable for flexible on Saturday without capacity
          }
        }
        
        // CRITICAL: Skip flexible secretaries who have already met their weekly quota
        if (isFlexible) {
          const remaining = flexibleRemaining.get(sec.id) || 0;
          if (remaining <= 0) {
            continue; // Don't create any variable for this flexible (no days left)
          }
        }
        
        // Check site compatibility via new secretaires_sites table
        const prioriteKey = `${sec.id}_${site_id}`;
        const priorite = secSitePriorityMap.get(prioriteKey);
        
        // Skip if site not assigned to this secretary
        if (!priorite) continue;

        // Check geographic compatibility if at bloc other period
        const otherPeriode = periode === 'matin' ? 'apres_midi' : 'matin';
        const otherBlocKey = `${date}_${otherPeriode}`;
        const isAtBlocOther = (blocAssignments.get(otherBlocKey) || new Set()).has(sec.id);
        
        if (isAtBlocOther) {
          const site = sitesMap.get(site_id);
          if (!site || !isCliniqueLaValleeCompatible(site.nom)) continue;
        }

        // Create variable: x|secId|date|periode|siteId|ordre
        const varName = `x|${sec.id}|${date}|${periode}|${site_id}|${ordre}`;
        let score = 0;

        // PRIORITY 1: Linked medecin with priorities (+10000 prio 1, +5000 prio 2)
        const medecinIdsArray = Array.from(medecin_ids);
        let medecinBonus = 0;
        for (const medecinId of medecinIdsArray) {
          const medecinPrioriteKey = `${sec.id}_${medecinId}`;
          const medecinPriorite = secMedecinPriorityMap.get(medecinPrioriteKey);
          
          if (medecinPriorite === '1') {
            medecinBonus = Math.max(medecinBonus, 10000); // Médecin priorité 1
          } else if (medecinPriorite === '2') {
            medecinBonus = Math.max(medecinBonus, 5000); // Médecin priorité 2
          }
        }
        score += medecinBonus;

        // PRIORITY 2: Site priority level
        if (priorite === '1') {
          score += 500; // Priority 1 sites (P1)
        } else if (priorite === '2') {
          score += 250; // Priority 2 sites (P2)
        } else if (priorite === '3') {
          score += 100; // Priority 3 sites (P3)
        }

        // PENALTY: Port-en-Truie (unless preferred)
        if (site_id === SITE_PORT_EN_TRUIE && !sec.prefere_port_en_truie) {
          score -= PENALTY_PORT_EN_TRUIE;
        }

        model.variables[varName] = {
          score,
          [constraintKey]: 1,  // Each site slot gets exactly 1 sec
          [`cap_${sec.id}_${date}_${periode}`]: 1
        };
        model.ints[varName] = 1;
        varCount++;
      }
      
      // Unsatisfied variable for this site slot
      const uVar = `u|${date}|${site_id}|${periode}|${ordre}`;
      model.variables[uVar] = { score: -1000, [constraintKey]: 1 };
      model.ints[uVar] = 1;
      varCount++;
    }
  }

  console.log(`  ✅ ${varCount} site assignment variables created`);

  // === 1B. BLOC VACANT POST VARIABLES ===
  console.log('  🏥 Creating bloc vacant post assignment variables...');
  
  let blocVarCount = 0;
  
  for (const post of blocVacantPosts) {
    const { id: post_id, date, periode, type_besoin_bloc } = post;
    
    // Count eligible candidates for debugging
    let eligibleCount = 0;
    
    for (const sec of secretaires) {
      // Check if secretary has the required competence
      if (!canPerformBlocRole(sec, type_besoin_bloc)) continue;
      
      // Check if already at bloc this period (prevents double assignment)
      const blocKey = `${date}_${periode}`;
      const blocSecs = blocAssignments.get(blocKey) || new Set();
      if (blocSecs.has(sec.id)) continue;
      
      // For flexible secretaries, apply specific rules
      const isFlexible = flexibleSecs.has(sec.id);
      const hasCapacity = capacitesMap.has(`${date}_${sec.id}_${periode}`);
      
      if (isFlexible) {
        // Skip flexible on Saturday without capacity
        if (!hasCapacity) {
          const dateObj = new Date(date + 'T00:00:00Z');
          const isSaturday = dateObj.getUTCDay() === 6;
          if (isSaturday) continue;
        }
        
        // Skip flexible secretaries who have already met their weekly quota
        const remaining = flexibleRemaining.get(sec.id) || 0;
        if (remaining <= 0) continue;
      }
      
      // Create variable: bloc|secId|date|periode|post_id
      const varName = `bloc|${sec.id}|${date}|${periode}|${post_id}`;
      
      // HIGHEST SCORE: Bloc posts are top priority
      const score = 50000;
      
      model.variables[varName] = {
        score,
        [`bloc_post_${post_id}`]: 1,  // Each bloc post gets exactly 1 secretary
        [`cap_${sec.id}_${date}_${periode}`]: 1  // Consumes capacity (or creates it)
      };
      model.ints[varName] = 1;
      blocVarCount++;
      eligibleCount++;
    }
    
    // Constraint: each bloc post gets at most 1 secretary (can remain vacant)
    model.constraints[`bloc_post_${post_id}`] = { max: 1 };
    
    // Log for debugging
    console.log(`    - ${post.date} ${post.periode}: ${post.type_besoin_bloc} → ${eligibleCount} candidates`);
  }
  
  console.log(`  ✅ ${blocVarCount} bloc vacant post variables created`);

  // === 1C. ADMIN ASSIGNMENT VARIABLES ===
  console.log('  📋 Creating admin assignment variables...');
  
  const adminAssignments = new Map<string, string[]>(); // secId -> [varNames]
  
  for (const date of dates) {
    for (const periode of ['matin', 'apres_midi']) {
      const blocKey = `${date}_${periode}`;
      const blocSecs = blocAssignments.get(blocKey) || new Set();
      
      for (const sec of secretaires) {
        // Skip if at bloc
        if (blocSecs.has(sec.id)) continue;
        
        // Check capacity or flexible
        const isFlexible = flexibleSecs.has(sec.id);
        const hasCapacity = capacitesMap.has(`${date}_${sec.id}_${periode}`);
        
        if (!hasCapacity && !isFlexible) continue;
        
        // CRITICAL: Flexible secretaries can only be assigned on Saturday if they have explicit capacity
        if (isFlexible && !hasCapacity) {
          const dateObj = new Date(date + 'T00:00:00Z');
          const isSaturday = dateObj.getUTCDay() === 6;
          if (isSaturday) {
            continue; // Don't create admin variable for flexible on Saturday without capacity
          }
        }
        
        // CRITICAL: Skip flexible secretaries who have already met their weekly quota
        if (isFlexible) {
          const remaining = flexibleRemaining.get(sec.id) || 0;
          if (remaining <= 0) {
            continue; // Don't create admin variable for this flexible (no days left)
          }
        }
        
        // Create admin variable
        const adminVar = `admin_${sec.id}_${date}_${periode}`;
        
        // Base score (lower than site assignments to prioritize filling real needs)
        let score = 50;
        
        // Higher bonus if has assignation_administrative preference
        if (sec.assignation_administrative) {
          score += 30;
        }
        
        // Track admin vars for progressive balancing (constraints added below)
        if (!adminAssignments.has(sec.id)) {
          adminAssignments.set(sec.id, []);
        }
        
        model.variables[adminVar] = {
          score,
          [`cap_${sec.id}_${date}_${periode}`]: 1 // Consumes capacity
        };
        model.ints[adminVar] = 1;
        
        adminAssignments.get(sec.id)!.push(adminVar);
      }
    }
  }
  
  console.log(`  ✅ ${Array.from(adminAssignments.values()).flat().length} admin variables`);

  // === 3. CONSTRAINTS ===
  
  // 3.1 Each site slot gets exactly 1 secretary (or unsatisfied)
  for (const siteNeed of siteNeeds) {
    const { date, site_id, periode, total_need } = siteNeed;
    const slots = Math.ceil(total_need);
    for (let ordre = 1; ordre <= slots; ordre++) {
      model.constraints[`need|${date}|${site_id}|${periode}|${ordre}`] = { equal: 1 };
    }
  }

  // 3.2 Each secretary max 1 assignment per date/period
  for (const sec of secretaires) {
    for (const date of dates) {
      for (const periode of ['matin', 'apres_midi']) {
        model.constraints[`cap_${sec.id}_${date}_${periode}`] = { max: 1 };
      }
    }
  }

  // === 4. SITE CHANGE PENALTY ===
  console.log('  🔄 Adding site change penalties...');
  let changeCount = 0;
  
  for (const sec of secretaires) {
    for (const date of dates) {
      const matinBySite = new Map<string, string[]>();
      const pmBySite = new Map<string, string[]>();

      for (const varName of Object.keys(model.variables)) {
        if (!varName.startsWith(`x|${sec.id}|`)) continue;
        
        // Parse: x|secId|date|periode|siteId|ordre
        const parts = varName.split('|');
        if (parts.length < 6) continue;
        
        const vDate = parts[2];
        const vPeriode = parts[3];
        const vSiteId = parts[4];
        
        if (vDate !== date) continue;

        if (vPeriode === 'matin') {
          if (!matinBySite.has(vSiteId)) matinBySite.set(vSiteId, []);
          matinBySite.get(vSiteId)!.push(varName);
        } else if (vPeriode === 'apres_midi') {
          if (!pmBySite.has(vSiteId)) pmBySite.set(vSiteId, []);
          pmBySite.get(vSiteId)!.push(varName);
        }
      }

      // Penalty if different sites
      for (const [siteA, matinVars] of matinBySite) {
        for (const [siteB, pmVars] of pmBySite) {
          if (siteA === siteB) continue;

          const changeVar = `change_${sec.id}_${date}_${siteA.substring(0,8)}_${siteB.substring(0,8)}`;
          model.variables[changeVar] = { score: -PENALTY_SITE_CHANGE };
          model.ints[changeVar] = 1;

          const constraint = `detect_${changeVar}`;
          model.constraints[constraint] = { max: 1 };
          model.variables[changeVar][constraint] = -1;
          
          for (const mVar of matinVars) model.variables[mVar][constraint] = 1;
          for (const pVar of pmVars) model.variables[pVar][constraint] = 1;

          changeCount++;
        }
      }
    }
  }
  
  console.log(`    ✅ ${changeCount} change penalties`);

  // === 5. SITE CLOSURE CONTINUITY (soft bonus, highly valued) ===
  console.log('  🔒 Adding closure site continuity bonuses (soft)...');
  let continuityBonusCount = 0;
  
  // Get closure sites from siteNeeds
  const closureSiteIds = new Set<string>();
  for (const siteNeed of siteNeeds) {
    const site = sitesMap.get(siteNeed.site_id);
    if (site?.fermeture) {
      closureSiteIds.add(siteNeed.site_id);
    }
  }
  
  for (const date of dates) {
    for (const site_id of closureSiteIds) {
      const site = sitesMap.get(site_id);
      if (!site) continue;

      // Create continuity variables per secretary
      for (const sec of secretaires) {
        const matinVars = [];
        const pmVars = [];

        for (const varName of Object.keys(model.variables)) {
          if (!varName.startsWith(`x|${sec.id}|`)) continue;
          
          // Parse: x|secId|date|periode|siteId|ordre
          const parts = varName.split('|');
          if (parts.length < 6) continue;
          
          const vDate = parts[2];
          const vPeriode = parts[3];
          const vSiteId = parts[4];
          
          if (vDate !== date || vSiteId !== site_id) continue;

          if (vPeriode === 'matin') matinVars.push(varName);
          else if (vPeriode === 'apres_midi') pmVars.push(varName);
        }

        if (matinVars.length === 0 || pmVars.length === 0) continue;

        // Continuity variable: bonus if works both periods (high value to incentivize)
        const contVar = `cont_${site_id.substring(0,8)}_${sec.id}_${date}`;
        model.variables[contVar] = { score: 1000 };
        model.ints[contVar] = 1;
        continuityBonusCount++;

        // cont <= sum(matin)
        const c1 = `${contVar}_matin`;
        model.constraints[c1] = { max: 0 };
        model.variables[contVar][c1] = 1;
        for (const mVar of matinVars) model.variables[mVar][c1] = -1;

        // cont <= sum(pm)
        const c2 = `${contVar}_pm`;
        model.constraints[c2] = { max: 0 };
        model.variables[contVar][c2] = 1;
        for (const pVar of pmVars) model.variables[pVar][c2] = -1;
      }
    }
  }

  console.log(`    ✅ ${continuityBonusCount} continuity bonus variables (score +1000 each)`);

  // === 7. FLEXIBLE SECRETARIES: FORCE FULL DAYS ONLY (when optimizing multiple days) ===
  console.log('  📅 Adding flexible full-day constraints...');
  
  if (dates.length > 1) {
    for (const [flexSecId, requiredDays] of flexibleSecs) {
      const sec = secretaires.find((s: any) => s.id === flexSecId);
      if (!sec) continue;

      const alreadyWorked = daysAlreadyWorked.get(flexSecId) || 0;
      const remaining = Math.max(0, requiredDays - alreadyWorked);

      console.log(`    🧮 ${sec.first_name} ${sec.name}: ${requiredDays} jours total, déjà ${alreadyWorked} jours, reste ${remaining} jours`);

      // 1. Force full-day equality (accounting for bloc assignments)
      for (const date of dates) {
        const matinVars = [];
        const pmVars = [];

        // Collect all variables for this secretary on this date
        for (const varName of Object.keys(model.variables)) {
          // Site assignments: x|secId|date|periode|siteId|ordre
          if (varName.startsWith(`x|${flexSecId}|${date}|matin|`)) {
            matinVars.push(varName);
          } else if (varName.startsWith(`x|${flexSecId}|${date}|apres_midi|`)) {
            pmVars.push(varName);
          }
          
          // Admin assignments: admin_secId_date_periode
          if (varName === `admin_${flexSecId}_${date}_matin`) {
            matinVars.push(varName);
          } else if (varName === `admin_${flexSecId}_${date}_apres_midi`) {
            pmVars.push(varName);
          }
        }

        if (matinVars.length === 0 && pmVars.length === 0) continue;

        // Check bloc assignments for this date
        const blocMorning = (blocAssignments.get(`${date}_matin`) || new Set()).has(flexSecId) ? 1 : 0;
        const blocPm = (blocAssignments.get(`${date}_apres_midi`) || new Set()).has(flexSecId) ? 1 : 0;

        // Constraint: sum(matin_vars) - sum(pm_vars) = (blocPm - blocMorning)
        // This forces full days while accounting for pre-fixed bloc assignments
        const constraintKey = `fullday_${flexSecId}_${date}`;
        model.constraints[constraintKey] = { equal: blocPm - blocMorning };
        
        for (const mVar of matinVars) {
          model.variables[mVar][constraintKey] = 1;
        }
        for (const pVar of pmVars) {
          model.variables[pVar][constraintKey] = -1;
        }
      }

      // 2. Create day variables with compact activation (much fewer constraints)
      for (const date of dates) {
        const dayVar = `d_${flexSecId}_${date}`;
        model.variables[dayVar] = { score: 0 };
        model.ints[dayVar] = 1;

        // Check if at bloc this date
        const hasBloc = (blocAssignments.get(`${date}_matin`) || new Set()).has(flexSecId) ||
                        (blocAssignments.get(`${date}_apres_midi`) || new Set()).has(flexSecId);

        if (hasBloc) {
          // Force dayVar = 1 (bloc day always counts)
          const blocForce = `force_day_bloc_${flexSecId}_${date}`;
          model.constraints[blocForce] = { min: 1 };
          model.variables[dayVar][blocForce] = 1;
        } else {
          // Compact activation: sum(all assignments) - 10*dayVar <= 0
          // If any assignment > 0, then dayVar must be 1
          const actConstraint = `act_day_${flexSecId}_${date}`;
          model.constraints[actConstraint] = { max: 0 };
          model.variables[dayVar][actConstraint] = -10; // Big-M method
          
          for (const varName of Object.keys(model.variables)) {
            if (varName.startsWith(`x|${flexSecId}|${date}|`) || 
                varName.startsWith(`admin_${flexSecId}_${date}_`)) {
              model.variables[varName][actConstraint] = 1;
            }
          }
        }
      }


      // 3. Limit total number of days to requiredDays (EXCLUDING Saturdays)
      const maxDaysConstraint = `max_days_${flexSecId}`;
      model.constraints[maxDaysConstraint] = { max: requiredDays };
      
      for (const date of dates) {
        const dateObj = new Date(date + 'T00:00:00Z');
        const isSaturday = dateObj.getUTCDay() === 6;
        
        // Count only weekdays (Monday-Friday) in the quota
        if (!isSaturday) {
          const dayVar = `d_${flexSecId}_${date}`;
          if (model.variables[dayVar]) {
            model.variables[dayVar][maxDaysConstraint] = 1;
          }
        }
      }
    }
  } else {
    console.log('    ⏭️  Skipping flexible constraints (single day mode)');
  }

  // === 7. ADMIN BALANCE: PROGRESSIVE SOFT CONSTRAINTS ===
  console.log('  ⚖️ Adding progressive admin balance constraints...');
  
  let adminBalanceCount = 0;
  
  for (const [secId, adminVars] of adminAssignments) {
    if (adminVars.length <= 1) continue; // No need to balance if only 1 admin slot
    
    // For each secretary, create slack variables for exceeding thresholds
    
    // Threshold 1: More than 2 admin assignments (penalty -100)
    const slack1Var = `slack_admin_${secId}_t1`;
    model.variables[slack1Var] = { score: -100 }; // Penalty for exceeding 2
    model.ints[slack1Var] = 1;
    
    const constraint1Key = `admin_balance_${secId}_t1`;
    model.constraints[constraint1Key] = { min: -2 }; // sum(admin) - 2 <= slack1
    model.variables[slack1Var][constraint1Key] = -1;
    for (const adminVar of adminVars) {
      model.variables[adminVar][constraint1Key] = 1;
    }
    adminBalanceCount++;
    
    // Threshold 2: More than 4 admin assignments (stronger penalty -500)
    const slack2Var = `slack_admin_${secId}_t2`;
    model.variables[slack2Var] = { score: -500 }; // Strong penalty for exceeding 4
    model.ints[slack2Var] = 1;
    
    const constraint2Key = `admin_balance_${secId}_t2`;
    model.constraints[constraint2Key] = { min: -4 }; // sum(admin) - 4 <= slack2
    model.variables[slack2Var][constraint2Key] = -1;
    for (const adminVar of adminVars) {
      model.variables[adminVar][constraint2Key] = 1;
    }
    adminBalanceCount++;
  }
  
  console.log(`    ✅ ${adminBalanceCount} progressive admin balance constraints added`);

  console.log(`  📊 Variables: ${Object.keys(model.variables).length}, Constraints: ${Object.keys(model.constraints).length}`);
  
  const solution = solver.Solve(model);
  console.log(`  ✅ Solution: feasible=${solution.feasible}, score=${solution.result}`);
  
  // Validate flexible secretaries: verify number of days worked
  if (solution.feasible && flexibleSecs.size > 0) {
    console.log('\n  🔍 Validating flexible secretaries...');
    for (const [flexSecId, requiredDays] of flexibleSecs) {
      const sec = secretaires.find((s: any) => s.id === flexSecId);
      if (!sec) continue;

      let daysWorked = 0;
      for (const date of dates) {
        let worksThisDay = false;

        // Check bloc assignments
        const blocMorning = (blocAssignments.get(`${date}_matin`) || new Set()).has(flexSecId);
        const blocPm = (blocAssignments.get(`${date}_apres_midi`) || new Set()).has(flexSecId);
        if (blocMorning || blocPm) {
          worksThisDay = true;
        }

        // Check solution variables
        if (!worksThisDay) {
          for (const varName of Object.keys(solution)) {
            if (solution[varName] > 0.5) {
              if (varName.startsWith(`x|${flexSecId}|${date}|`) || 
                  varName.startsWith(`admin_${flexSecId}_${date}_`)) {
                worksThisDay = true;
                break;
              }
            }
          }
        }

        if (worksThisDay) daysWorked++;
      }

      const status = daysWorked === requiredDays ? '✅' : '⚠️';
      console.log(`    ${status} ${sec.first_name} ${sec.name}: ${daysWorked}/${requiredDays} jours`);
    }
  }
  
  return solution;
}

// Apply solution - INSERT directly into planning_genere_personnel
async function applySolution(supabase: any, besoins: any[], sites: any[], solution: any, planning_id: string, dates: string[], secretaires: any[], capacites: any[], blocVacantPosts: any[]) {
  console.log('\n💾 Applying solution...');
  
  // Build capacites lookup for safeguard
  const capacitesMap = new Map();
  for (const cap of capacites) {
    const secId = cap.secretaire_id || cap.backup_id;
    const periodes = cap.demi_journee === 'toute_journee' ? ['matin', 'apres_midi'] : [cap.demi_journee];
    for (const p of periodes) {
      capacitesMap.set(`${cap.date}_${secId}_${p}`, cap);
    }
  }
  
  // 0. Apply bloc vacant post assignments - UPDATE planning_genere_personnel
  console.log('  🏥 Applying bloc vacant post assignments...');
  let blocPostCount = 0;
  for (const [varName, value] of Object.entries(solution)) {
    if (!varName.startsWith('bloc|') || (value as number) < 0.5) continue;
    
    // Parse: bloc|secId|date|periode|post_id
    const parts = varName.split('|');
    if (parts.length < 5) continue;
    
    const secId = parts[1];
    const date = parts[2];
    const periode = parts[3];
    const postId = parts[4];
    
    // Safety check for flexible secretaries on Saturday
    const sec = secretaires.find((s: any) => s.id === secId);
    if (sec?.horaire_flexible) {
      const dateObj = new Date(date + 'T00:00:00Z');
      const isSaturday = dateObj.getUTCDay() === 6;
      if (isSaturday) {
        const hasCapacity = capacitesMap.has(`${date}_${secId}_${periode}`);
        if (!hasCapacity) {
          console.warn(`  ⚠️ Skipping bloc post for flexible secretary ${sec.first_name} ${sec.name} on Saturday without capacity`);
          continue;
        }
      }
    }
    
    // UPDATE the existing planning_genere_personnel row with secretaire_id
    const { error: updateError } = await supabase
      .from('planning_genere_personnel')
      .update({ secretaire_id: secId })
      .eq('id', postId);
    
    if (updateError) {
      console.error(`  ❌ Error updating bloc post ${postId}:`, updateError);
    } else {
      const post = blocVacantPosts.find((p: any) => p.id === postId);
      if (post) {
        console.log(`  ✅ Assigned ${sec?.first_name} ${sec?.name} to bloc ${post.type_besoin_bloc} on ${date} ${periode}`);
      }
      blocPostCount++;
    }
  }
  
  console.log(`  ✅ ${blocPostCount} bloc vacant posts filled`);
  
  // 1. Apply site assignments - INSERT into planning_genere_personnel
  let siteCount = 0;
  for (const [varName, value] of Object.entries(solution)) {
    if (!varName.startsWith('x|') || (value as number) < 0.5) continue;

    // Parse: x|secId|date|periode|siteId|ordre
    const parts = varName.split('|');
    if (parts.length < 6) continue;
    
    const secId = parts[1];
    const date = parts[2];
    const periode = parts[3];
    const siteId = parts[4];
    const ordre = parseInt(parts[5]);

    // Safety check: for flexible secretaries on Saturday, verify they have capacity
    const sec = secretaires.find((s: any) => s.id === secId);
    if (sec?.horaire_flexible) {
      const dateObj = new Date(date + 'T00:00:00Z');
      const isSaturday = dateObj.getUTCDay() === 6;
      if (isSaturday) {
        const hasCapacity = capacitesMap.has(`${date}_${secId}_${periode}`);
        if (!hasCapacity) {
          console.log(`  ⚠️  Skip Saturday fallback flexible (safeguard): ${sec.first_name} ${sec.name} has no capacity for ${date} ${periode}`);
          continue;
        }
      }
    }

    await supabase
      .from('planning_genere_personnel')
      .insert({
        planning_id,
        date,
        periode,
        secretaire_id: secId,
        site_id: siteId,
        type_assignation: 'site',
        ordre
      });
    
    siteCount++;
  }

  console.log(`  ✅ ${siteCount} site assignments applied`);
  
  // 2. Apply admin assignments - INSERT into planning_genere_personnel
  let adminCount = 0;
  for (const [varName, value] of Object.entries(solution)) {
    if (!varName.startsWith('admin_') || (value as number) < 0.5) continue;

    const parts = varName.split('_');
    const secId = parts[1];
    const date = parts[2];
    const periode = parts.slice(3).join('_'); // "apres_midi" ou "matin"

    // Safety check: for flexible secretaries on Saturday, verify they have capacity
    const sec = secretaires.find((s: any) => s.id === secId);
    if (sec?.horaire_flexible) {
      const dateObj = new Date(date + 'T00:00:00Z');
      const isSaturday = dateObj.getUTCDay() === 6;
      if (isSaturday) {
        const hasCapacity = capacitesMap.has(`${date}_${secId}_${periode}`);
        if (!hasCapacity) {
          console.log(`  ⚠️  Skip Saturday admin fallback flexible (safeguard): ${sec.first_name} ${sec.name} has no capacity for ${date} ${periode}`);
          continue;
        }
      }
    }

    // Get next ordre for admin assignments for this date/period
    const { data: existingAdmin } = await supabase
      .from('planning_genere_personnel')
      .select('ordre')
      .eq('date', date)
      .eq('periode', periode)
      .eq('type_assignation', 'administratif')
      .order('ordre', { ascending: false })
      .limit(1);
    
    const nextOrdre = (existingAdmin?.[0]?.ordre || 0) + 1;

    // Insert admin assignment
    await supabase
      .from('planning_genere_personnel')
      .insert({
        planning_id,
        date,
        periode,
        secretaire_id: secId,
        type_assignation: 'administratif',
        ordre: nextOrdre
      });
    
    adminCount++;
  }

  console.log(`  ✅ ${adminCount} admin assignments applied`);
}
