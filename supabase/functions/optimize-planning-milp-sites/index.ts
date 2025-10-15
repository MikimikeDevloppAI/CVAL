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

    const { single_day, week_start, week_end, exclude_bloc_assigned, selected_dates } = await req.json().catch(() => ({}));
    
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
      return await optimizeWeek(supabaseServiceRole, week_start, week_end, exclude_bloc_assigned, selected_dates);
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
async function optimizeWeek(supabase: any, weekStart: string, weekEnd: string, exclude_bloc_assigned: boolean = false, selected_dates?: string[]) {
  let dates = getDatesInRange(weekStart, weekEnd);
  // If selected_dates provided, only process those
  if (selected_dates && selected_dates.length > 0) {
    dates = selected_dates;
  }
  return await optimizeMultipleDays(supabase, dates, exclude_bloc_assigned, weekStart, weekEnd, selected_dates);
}

// Main optimization function (works for 1 day or multiple days)
async function optimizeMultipleDays(supabase: any, dates: string[], exclude_bloc_assigned: boolean = false, week_start?: string, week_end?: string, selected_dates?: string[]) {
  console.log(`\n🗓️ Optimizing ${dates.length} day(s): ${dates.join(', ')}`);
  
  const weekStartStr = week_start || dates[0];
  const weekEndStr = week_end || dates[dates.length - 1];
  
  // 1. Fetch all data
  const [secretaires, sites, besoins, capacites, blocPersonnel] = await Promise.all([
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
      .then((r: any) => r.data || [])
  ]);

  console.log(`✓ ${secretaires.length} secretaires, ${sites.length} sites, ${besoins.length} besoins`);

  // 2. Create or get planning
  const weekStart = dates[0];
  const weekEnd = dates[dates.length - 1];
  
  let planning_id;
  const { data: existingPlanning } = await supabase
    .from('planning')
    .select('*')
    .eq('date_debut', weekStart)
    .eq('date_fin', weekEnd)
    .maybeSingle();

  if (existingPlanning) {
    planning_id = existingPlanning.id;
  } else {
    const { data: newPlanning } = await supabase
      .from('planning')
      .insert({ date_debut: weekStart, date_fin: weekEnd, statut: 'en_cours' })
      .select()
      .single();
    planning_id = newPlanning.id;
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
  const solution = await buildMILP(besoins, secretaires, capacites, blocAssignments, sites, dates, flexibleSecs, supabase, weekStartStr, weekEndStr, selected_dates);

  if (!solution.feasible) {
    console.error('❌ MILP not feasible!');
    return new Response(JSON.stringify({ success: false, error: 'No feasible solution' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  console.log(`✅ MILP solved: objective = ${solution.result}`);

  // 6. Apply solution - INSERT directly into planning_genere_personnel
  await applySolution(supabase, besoins, sites, solution, planning_id, dates);

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

// Build MILP - aggregate besoins by site/demi-journée
async function buildMILP(
  besoins: any[],
  secretaires: any[],
  capacites: any[],
  blocAssignments: Map<string, Set<string>>,
  sites: any[],
  dates: string[],
  flexibleSecs: Map<string, number>,
  supabase: any,
  weekStartStr: string,
  weekEndStr: string,
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
        
        // Check site compatibility
        const isSiteInProfile = (sec.sites_assignes || []).includes(site_id);
        if (!isSiteInProfile) continue;

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
        let score = 100; // Base: fill a need

        // PRIORITY 1: Linked medecin (+10000)
        const medecinIdsArray = Array.from(medecin_ids);
        if (sec.medecin_assigne_id && medecinIdsArray.includes(sec.medecin_assigne_id)) {
          score += 10000;
        }

        // PRIORITY 2: Site preference
        if (sec.site_preferentiel_id === site_id) {
          score += 50;
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

  // === 1B. ADMIN ASSIGNMENT VARIABLES ===
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

  // === 6. FLEXIBLE SECRETARIES: FORCE FULL DAYS ONLY ===
  console.log('  📅 Adding flexible full-day constraints...');
  
  if (dates.length > 1) {
    // Calculate days already worked for flexible secretaries (excluding selected_dates)
    const daysAlreadyWorked = new Map<string, number>();
    
    for (const [flexSecId] of flexibleSecs) {
      const { data: existingAssignments } = await supabase
        .from('planning_genere_personnel')
        .select('date, periode')
        .eq('secretaire_id', flexSecId)
        .gte('date', weekStartStr)
        .lte('date', weekEndStr)
        .in('type_assignation', ['site', 'bloc']);

      const periodsByDate = new Map<string, Set<string>>();
      
      for (const a of existingAssignments || []) {
        // Skip dates being re-optimized
        if (selected_dates && selected_dates.includes(a.date)) continue;
        
        if (!periodsByDate.has(a.date)) periodsByDate.set(a.date, new Set());
        periodsByDate.get(a.date)!.add(a.periode);
      }

      // Count only FULL days
      const fullDays = new Set<string>();
      for (const [date, periods] of periodsByDate) {
        if (periods.has('matin') && periods.has('apres_midi')) {
          fullDays.add(date);
        }
      }

      daysAlreadyWorked.set(flexSecId, fullDays.size);
    }
    
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


      // 3. Limit total number of days to requiredDays
      const maxDaysConstraint = `max_days_${flexSecId}`;
      model.constraints[maxDaysConstraint] = { max: requiredDays };
      
      for (const date of dates) {
        const dayVar = `d_${flexSecId}_${date}`;
        if (model.variables[dayVar]) {
          model.variables[dayVar][maxDaysConstraint] = 1;
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
async function applySolution(supabase: any, besoins: any[], sites: any[], solution: any, planning_id: string, dates: string[]) {
  console.log('\n💾 Applying solution...');
  
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
