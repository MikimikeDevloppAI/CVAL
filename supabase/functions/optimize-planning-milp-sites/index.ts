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

    const { single_day, week_start, week_end } = await req.json().catch(() => ({}));
    
    const isWeekMode = !single_day && week_start && week_end;
    
    if (!isWeekMode && !single_day) {
      throw new Error('Either single_day OR (week_start AND week_end) must be provided');
    }

    if (isWeekMode) {
      console.log(`📅 Week mode: Optimizing ${week_start} to ${week_end}`);
      return await optimizeWeek(supabaseServiceRole, week_start, week_end);
    } else {
      console.log(`📅 Day mode: Optimizing ${single_day}`);
      return await optimizeDay(supabaseServiceRole, single_day);
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
async function optimizeDay(supabase: any, date: string) {
  const dates = [date];
  return await optimizeMultipleDays(supabase, dates);
}

// Week optimization  
async function optimizeWeek(supabase: any, weekStart: string, weekEnd: string) {
  const dates = getDatesInRange(weekStart, weekEnd);
  return await optimizeMultipleDays(supabase, dates);
}

// Main optimization function (works for 1 day or multiple days)
async function optimizeMultipleDays(supabase: any, dates: string[]) {
  console.log(`\n🗓️ Optimizing ${dates.length} day(s): ${dates.join(', ')}`);
  
  // 1. Fetch all data
  const [secretaires, sites, besoins, capacites, blocOps] = await Promise.all([
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
    supabase.from('planning_genere_bloc_operatoire').select(`*, planning_genere_personnel!planning_genere_personnel_planning_genere_bloc_operatoire_id_fkey(*)`)
      .in('date', dates)
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
  const blocAssignments = extractBlocAssignments(blocOps, dates);

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
  const solution = buildMILP(besoins, secretaires, capacites, blocAssignments, sites, dates, flexibleSecs);

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
function extractBlocAssignments(blocOps: any[], dates: string[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  
  for (const date of dates) {
    for (const periode of ['matin', 'apres_midi']) {
      map.set(`${date}_${periode}`, new Set());
    }
  }
  
  for (const op of blocOps) {
    const key = `${op.date}_${op.periode}`;
    const set = map.get(key) || new Set();
    
    for (const personnel of op.planning_genere_personnel || []) {
      if (personnel.secretaire_id && personnel.type_assignation === 'bloc') {
        set.add(personnel.secretaire_id);
      }
    }
    
    map.set(key, set);
  }
  
  return map;
}

// Build MILP - works directly with besoin_effectif
function buildMILP(
  besoins: any[],
  secretaires: any[],
  capacites: any[],
  blocAssignments: Map<string, Set<string>>,
  sites: any[],
  dates: string[],
  flexibleSecs: Map<string, number>
): any {
  console.log('\n🔍 Building MILP from besoin_effectif...');
  
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

  // === 1. ASSIGNMENT VARIABLES - One per besoin * required count ===
  console.log('  📝 Creating assignment variables from besoins...');
  
  for (const besoin of besoins) {
    const date = besoin.date;
    const periode = besoin.demi_journee;
    const site_id = besoin.site_id;
    const nombreRequis = Math.ceil(besoin.medecins?.besoin_secretaires || 1.2);
    const blocKey = `${date}_${periode}`;
    const blocSecs = blocAssignments.get(blocKey) || new Set();

    // Create EXACTLY nombreRequis assignment slots for this besoin
    for (let ordre = 1; ordre <= nombreRequis; ordre++) {
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

        // Create variable for this specific besoin + ordre
        const varName = `x_${sec.id}_${besoin.id}_${ordre}`;
        let score = 100; // Base: fill a need

        // PRIORITY 1: Linked medecin (+10000)
        if (besoin.medecin_id === sec.medecin_assigne_id) {
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
          [`besoin_${besoin.id}_${ordre}`]: 1,  // Each besoin/ordre slot gets exactly 1 sec
          [`cap_${sec.id}_${date}_${periode}`]: 1
        };
        model.ints[varName] = 1;
      }
      
      // Unsatisfied variable for this besoin/ordre slot
      const uVar = `u_${besoin.id}_${ordre}`;
      model.variables[uVar] = { score: -1000, [`besoin_${besoin.id}_${ordre}`]: 1 };
      model.ints[uVar] = 1;
    }
  }

  console.log(`  ✅ ${Object.keys(model.variables).length} assignment variables`);

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
        
        // Decreasing bonus (penalize repeated admin assignments)
        if (!adminAssignments.has(sec.id)) {
          adminAssignments.set(sec.id, []);
        }
        const currentCount = adminAssignments.get(sec.id)!.length;
        score -= currentCount * 5; // -5 per previous admin assignment
        
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

  // === 2. CONSTRAINTS ===
  
  // 2.1 Each besoin/ordre gets exactly 1 secretary (or unsatisfied)
  for (const besoin of besoins) {
    const nombreRequis = Math.ceil(besoin.medecins?.besoin_secretaires || 1.2);
    for (let ordre = 1; ordre <= nombreRequis; ordre++) {
      model.constraints[`besoin_${besoin.id}_${ordre}`] = { equal: 1 };
    }
  }

  // 2.2 Each secretary max 1 assignment per date/period
  for (const sec of secretaires) {
    for (const date of dates) {
      for (const periode of ['matin', 'apres_midi']) {
        model.constraints[`cap_${sec.id}_${date}_${periode}`] = { max: 1 };
      }
    }
  }

  // === 3. SITE CHANGE PENALTY ===
  console.log('  🔄 Adding site change penalties...');
  let changeCount = 0;
  
  for (const sec of secretaires) {
    for (const date of dates) {
      const matinBySite = new Map<string, string[]>();
      const pmBySite = new Map<string, string[]>();

      for (const varName of Object.keys(model.variables)) {
        if (!varName.startsWith(`x_${sec.id}_`)) continue;
        
        const parts = varName.split('_');
        const besoinId = parts[2];
        const besoin = besoins.find((b: any) => b.id === besoinId);
        if (!besoin || besoin.date !== date) continue;

        if (besoin.demi_journee === 'matin') {
          if (!matinBySite.has(besoin.site_id)) matinBySite.set(besoin.site_id, []);
          matinBySite.get(besoin.site_id)!.push(varName);
        } else {
          if (!pmBySite.has(besoin.site_id)) pmBySite.set(besoin.site_id, []);
          pmBySite.get(besoin.site_id)!.push(varName);
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

  // === 4. SITE CLOSURE CONTINUITY (min 2 full days) ===
  console.log('  🔒 Adding closure site continuity...');
  
  for (const date of dates) {
    const closureBesoins = besoins.filter((b: any) => {
      const site = sitesMap.get(b.site_id);
      return b.date === date && site?.fermeture;
    });
    const closureSiteIds = [...new Set(closureBesoins.map((b: any) => b.site_id))];

    for (const site_id of closureSiteIds) {
      const site = sitesMap.get(site_id);
      if (!site) continue;

      // Create continuity variables per secretary
      for (const sec of secretaires) {
        const matinVars = [];
        const pmVars = [];

        for (const varName of Object.keys(model.variables)) {
          if (!varName.startsWith(`x_${sec.id}_`)) continue;
          
          const parts = varName.split('_');
          const besoinId = parts[2];
          const besoin = besoins.find((b: any) => b.id === besoinId);
          if (!besoin || besoin.date !== date || besoin.site_id !== site_id) continue;

          if (besoin.demi_journee === 'matin') matinVars.push(varName);
          else pmVars.push(varName);
        }

        if (matinVars.length === 0 || pmVars.length === 0) continue;

        // Continuity variable: bonus if works both periods
        const contVar = `cont_${site_id.substring(0,8)}_${sec.id}_${date}`;
        model.variables[contVar] = { score: 200 };
        model.ints[contVar] = 1;

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

        // Track for minimum
        model.variables[contVar][`min_cont_${site_id}_${date}`] = 1;
      }

      // Min 2 continuities
      model.constraints[`min_cont_${site_id}_${date}`] = { min: 2 };
    }
  }

  // === 5. FLEXIBLE SECRETARIES: EXACTLY N FULL DAYS (sites + admin) ===
  console.log('  📅 Adding flexible constraints...');
  
  // ⚠️ ONLY apply this constraint in WEEK mode (multiple days)
  if (dates.length > 1) {
    for (const [flexSecId, requiredDays] of flexibleSecs) {
      const sec = secretaires.find((s: any) => s.id === flexSecId);
      if (!sec) continue;

      const maxPeriods = requiredDays * 2; // 2 periods per day
      console.log(`    🧮 ${sec.first_name} ${sec.name}: ${requiredDays} full days (max ${maxPeriods} periods)`);

      const constraintKey = `max_periods_${flexSecId}`;
      model.constraints[constraintKey] = { max: maxPeriods };
      
      // Add all SITE assignment variables
      for (const varName of Object.keys(model.variables)) {
        if (varName.startsWith(`x_${flexSecId}_`)) {
          model.variables[varName][constraintKey] = 1;
        }
      }
      
      // Add all ADMIN assignment variables
      for (const varName of Object.keys(model.variables)) {
        if (varName.startsWith(`admin_${flexSecId}_`)) {
          model.variables[varName][constraintKey] = 1;
        }
      }
    }
  } else {
    console.log('    ⏭️  Skipping flexible constraints (single day mode)');
  }

  console.log(`  📊 Variables: ${Object.keys(model.variables).length}, Constraints: ${Object.keys(model.constraints).length}`);
  
  const solution = solver.Solve(model);
  console.log(`  ✅ Solution: feasible=${solution.feasible}, score=${solution.result}`);
  
  return solution;
}

// Apply solution - INSERT directly into planning_genere_personnel
async function applySolution(supabase: any, besoins: any[], sites: any[], solution: any, planning_id: string, dates: string[]) {
  console.log('\n💾 Applying solution...');
  
  // 1. Apply site assignments - INSERT into planning_genere_personnel
  for (const [varName, value] of Object.entries(solution)) {
    if (!varName.startsWith('x_') || (value as number) < 0.5) continue;

    const parts = varName.split('_');
    const secId = parts[1];
    const besoinId = parts[2];
    const ordre = parseInt(parts[3]);

    const besoin = besoins.find((b: any) => b.id === besoinId);
    if (!besoin) continue;

    await supabase
      .from('planning_genere_personnel')
      .insert({
        planning_id,
        date: besoin.date,
        periode: besoin.demi_journee,
        secretaire_id: secId,
        site_id: besoin.site_id,
        type_assignation: 'site',
        ordre
      });
  }

  console.log('  ✅ Site assignments applied');
  
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
