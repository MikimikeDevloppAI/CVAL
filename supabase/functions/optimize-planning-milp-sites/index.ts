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
  const [secretaires, sites, medecins, besoins, capacites, blocOps] = await Promise.all([
    supabase.from('secretaires').select('*').eq('actif', true).then((r: any) => r.data || []),
    supabase.from('sites').select('*').eq('actif', true).then((r: any) => r.data || []),
    supabase.from('medecins').select('*').eq('actif', true).then((r: any) => r.data || []),
    supabase.from('besoin_effectif').select('*')
      .in('date', dates)
      .eq('actif', true)
      .eq('type', 'medecin')
      .then((r: any) => r.data || []),
    supabase.from('capacite_effective').select('*')
      .in('date', dates)
      .eq('actif', true)
      .then((r: any) => r.data || []),
    supabase.from('planning_genere_bloc_operatoire').select(`*, planning_genere_bloc_personnel(*)`)
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

  // 3. Generate besoins rows
  const allRows = await generateBesoinsRows(supabase, dates, sites, besoins, medecins, planning_id);
  console.log(`✓ ${allRows.length} personnel rows created`);

  // 4. Identify bloc assignments (by date+period)
  const blocAssignments = extractBlocAssignments(blocOps, dates);

  // 5. Identify flexible secretaries
  const flexibleSecs = new Map<string, number>();
  for (const sec of secretaires) {
    if (sec.horaire_flexible && sec.pourcentage_temps) {
      const requiredDays = Math.round((sec.pourcentage_temps / 100) * 5);
      flexibleSecs.set(sec.id, requiredDays);
      console.log(`  📊 Flexible: ${sec.first_name} ${sec.name} → ${requiredDays} full days`);
    }
  }

  // 6. Build and solve MILP
  const solution = buildMILP(allRows, secretaires, capacites, blocAssignments, sites, dates, flexibleSecs);

  if (!solution.feasible) {
    console.error('❌ MILP not feasible!');
    return new Response(JSON.stringify({ success: false, error: 'No feasible solution' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  console.log(`✅ MILP solved: objective = ${solution.result}`);

  // 7. Apply solution
  await applySolution(supabase, allRows, solution);

  return new Response(JSON.stringify({
    success: true,
    days: dates.length,
    rows: allRows.length
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// Generate besoin rows for all dates
async function generateBesoinsRows(
  supabase: any,
  dates: string[],
  sites: any[],
  besoins: any[],
  medecins: any[],
  planning_id: string
): Promise<any[]> {
  const medecinMap = new Map(medecins.map((m: any) => [m.id, m]));
  const allPersonnelRows = [];

  for (const date of dates) {
    const dayBesoins = besoins.filter((b: any) => b.date === date);
    
    for (const site of sites) {
      if (site.nom?.includes('Bloc opératoire')) continue;
      
      for (const periode of ['matin', 'apres_midi']) {
        // Find medecins working this site/period
        const medecinsThisPeriod = dayBesoins.filter((b: any) => {
          if (b.site_id !== site.id) return false;
          if (b.demi_journee === periode) return true;
          if (b.demi_journee === 'toute_journee') return true;
          return false;
        });

        if (medecinsThisPeriod.length === 0) continue;

        // Calculate total secretaries needed
        const totalBesoin = medecinsThisPeriod.reduce((sum: number, b: any) => {
          const medecin = medecinMap.get(b.medecin_id);
          return sum + (Number(medecin?.besoin_secretaires) || 1.2);
        }, 0);

        const nombreRequis = Math.ceil(totalBesoin);
        const medecinsIds = medecinsThisPeriod.map((b: any) => b.medecin_id);

        // Create besoin
        const { data: savedBesoin } = await supabase
          .from('planning_genere_site_besoin')
          .insert({
            planning_id,
            date,
            site_id: site.id,
            periode,
            medecins_ids: medecinsIds,
            nombre_secretaires_requis: nombreRequis
          })
          .select()
          .single();

        // Create personnel rows
        for (let ordre = 1; ordre <= nombreRequis; ordre++) {
          const { data: personnelRow } = await supabase
            .from('planning_genere_site_personnel')
            .insert({
              planning_genere_site_besoin_id: savedBesoin.id,
              secretaire_id: null,
              ordre
            })
            .select(`
              id,
              planning_genere_site_besoin_id,
              secretaire_id,
              ordre
            `)
            .single();

          allPersonnelRows.push({
            ...personnelRow,
            date,
            site_id: site.id,
            site_nom: site.nom,
            site_fermeture: site.fermeture,
            periode,
            medecins_ids: medecinsIds,
            besoin_id: savedBesoin.id
          });
        }
      }
    }
  }

  return allPersonnelRows;
}

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
    
    for (const personnel of op.planning_genere_bloc_personnel || []) {
      if (personnel.secretaire_id) {
        set.add(personnel.secretaire_id);
      }
    }
    
    map.set(key, set);
  }
  
  return map;
}

// Build simplified MILP
function buildMILP(
  rows: any[],
  secretaires: any[],
  capacites: any[],
  blocAssignments: Map<string, Set<string>>,
  sites: any[],
  dates: string[],
  flexibleSecs: Map<string, number>
): any {
  console.log('\n🔍 Building simplified MILP...');
  
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
    const periode = cap.demi_journee === 'toute_journee' ? ['matin', 'apres_midi'] : [cap.demi_journee];
    for (const p of periode) {
      capacitesMap.set(`${cap.date}_${secId}_${p}`, cap);
    }
  }

  const sitesMap = new Map(sites.map((s: any) => [s.id, s]));

  // === 1. ASSIGNMENT VARIABLES x_secId_rowId ===
  console.log('  📝 Creating assignment variables...');
  
  for (const row of rows) {
    const date = row.date;
    const periode = row.periode;
    const site_id = row.site_id;
    const medecinsIds = row.medecins_ids || [];
    const blocKey = `${date}_${periode}`;
    const blocSecs = blocAssignments.get(blocKey) || new Set();

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

      // Create variable
      const varName = `x_${sec.id}_${row.id}`;
      let score = 100; // Base: fill a need

      // PRIORITY 1: Linked medecin (+10000)
      if (medecinsIds.includes(sec.medecin_assigne_id)) {
        score += 10000;
      }

      // PRIORITY 2: Site preference
      if (sec.site_preferentiel_id === site_id) {
        score += 50;
      }

      // PENALTY: Port-en-Truie (unless preferred)
      if (site_id === SITE_PORT_EN_TRUIE && !sec.prefere_port_en_truie) {
        score -= PENALTY_PORT_EN_TRUIE;
        // Track for weekly penalty
        const petKey = `pet_${sec.id}`;
        model.variables[varName] = model.variables[varName] || {};
        model.variables[varName][petKey] = 1;
      }

      model.variables[varName] = {
        ...model.variables[varName],
        score,
        [`row_${row.id}`]: 1,
        [`cap_${sec.id}_${date}_${periode}`]: 1
      };
      model.ints[varName] = 1;
    }
  }

  console.log(`  ✅ ${Object.keys(model.variables).length} assignment variables`);

  // === 2. CONSTRAINTS ===
  
  // 2.1 Each row gets exactly 1 secretary
  for (const row of rows) {
    model.constraints[`row_${row.id}`] = { equal: 1 };
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
        
        const rowId = varName.split('_')[2];
        const row = rows.find((r: any) => r.id === rowId);
        if (!row || row.date !== date) continue;

        if (row.periode === 'matin') {
          if (!matinBySite.has(row.site_id)) matinBySite.set(row.site_id, []);
          matinBySite.get(row.site_id)!.push(varName);
        } else {
          if (!pmBySite.has(row.site_id)) pmBySite.set(row.site_id, []);
          pmBySite.get(row.site_id)!.push(varName);
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
    const closureSites = rows.filter((r: any) => r.date === date && r.site_fermeture);
    const closureSiteIds = [...new Set(closureSites.map((r: any) => r.site_id))];

    for (const site_id of closureSiteIds) {
      const site = sitesMap.get(site_id);
      if (!site) continue;

      // Create continuity variables per secretary
      for (const sec of secretaires) {
        const matinVars = [];
        const pmVars = [];

        for (const varName of Object.keys(model.variables)) {
          if (!varName.startsWith(`x_${sec.id}_`)) continue;
          
          const rowId = varName.split('_')[2];
          const row = rows.find((r: any) => r.id === rowId);
          if (!row || row.date !== date || row.site_id !== site_id) continue;

          if (row.periode === 'matin') matinVars.push(varName);
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

  // === 5. FLEXIBLE SECRETARIES: EXACTLY N FULL DAYS ===
  console.log('  📅 Adding flexible constraints...');
  
  // ⚠️ ONLY apply this constraint in WEEK mode (multiple days)
  if (dates.length > 1) {
    for (const [flexSecId, requiredDays] of flexibleSecs) {
      const sec = secretaires.find((s: any) => s.id === flexSecId);
      if (!sec) continue;

      console.log(`    🧮 ${sec.first_name} ${sec.name}: ${requiredDays} full days`);

      // Create day variables
      for (const date of dates) {
        const matinVars = [];
        const pmVars = [];

        for (const varName of Object.keys(model.variables)) {
          if (!varName.startsWith(`x_${flexSecId}_`)) continue;
          
          const rowId = varName.split('_')[2];
          const row = rows.find((r: any) => r.id === rowId);
          if (!row || row.date !== date) continue;

          if (row.periode === 'matin') matinVars.push(varName);
          else pmVars.push(varName);
        }

        // has_matin: 1 if works morning
        const hasMatinVar = `has_matin_${flexSecId}_${date}`;
        model.variables[hasMatinVar] = {};
        model.ints[hasMatinVar] = 1;

        if (matinVars.length > 0) {
          // sum(x_matin) >= has_matin
          const c1 = `link_${hasMatinVar}`;
          model.constraints[c1] = { min: 0 };
          model.variables[hasMatinVar][c1] = -1;
          for (const v of matinVars) model.variables[v][c1] = 1;

          // sum(x_matin) <= M * has_matin
          const c2 = `limit_${hasMatinVar}`;
          model.constraints[c2] = { max: 0 };
          model.variables[hasMatinVar][c2] = -matinVars.length;
          for (const v of matinVars) model.variables[v][c2] = 1;
        }

        // has_pm: 1 if works afternoon
        const hasPmVar = `has_pm_${flexSecId}_${date}`;
        model.variables[hasPmVar] = {};
        model.ints[hasPmVar] = 1;

        if (pmVars.length > 0) {
          const c1 = `link_${hasPmVar}`;
          model.constraints[c1] = { min: 0 };
          model.variables[hasPmVar][c1] = -1;
          for (const v of pmVars) model.variables[v][c1] = 1;

          const c2 = `limit_${hasPmVar}`;
          model.constraints[c2] = { max: 0 };
          model.variables[hasPmVar][c2] = -pmVars.length;
          for (const v of pmVars) model.variables[v][c2] = 1;
        }

        // fullday: 1 if both matin AND pm
        const fulldayVar = `fullday_${flexSecId}_${date}`;
        model.variables[fulldayVar] = {};
        model.ints[fulldayVar] = 1;

        // fullday <= has_matin
        const cf1 = `fd_matin_${flexSecId}_${date}`;
        model.constraints[cf1] = { max: 0 };
        model.variables[fulldayVar][cf1] = 1;
        model.variables[hasMatinVar][cf1] = -1;

        // fullday <= has_pm
        const cf2 = `fd_pm_${flexSecId}_${date}`;
        model.constraints[cf2] = { max: 0 };
        model.variables[fulldayVar][cf2] = 1;
        model.variables[hasPmVar][cf2] = -1;

        // fullday >= has_matin + has_pm - 1
        const cf3 = `fd_force_${flexSecId}_${date}`;
        model.constraints[cf3] = { min: 0 };
        model.variables[fulldayVar][cf3] = -1;
        model.variables[hasMatinVar][cf3] = 1;
        model.variables[hasPmVar][cf3] = 1;

        // Track for sum
        model.variables[fulldayVar][`total_days_${flexSecId}`] = 1;
      }

      // Main constraint: sum(fullday) = requiredDays
      model.constraints[`total_days_${flexSecId}`] = { equal: requiredDays };
    }
  } else {
    console.log('    ⏭️  Skipping flexible constraints (single day mode)');
  }

  console.log(`  📊 Variables: ${Object.keys(model.variables).length}, Constraints: ${Object.keys(model.constraints).length}`);
  
  const solution = solver.Solve(model);
  console.log(`  ✅ Solution: feasible=${solution.feasible}, score=${solution.result}`);
  
  return solution;
}

// Apply solution
async function applySolution(supabase: any, rows: any[], solution: any) {
  console.log('\n💾 Applying solution...');
  
  for (const [varName, value] of Object.entries(solution)) {
    if (!varName.startsWith('x_') || (value as number) < 0.5) continue;

    const parts = varName.split('_');
    const secId = parts[1];
    const rowId = parts[2];

    await supabase
      .from('planning_genere_site_personnel')
      .update({ secretaire_id: secId })
      .eq('id', rowId);
  }

  console.log('  ✅ All assignments applied');
}
