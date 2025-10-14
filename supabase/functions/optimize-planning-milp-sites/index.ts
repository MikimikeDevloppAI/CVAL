import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import solver from 'https://esm.sh/javascript-lp-solver@0.4.24';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const SITE_PORT_EN_TRUIE = '043899a1-a232-4c4b-9d7d-0eb44dad00ad';
const SITE_ADMIN_ID = '00000000-0000-0000-0000-000000000001';
const PENALTY_SITE_CHANGE = 500; // Priorité absolue pour éviter les changements de site
const PENALTY_PORT_EN_TRUIE_BASE = 0.0001;

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

    const { single_day, week_start, week_end, exclude_bloc_assigned = true } = await req.json().catch(() => ({}));
    
    // Detect mode: week or single day
    const isWeekMode = !single_day && week_start && week_end;
    
    if (!isWeekMode && !single_day) {
      throw new Error('Either single_day OR (week_start AND week_end) must be provided');
    }

    if (isWeekMode) {
      console.log(`📅 Week mode: Optimizing ${week_start} to ${week_end}`);
      return await optimizeWeek(supabaseServiceRole, week_start, week_end, exclude_bloc_assigned);
    } else {
      console.log(`📅 Day mode: Optimizing ${single_day}`);
      return await optimizeSingleDay(supabaseServiceRole, single_day, exclude_bloc_assigned);
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

// ========== SINGLE DAY OPTIMIZATION ==========
async function optimizeSingleDay(
  supabaseServiceRole: any,
  single_day: string,
  exclude_bloc_assigned: boolean
) {
  // 1. Fetch data
  const [
    { data: secretaires, error: secError },
    { data: sites, error: siteError },
    { data: medecins, error: medError },
    { data: besoins, error: besError },
    { data: capacites, error: capError },
    { data: blocOperations, error: blocError }
  ] = await Promise.all([
    supabaseServiceRole.from('secretaires').select('*, assignation_administrative').eq('actif', true),
    supabaseServiceRole.from('sites').select('*').eq('actif', true),
    supabaseServiceRole.from('medecins').select('*').eq('actif', true),
    supabaseServiceRole.from('besoin_effectif').select('*')
      .eq('date', single_day).eq('actif', true).eq('type', 'medecin'),
    supabaseServiceRole.from('capacite_effective').select('*')
      .eq('date', single_day).eq('actif', true),
    supabaseServiceRole.from('planning_genere_bloc_operatoire').select(`
      *,
      planning_genere_bloc_personnel(*)
    `).eq('date', single_day)
  ]);

  if (secError) throw secError;
  if (siteError) throw siteError;
  if (medError) throw medError;
  if (besError) throw besError;
  if (capError) throw capError;
  if (blocError) throw blocError;

  console.log(`✓ ${secretaires.length} secretaires, ${sites.length} sites, ${besoins.length} besoins`);

  // Create maps
    const medecinMap = new Map<string, any>(medecins.map((m: any) => [m.id, m]));
    
    // 2. Get or create planning_id
    const weekStart = getWeekStart(new Date(single_day));
    const weekEnd = getWeekEnd(new Date(single_day));
    const weekStartStr = weekStart.toISOString().split('T')[0];
    const weekEndStr = weekEnd.toISOString().split('T')[0];

    let planning_id;
    const { data: existingPlanning } = await supabaseServiceRole
      .from('planning')
      .select('*')
      .eq('date_debut', weekStartStr)
      .eq('date_fin', weekEndStr)
      .maybeSingle();

    if (existingPlanning) {
      planning_id = existingPlanning.id;
    } else {
      const { data: newPlanning, error: planningError } = await supabaseServiceRole
        .from('planning')
        .insert({
          date_debut: weekStartStr,
          date_fin: weekEndStr,
          statut: 'en_cours'
        })
        .select()
        .single();
      if (planningError) throw planningError;
      planning_id = newPlanning.id;
    }

    // 3. Generate sites besoins and personnel rows
    const { personnelRows } = await generateSitesBesoins(
      besoins,
      sites,
      medecinMap,
      planning_id,
      single_day,
      supabaseServiceRole
    );
    
    console.log(`✓ ${personnelRows.length} personnel rows created`);

    // 4. Identify secretaries assigned to bloc
    const blocAssignments = getSecretariesAssignedToBloc(blocOperations);
    console.log(`✓ ${blocAssignments.size} secretaries already assigned to bloc`);

    // 5. Fetch weekly history (admin + Port-en-Truie) for this week
    const weeklyHistory = await getWeeklyHistory(
      weekStartStr,
      single_day,
      supabaseServiceRole
    );
    console.log(`✓ Weekly history: ${weeklyHistory.admin.size} secretaries with admin, ${weeklyHistory.portEnTruie.size} with Port-en-Truie`);

    // 6. Build and solve MILP
    const solution = buildSitesMILP(
      personnelRows,
      secretaires,
      capacites,
      blocAssignments,
      weeklyHistory,
      besoins,
      sites
    );

    if (!solution.feasible) {
      console.error('❌ MILP solution not feasible!');
      return new Response(JSON.stringify({
        success: false,
        error: 'No feasible solution found'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`✅ MILP solved: objective = ${solution.result}`);

    // 7. Update personnel assignments
    const assignedCount = await updateSitePersonnelAssignments(
      personnelRows,
      solution,
      supabaseServiceRole
    );

    // 8. Fetch site besoins for unified creation
    const { data: siteBesoins, error: siteBesoinsError } = await supabaseServiceRole
      .from('planning_genere_site_besoin')
      .select('*')
      .eq('date', single_day)
      .eq('planning_id', planning_id);

    if (siteBesoinsError) throw siteBesoinsError;

    // 9. Create unified planning_genere entries (sites + admin)
    const { sites: sitesAssigned, admin: adminAssigned } = await createUnifiedPlanningGenere(
      capacites,
      blocAssignments,
      personnelRows,
      siteBesoins || [],
      solution,
      planning_id,
      single_day,
      supabaseServiceRole
    );

  console.log(`✅ Day optimization complete: ${sitesAssigned} sites entries, ${adminAssigned} admin entries`);

  return new Response(JSON.stringify({
    success: true,
    sites_personnel_assigned: assignedCount,
    sites_entries: sitesAssigned,
    admin_entries: adminAssigned
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// ========== WEEK OPTIMIZATION (with flexible secretaries) ==========
async function optimizeWeek(
  supabaseServiceRole: any,
  week_start: string,
  week_end: string,
  exclude_bloc_assigned: boolean
) {
  console.log('\n🗓️  WEEK MODE: Optimizing entire week with flexible secretaries');
  
  // 1. Fetch all data for the week
  const [
    { data: secretaires, error: secError },
    { data: sites, error: siteError },
    { data: medecins, error: medError },
    { data: besoins, error: besError },
    { data: capacites, error: capError },
    { data: blocOperations, error: blocError }
  ] = await Promise.all([
    supabaseServiceRole.from('secretaires').select('*').eq('actif', true),
    supabaseServiceRole.from('sites').select('*').eq('actif', true),
    supabaseServiceRole.from('medecins').select('*').eq('actif', true),
    supabaseServiceRole.from('besoin_effectif').select('*')
      .gte('date', week_start).lte('date', week_end)
      .eq('actif', true).eq('type', 'medecin'),
    supabaseServiceRole.from('capacite_effective').select('*')
      .gte('date', week_start).lte('date', week_end)
      .eq('actif', true),
    supabaseServiceRole.from('planning_genere_bloc_operatoire').select(`
      *,
      planning_genere_bloc_personnel(*)
    `).gte('date', week_start).lte('date', week_end)
  ]);

  if (secError) throw secError;
  if (siteError) throw siteError;
  if (medError) throw medError;
  if (besError) throw besError;
  if (capError) throw capError;
  if (blocError) throw blocError;

  console.log(`✓ ${secretaires.length} secretaires, ${sites.length} sites, ${besoins.length} besoins across week`);

  // 2. Identify flexible secretaries
  const flexibleSecretaries = new Map<string, number>();
  const standardSecretaries = [];
  
  for (const sec of secretaires) {
    if (sec.horaire_flexible && sec.pourcentage_temps) {
      const requiredDays = Math.round((sec.pourcentage_temps / 100) * 5);
      flexibleSecretaries.set(sec.id, requiredDays);
      console.log(`  📊 Flexible: ${sec.first_name} ${sec.name} → ${requiredDays} full days required (${sec.pourcentage_temps}%)`);
    } else {
      standardSecretaries.push(sec);
    }
  }

  // 3. Get or create planning_id
  let planning_id;
  const { data: existingPlanning } = await supabaseServiceRole
    .from('planning')
    .select('*')
    .eq('date_debut', week_start)
    .eq('date_fin', week_end)
    .maybeSingle();

  if (existingPlanning) {
    planning_id = existingPlanning.id;
  } else {
    const { data: newPlanning, error: planningError } = await supabaseServiceRole
      .from('planning')
      .insert({
        date_debut: week_start,
        date_fin: week_end,
        statut: 'en_cours'
      })
      .select()
      .single();
    if (planningError) throw planningError;
    planning_id = newPlanning.id;
  }

  // 4. Generate dates in the week
  const dates = [];
  const currentDate = new Date(week_start);
  const endDate = new Date(week_end);
  
  while (currentDate <= endDate) {
    const dateStr = currentDate.toISOString().split('T')[0];
    dates.push(dateStr);
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  console.log(`✓ Processing ${dates.length} days: ${dates.join(', ')}`);

  // 5. Generate besoins and personnel rows for ALL days
  const medecinMap = new Map<string, any>(medecins.map((m: any) => [m.id, m]));
  const allPersonnelRows = [];
  
  for (const date of dates) {
    const dayBesoins = besoins.filter((b: any) => b.date === date);
    const { personnelRows } = await generateSitesBesoins(
      dayBesoins,
      sites,
      medecinMap,
      planning_id,
      date,
      supabaseServiceRole
    );
    allPersonnelRows.push(...personnelRows);
  }
  
  console.log(`✓ ${allPersonnelRows.length} total personnel rows created for the week`);

  // 6. Get bloc assignments for all days
  const blocAssignmentsByDate = new Map<string, Map<string, string[]>>();
  for (const date of dates) {
    const dayBloc = blocOperations.filter((b: any) => b.date === date);
    blocAssignmentsByDate.set(date, getSecretariesAssignedToBloc(dayBloc));
  }

  // 7. Build and solve weekly MILP
  const solution = buildWeekMILP(
    allPersonnelRows,
    secretaires,
    capacites,
    blocAssignmentsByDate,
    besoins,
    sites,
    dates,
    flexibleSecretaries
  );

  if (!solution.feasible) {
    console.error('❌ Weekly MILP solution not feasible!');
    return new Response(JSON.stringify({
      success: false,
      error: 'No feasible solution found for the week'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  console.log(`✅ Weekly MILP solved: objective = ${solution.result}`);

  // 8. Update personnel assignments for all days
  let totalAssigned = 0;
  for (const date of dates) {
    const dayPersonnelRows = allPersonnelRows.filter(r => 
      r.planning_genere_site_besoin.date === date
    );
    const assigned = await updateSitePersonnelAssignments(
      dayPersonnelRows,
      solution,
      supabaseServiceRole
    );
    totalAssigned += assigned;
  }

  // 9. Create unified planning_genere for all days
  let totalSites = 0, totalAdmin = 0;
  
  for (const date of dates) {
    const dayCapacites = capacites.filter((c: any) => c.date === date);
    const dayBesoins = besoins.filter((b: any) => b.date === date);
    const dayPersonnelRows = allPersonnelRows.filter(r =>
      r.planning_genere_site_besoin.date === date
    );
    
    const { data: siteBesoins } = await supabaseServiceRole
      .from('planning_genere_site_besoin')
      .select('*')
      .eq('date', date)
      .eq('planning_id', planning_id);

    const blocAssignments = blocAssignmentsByDate.get(date) || new Map();

    const { sites: sitesAssigned, admin: adminAssigned } = await createUnifiedPlanningGenere(
      dayCapacites,
      blocAssignments,
      dayPersonnelRows,
      siteBesoins || [],
      solution,
      planning_id,
      date,
      supabaseServiceRole
    );
    
    totalSites += sitesAssigned;
    totalAdmin += adminAssigned;
  }

  console.log(`✅ Week optimization complete: ${totalSites} sites entries, ${totalAdmin} admin entries`);

  return new Response(JSON.stringify({
    success: true,
    mode: 'week',
    days_optimized: dates.length,
    sites_personnel_assigned: totalAssigned,
    sites_entries: totalSites,
    admin_entries: totalAdmin,
    flexible_secretaries: Array.from(flexibleSecretaries.entries()).map(([id, days]) => ({ id, required_days: days }))
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

function getWeekEnd(date: Date): Date {
  const start = getWeekStart(date);
  return new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);
}

async function generateSitesBesoins(
  besoins: any[],
  sites: any[],
  medecinMap: Map<string, any>,
  planning_id: string,
  single_day: string,
  supabase: any
): Promise<{ personnelRows: any[] }> {
  console.log('\n💾 Generating sites besoins...');
  
  const besoinRows = [];
  const personnelRowsData = [];

  for (const site of sites) {
    // Skip bloc operatoire and admin sites
    if (site.nom?.includes('Bloc opératoire') || site.id === SITE_ADMIN_ID) continue;
    
    for (const periode of ['matin', 'apres_midi']) {
      // Find medecins working EXACTLY at this periode (not toute_journee)
      const medecinsExactPeriode = besoins.filter(b => 
        b.site_id === site.id &&
        b.demi_journee === periode
      );
      
      // Find medecins working toute_journee (need to split in half)
      const medecinsTouteJournee = besoins.filter(b => 
        b.site_id === site.id &&
        b.demi_journee === 'toute_journee'
      );
      
      if (medecinsExactPeriode.length === 0 && medecinsTouteJournee.length === 0) continue;

      // Calculate total secretary requirement
      let totalBesoin = 0;
      
      // Exact period needs: full requirement
      totalBesoin += medecinsExactPeriode.reduce((sum, b) => {
        const medecin = medecinMap.get(b.medecin_id);
        return sum + (Number(medecin?.besoin_secretaires) || 1.2);
      }, 0);
      
      // Toute journee needs: full requirement for each half-day
      totalBesoin += medecinsTouteJournee.reduce((sum, b) => {
        const medecin = medecinMap.get(b.medecin_id);
        return sum + (Number(medecin?.besoin_secretaires) || 1.2);
      }, 0);

      const nombreRequis = Math.ceil(totalBesoin);
      
      // Combine all medecins for tracking
      const allMedecins = [
        ...medecinsExactPeriode.map(b => b.medecin_id),
        ...medecinsTouteJournee.map(b => b.medecin_id)
      ];

      // Create besoin entry
      besoinRows.push({
        planning_id,
        date: single_day,
        site_id: site.id,
        periode,
        medecins_ids: allMedecins,
        nombre_secretaires_requis: nombreRequis
      });

      // Will create personnel rows after getting besoin IDs
      personnelRowsData.push({
        site_id: site.id,
        periode,
        medecins: allMedecins,
        nombre_requis: nombreRequis
      });
    }
  }

  if (besoinRows.length === 0) {
    console.log('  ℹ️ No sites besoins to create');
    return { personnelRows: [] };
  }

  // Insert besoins
  const { data: savedBesoins, error: besoinError } = await supabase
    .from('planning_genere_site_besoin')
    .insert(besoinRows)
    .select();

  if (besoinError) throw besoinError;
  console.log(`  ✅ ${savedBesoins.length} besoins created`);

  // Create personnel rows
  const personnelRows = [];
  for (let i = 0; i < personnelRowsData.length; i++) {
    const data = personnelRowsData[i];
    const besoin = savedBesoins[i];

    // Create one row per required secretary
    for (let ordre = 1; ordre <= data.nombre_requis; ordre++) {
      personnelRows.push({
        planning_genere_site_besoin_id: besoin.id,
        secretaire_id: null, // Will be filled by MILP
        ordre
      });
    }
  }

  const { data: insertedPersonnel, error: personnelError } = await supabase
    .from('planning_genere_site_personnel')
    .insert(personnelRows)
    .select(`
      id,
      planning_genere_site_besoin_id,
      secretaire_id,
      ordre,
      created_at,
      updated_at,
      planning_genere_site_besoin!inner(site_id, periode, medecins_ids)
    `);

  if (personnelError) throw personnelError;
  console.log(`  ✅ ${insertedPersonnel.length} personnel rows created`);

  return { personnelRows: insertedPersonnel };
}

function getSecretariesAssignedToBloc(blocOperations: any[]): Map<string, string[]> {
  const assignments = new Map();
  
  for (const operation of blocOperations) {
    const periode = operation.periode || 'matin';
    
    for (const personnel of operation.planning_genere_bloc_personnel || []) {
      if (personnel.secretaire_id) {
        if (!assignments.has(personnel.secretaire_id)) {
          assignments.set(personnel.secretaire_id, []);
        }
        assignments.get(personnel.secretaire_id).push(periode);
      }
    }
  }
  
  return assignments;
}

async function getWeeklyHistory(
  weekStartStr: string,
  currentDay: string,
  supabase: any
): Promise<{ admin: Map<string, number>; portEnTruie: Map<string, number> }> {
  // Fetch planning_genere entries for the week up to (but NOT including) current day
  const { data: planningEntries } = await supabase
    .from('planning_genere')
    .select('secretaire_id, type, planning_genere_site_besoin_id')
    .gte('date', weekStartStr)
    .lt('date', currentDay);
  
  const adminCounts = new Map<string, number>();
  const portEnTruieCounts = new Map<string, number>();
  
  // Count admin assignments (type = 'administratif')
  for (const entry of planningEntries || []) {
    if (entry.type === 'administratif' && entry.secretaire_id) {
      adminCounts.set(entry.secretaire_id, (adminCounts.get(entry.secretaire_id) || 0) + 1);
    }
  }
  
  // Fetch Port-en-Truie assignments (need to join with site_besoin)
  const { data: siteAssignments } = await supabase
    .from('planning_genere')
    .select(`
      secretaire_id,
      planning_genere_site_besoin!inner(site_id)
    `)
    .gte('date', weekStartStr)
    .lt('date', currentDay)
    .eq('type', 'site');
  
  for (const entry of siteAssignments || []) {
    if (entry.secretaire_id && 
        entry.planning_genere_site_besoin?.site_id === SITE_PORT_EN_TRUIE) {
      portEnTruieCounts.set(
        entry.secretaire_id,
        (portEnTruieCounts.get(entry.secretaire_id) || 0) + 1
      );
    }
  }
  
  return { admin: adminCounts, portEnTruie: portEnTruieCounts };
}

function buildSitesMILP(
  personnelRows: any[],
  secretaires: any[],
  capacites: any[],
  blocAssignments: Map<string, string[]>,
  weeklyHistory: { admin: Map<string, number>; portEnTruie: Map<string, number> },
  besoins: any[],
  sites: any[]
): any {
  console.log('\n🔍 Building MILP model...');
  
  const model: any = {
    optimize: 'cost',
    opType: 'min',
    constraints: {},
    variables: {},
    ints: {}
  };

  // Map capacities
  const capacitesMap = new Map();
  capacites.forEach(c => {
    const secId = c.secretaire_id || c.backup_id;
    const periode = c.demi_journee === 'toute_journee' ? 'toute_journee' : c.demi_journee;
    capacitesMap.set(`${secId}_${periode}`, c);
    if (periode === 'toute_journee') {
      capacitesMap.set(`${secId}_matin`, c);
      capacitesMap.set(`${secId}_apres_midi`, c);
    }
  });

  // Create sites map for geographic constraints
  const sitesMap = new Map();
  sites.forEach(site => {
    sitesMap.set(site.id, site);
  });

  // Create map of medecins by site/period for obliged secretaries
  const medecinsBySite = new Map<string, Set<string>>();
  for (const besoin of besoins) {
    const periodes = besoin.demi_journee === 'toute_journee' 
      ? ['matin', 'apres_midi'] 
      : [besoin.demi_journee];
    
    for (const periode of periodes) {
      const key = `${besoin.site_id}_${periode}`;
      if (!medecinsBySite.has(key)) {
        medecinsBySite.set(key, new Set());
      }
      medecinsBySite.get(key)!.add(besoin.medecin_id);
    }
  }

  // Variables for each personnel row × secretary
  for (const row of personnelRows) {
    const besoin = row.planning_genere_site_besoin;
    const site_id = besoin.site_id;
    const periode = besoin.periode;
    const key = `${site_id}_${periode}`;
    const medecinsOnSite = medecinsBySite.get(key) || new Set();

    // PRIORITY 1: Secretaries linked to ANY medecin working at this site/period (-10000)
    const medecinsIds = besoin.medecins_ids || [];

    for (const medecinId of medecinsIds) {
      const linkedSec = secretaires.find(s => s.medecin_assigne_id === medecinId);
      
      if (linkedSec) {
        const keyCapacite = `${linkedSec.id}_${periode}`;
        const blocPeriods = blocAssignments.get(linkedSec.id) || [];
        const otherPeriode = periode === 'matin' ? 'apres_midi' : 'matin';
        const isAtBlocOtherPeriod = blocPeriods.includes(otherPeriode);

        // Check geographic compatibility if at bloc the other period
        const site = sitesMap.get(site_id);
        const isGeographicallyCompatible = !isAtBlocOtherPeriod || 
          (site && isCliniqueLaValleeCompatible(site.nom));

        // Check if site is in secretary's profile
        const capacite = capacitesMap.get(keyCapacite);
        const isSiteInProfile = capacite?.site_id === site_id || 
          (capacite && !capacite.site_id && (linkedSec.sites_assignes || []).includes(site_id));

        if (capacitesMap.has(keyCapacite) && 
            !blocPeriods.includes(periode) && 
            isGeographicallyCompatible &&
            isSiteInProfile) {
          const varName = `x_${linkedSec.id}_${row.id}`;
          
          // Only create if not already created by another medecin
          if (!model.variables[varName]) {
            model.variables[varName] = {
              cost: -10000, // Top priority
              [`row_${row.id}`]: 1,
              [`capacity_${linkedSec.id}_${periode}`]: 1
            };
            model.ints[varName] = 1;
          }
        }
      }
    }

    // PRIORITY 2: Secretaries eligible for this site (-100)
    const eligibleSecs = secretaires.filter(s => {
      const keyCapacite = `${s.id}_${periode}`;
      if (!capacitesMap.has(keyCapacite)) {
        return false;
      }
      
      // Check if secretary is assigned to bloc for THIS SPECIFIC period
      const blocPeriods = blocAssignments.get(s.id) || [];
      if (blocPeriods.includes(periode)) {
        return false;
      }

      // Check geographic compatibility if at bloc the other period
      const otherPeriode = periode === 'matin' ? 'apres_midi' : 'matin';
      const isAtBlocOtherPeriod = blocPeriods.includes(otherPeriode);
      if (isAtBlocOtherPeriod) {
        const site = sitesMap.get(site_id);
        if (!site || !isCliniqueLaValleeCompatible(site.nom)) {
          return false; // Cannot assign to non-Clinique sites if at bloc other period
        }
      }
      
      const capacite = capacitesMap.get(keyCapacite);
      
      // If capacity has a specific site_id, secretary can only be assigned to that site
      if (capacite.site_id) {
        return capacite.site_id === site_id;
      }
      
      // If capacity has no site_id (NULL), secretary can be assigned to any site in their profile
      return (s.sites_assignes || []).includes(site_id);
    });

    for (const sec of eligibleSecs) {
      const varName = `x_${sec.id}_${row.id}`;
      if (model.variables[varName]) continue; // Already created in priority 1

      let cost = -100;

      // NO PENALTY for Port-en-Truie here (will be handled by pet_count_k)

      model.variables[varName] = {
        cost,
        [`row_${row.id}`]: 1,
        [`capacity_${sec.id}_${periode}`]: 1
      };
      model.ints[varName] = 1;
      
      // Add to exclusivity constraint (for admin)
      const exclusiveConstraint = `exclusive_${sec.id}_${periode}`;
      if (!model.constraints[exclusiveConstraint]) {
        model.constraints[exclusiveConstraint] = { max: 1 };
      }
      model.variables[varName][exclusiveConstraint] = 1;
      
      // Track Port-en-Truie assignments for counter
      if (site_id === SITE_PORT_EN_TRUIE && !sec.prefere_port_en_truie) {
        const petSumConstraint = `pet_sum_${sec.id}`;
        if (!model.constraints[petSumConstraint]) {
          model.constraints[petSumConstraint] = { min: 0, max: 0 };
        }
        model.variables[varName][petSumConstraint] = 1;
      }
    }
  }

  // === SITE CLOSURE CONTINUITY CONSTRAINT ===
  // Ensure at least 2 secretaries work full day (morning + afternoon) on closure sites
  console.log('  🔒 Adding site closure continuity constraints...');

  const closureSites = sites.filter(s => s.fermeture === true);
  const closureSiteIds = new Set(closureSites.map(s => s.id));

  if (closureSites.length === 0) {
    console.log('  ℹ️ No closure sites found');
  } else {
    // Map: site_id_secretary_id -> { matin: [x_vars], apres_midi: [x_vars] }
    const closureAssignmentsBySiteAndSec = new Map<string, { matin: string[], apres_midi: string[] }>();

    for (const row of personnelRows) {
      const besoin = row.planning_genere_site_besoin;
      const site_id = besoin.site_id;
      const periode = besoin.periode as 'matin' | 'apres_midi';
      
      if (!closureSiteIds.has(site_id)) continue;
      
      // Find all x_ variables that reference this row
      for (const varName of Object.keys(model.variables)) {
        if (!varName.startsWith('x_')) continue;
        if (!model.variables[varName][`row_${row.id}`]) continue;
        
        const secId = varName.split('_')[1];
        const key = `${site_id}_${secId}`;
        
        if (!closureAssignmentsBySiteAndSec.has(key)) {
          closureAssignmentsBySiteAndSec.set(key, { matin: [], apres_midi: [] });
        }
        
        closureAssignmentsBySiteAndSec.get(key)![periode].push(varName);
      }
    }

    // Create continuity variables
    let continuitiesCount = 0;

    for (const [key, periods] of closureAssignmentsBySiteAndSec) {
      // Skip if secretary cannot work both periods at this site
      if (periods.matin.length === 0 || periods.apres_midi.length === 0) continue;
      
      const [site_id, secId] = key.split('_');
      const contVar = `continuity_${site_id.substring(0, 8)}_${secId.substring(0, 8)}`;
      
      // Binary variable with strong bonus (-200)
      model.variables[contVar] = { cost: -200 };
      model.ints[contVar] = 1;
      
      // Constraint 1: continuity <= sum(matin_vars)
      // If no matin assignment, continuity must be 0
      const constraintMatin = `cont_matin_${site_id.substring(0, 8)}_${secId.substring(0, 8)}`;
      model.constraints[constraintMatin] = { max: 0 };
      model.variables[contVar][constraintMatin] = 1;
      for (const matinVar of periods.matin) {
        model.variables[matinVar][constraintMatin] = -1;
      }
      
      // Constraint 2: continuity <= sum(pm_vars)
      // If no PM assignment, continuity must be 0
      const constraintPM = `cont_pm_${site_id.substring(0, 8)}_${secId.substring(0, 8)}`;
      model.constraints[constraintPM] = { max: 0 };
      model.variables[contVar][constraintPM] = 1;
      for (const pmVar of periods.apres_midi) {
        model.variables[pmVar][constraintPM] = -1;
      }
      
      continuitiesCount++;
    }

    console.log(`  ✅ Created ${continuitiesCount} continuity variables`);

    // Minimum 2 continuities per closure site
    for (const site of closureSites) {
      const continuityVars = Object.keys(model.variables).filter(v => 
        v.startsWith(`continuity_${site.id.substring(0, 8)}`)
      );
      
      if (continuityVars.length === 0) {
        console.log(`  ⚠️ Warning: No continuity possible for ${site.nom}`);
        continue;
      }
      
      const constraintName = `min_continuity_${site.id.substring(0, 8)}`;
      model.constraints[constraintName] = { min: 2 };
      
      for (const contVar of continuityVars) {
        model.variables[contVar][constraintName] = 1;
      }
      
      console.log(`  ✓ Constraint added: ${site.nom} requires 2+ full-day presences`);
    }
  }

  // === SITE CHANGE PENALTY ===
  // Create variables to track site changes between morning and afternoon
  console.log('  🔄 Adding site change penalties...');
  
  // Step 1: Group x variables by secretary, period, and site
  const xVarsBySec = new Map<string, { 
    matin: Map<string, string[]>, 
    apres_midi: Map<string, string[]> 
  }>();

  for (const row of personnelRows) {
    const periode = row.planning_genere_site_besoin.periode as 'matin' | 'apres_midi';
    const site_id = row.planning_genere_site_besoin.site_id;
    
    for (const varName of Object.keys(model.variables)) {
      if (!varName.startsWith('x_')) continue;
      if (!model.variables[varName][`row_${row.id}`]) continue;
      
      const secId = varName.split('_')[1];
      
      if (!xVarsBySec.has(secId)) {
        xVarsBySec.set(secId, { 
          matin: new Map(), 
          apres_midi: new Map() 
        });
      }
      
      const secMap = xVarsBySec.get(secId)!;
      if (!secMap[periode].has(site_id)) {
        secMap[periode].set(site_id, []);
      }
      secMap[periode].get(site_id)!.push(varName);
    }
  }

  // Step 2: For each secretary, create site change detection variables
  let siteChangePenaltiesCount = 0;
  for (const [secId, periods] of xVarsBySec) {
    const matinSites = Array.from(periods.matin.keys());
    const pmSites = Array.from(periods.apres_midi.keys());
    
    if (matinSites.length === 0 || pmSites.length === 0) continue;
    
    // For each combination (siteA matin, siteB pm) where siteA !== siteB
    for (const siteA of matinSites) {
      for (const siteB of pmSites) {
        if (siteA === siteB) continue; // Same site, no change
        
        const matinVars = periods.matin.get(siteA)!;
        const pmVars = periods.apres_midi.get(siteB)!;
        
        // Create binary variable: change_siteA_to_siteB_secId
        const changeVar = `change_${secId}_${siteA.substring(0, 8)}_to_${siteB.substring(0, 8)}`;
        model.variables[changeVar] = {
          cost: PENALTY_SITE_CHANGE
        };
        model.ints[changeVar] = 1;
        
        // Constraint: change_var >= x_matin + x_pm - 1
        // Rewrite: x_matin + x_pm - change_var <= 1
        // This forces change_var to 1 if BOTH matin and pm are assigned to different sites
        const constraintName = `detect_change_${secId}_${siteA.substring(0, 8)}_${siteB.substring(0, 8)}`;
        model.constraints[constraintName] = { max: 1 };
        
        for (const matinVar of matinVars) {
          model.variables[matinVar][constraintName] = 1;
        }
        for (const pmVar of pmVars) {
          model.variables[pmVar][constraintName] = 1;
        }
        model.variables[changeVar][constraintName] = -1;
        
        siteChangePenaltiesCount++;
      }
    }
  }
  
  console.log(`  ✅ Added ${siteChangePenaltiesCount} site change penalty variables`);

  // Constraints: Exactly 1 assignment per row (required OR penalty for unsatisfied)
  for (const row of personnelRows) {
    // Add a penalty variable for unsatisfied needs
    const unsatisfiedVar = `unsatisfied_${row.id}`;
    model.variables[unsatisfiedVar] = {
      cost: 10000,  // Heavy penalty for not assigning a secretary
      [`row_${row.id}`]: 1
    };
    model.ints[unsatisfiedVar] = 1;
    
    // Constraint: exactly 1 (either a secretary OR the penalty variable)
    model.constraints[`row_${row.id}`] = { min: 1, max: 1 };
  }

  // Constraints: max 1 assignment per secretary/period
  for (const sec of secretaires) {
    for (const periode of ['matin', 'apres_midi']) {
      const keyCapacite = `${sec.id}_${periode}`;
      const blocPeriods = blocAssignments.get(sec.id) || [];
      if (capacitesMap.has(keyCapacite) && !blocPeriods.includes(periode)) {
        model.constraints[`capacity_${sec.id}_${periode}`] = { max: 1 };
      }
    }
  }

  // === ADMIN VARIABLES WITH WEEKLY HISTORY ===
  const secretaryPeriods = new Map<string, Set<string>>();
  for (const cap of capacites) {
    const secId = cap.secretaire_id || cap.backup_id;
    if (!secId) continue;
    
    const periodes = cap.demi_journee === 'toute_journee' 
      ? ['matin', 'apres_midi'] 
      : [cap.demi_journee];
    
    if (!secretaryPeriods.has(secId)) {
      secretaryPeriods.set(secId, new Set());
    }
    for (const p of periodes) {
      secretaryPeriods.get(secId)!.add(p);
    }
  }

  // Create admin variables and counter variables with weekly history
  for (const sec of secretaires) {
    const blocPeriods = blocAssignments.get(sec.id) || [];
    const availablePeriods = secretaryPeriods.get(sec.id) || new Set();
    const historicAdmin = weeklyHistory.admin.get(sec.id) || 0;
    
    // Create admin_s_p variables (one per available period)
    for (const periode of ['matin', 'apres_midi']) {
      if (!availablePeriods.has(periode) || blocPeriods.includes(periode)) {
        continue;
      }
      
      const adminVarName = `admin_${sec.id}_${periode}`;
      model.variables[adminVarName] = {
        cost: 0, // Neutral, score comes from admin_count_k
        [`capacity_${sec.id}_${periode}`]: 1, // Uses capacity
        [`admin_sum_${sec.id}`]: 1 // For linking to counter
      };
      model.ints[adminVarName] = 1;
      
      // Add to exclusivity constraint
      const exclusiveConstraint = `exclusive_${sec.id}_${periode}`;
      if (!model.constraints[exclusiveConstraint]) {
        model.constraints[exclusiveConstraint] = { max: 1 };
      }
      model.variables[adminVarName][exclusiveConstraint] = 1;
    }
    
    // Create admin counter variables (with offset for history)
    const hasAdminOption = availablePeriods.size > 0 && 
                           (!blocPeriods.includes('matin') || !blocPeriods.includes('apres_midi'));
    
    if (hasAdminOption) {
      // Determine coefficient pattern based on secretary preference
      let getCoefficient: (k: number) => number;
      if (sec.assignation_administrative) {
        // Linear bonus for admin-preferring secretaries
        getCoefficient = (k) => -40 * k;
      } else {
        // Decreasing bonus for normal secretaries
        // k=0:0, k=1:-50, k=2:-70, k=3:-85, k=4:-97, etc.
        getCoefficient = (k) => {
          if (k === 0) return 0;
          let total = 0;
          for (let i = 1; i <= k; i++) {
            total += -50 / (i * 1.5); // Decreasing marginal value
          }
          return Math.round(total);
        };
      }
      
      // Create counters from historicAdmin to historicAdmin + 2
      // (can add 0, 1, or 2 admin assignments today)
      for (let todayAdmin = 0; todayAdmin <= 2; todayAdmin++) {
        const totalWeekly = historicAdmin + todayAdmin;
        const countVarName = `admin_count_${totalWeekly}_${sec.id}`;
        model.variables[countVarName] = {
          cost: getCoefficient(totalWeekly),
          [`admin_count_active_${sec.id}`]: 1, // Exactly one counter active
          [`admin_sum_${sec.id}`]: -todayAdmin // Link to actual admin count TODAY
        };
        model.ints[countVarName] = 1;
      }
      
      // Constraint: exactly one admin counter active
      model.constraints[`admin_count_active_${sec.id}`] = { min: 1, max: 1 };
      
      // Constraint: admin sum matches counter (TODAY's assignments)
      model.constraints[`admin_sum_${sec.id}`] = { min: 0, max: 0 };
    }
  }

  // === PORT-EN-TRUIE COUNTER VARIABLES WITH WEEKLY HISTORY ===
  for (const sec of secretaires) {
    if (sec.prefere_port_en_truie) continue; // Skip secretaries who prefer it
    
    const historicPET = weeklyHistory.portEnTruie.get(sec.id) || 0;
    
    // Check if this secretary can be assigned to Port-en-Truie
    const hasPETOption = personnelRows.some(row => 
      row.planning_genere_site_besoin.site_id === SITE_PORT_EN_TRUIE
    );
    
    if (!hasPETOption) continue;
    
    // Increasing penalty for multiple Port-en-Truie assignments
    // k=0:0, k=1:+30, k=2:+120, k=3:+270, k=4:+480
    const getPETCoefficient = (k: number) => {
      if (k === 0) return 0;
      return 30 * k * k; // Quadratic growth
    };
    
    // Create counters from historicPET to historicPET + 2
    for (let todayPET = 0; todayPET <= 2; todayPET++) {
      const totalWeekly = historicPET + todayPET;
      const countVarName = `pet_count_${totalWeekly}_${sec.id}`;
      model.variables[countVarName] = {
        cost: getPETCoefficient(totalWeekly),
        [`pet_count_active_${sec.id}`]: 1,
        [`pet_sum_${sec.id}`]: -todayPET
      };
      model.ints[countVarName] = 1;
    }
    
    // Constraint: exactly one pet counter active
    model.constraints[`pet_count_active_${sec.id}`] = { min: 1, max: 1 };
    
    // Constraint: pet_sum already created above in x loop
  }

  console.log(`  📊 Variables: ${Object.keys(model.variables).length}, Constraints: ${Object.keys(model.constraints).length}`);
  
  const solution = solver.Solve(model);
  console.log(`  ✅ Solution: feasible=${solution.feasible}, objective=${solution.result}`);
  
  return solution;
}

// ========== WEEK MILP (with flexible secretaries) ==========
function buildWeekMILP(
  personnelRows: any[],
  secretaires: any[],
  capacites: any[],
  blocAssignmentsByDate: Map<string, Map<string, string[]>>,
  besoins: any[],
  sites: any[],
  dates: string[],
  flexibleSecretaries: Map<string, number>
): any {
  console.log('\n🔍 Building WEEK MILP model with flexible secretaries...');
  
  const model: any = {
    optimize: 'cost',
    opType: 'min',
    constraints: {},
    variables: {},
    ints: {}
  };

  // Map capacities by date_secId_periode
  const capacitesMap = new Map();
  capacites.forEach((c: any) => {
    const secId = c.secretaire_id || c.backup_id;
    const periode = c.demi_journee === 'toute_journee' ? 'toute_journee' : c.demi_journee;
    const key = `${c.date}_${secId}_${periode}`;
    capacitesMap.set(key, c);
    if (periode === 'toute_journee') {
      capacitesMap.set(`${c.date}_${secId}_matin`, c);
      capacitesMap.set(`${c.date}_${secId}_apres_midi`, c);
    }
  });

  const sitesMap = new Map();
  sites.forEach((site: any) => sitesMap.set(site.id, site));

  // ===== PHASE 1: Create assignment variables x_secId_rowId_date =====
  console.log('  📝 Creating assignment variables...');
  
  for (const row of personnelRows) {
    const besoin = row.planning_genere_site_besoin;
    const site_id = besoin.site_id;
    const periode = besoin.periode;
    const date = besoin.date;
    
    // Skip bloc and admin sites
    if (site_id === SITE_ADMIN_ID) continue;
    const site = sitesMap.get(site_id);
    if (!site || site.nom?.includes('Bloc opératoire')) continue;

    const blocAssignments = blocAssignmentsByDate.get(date) || new Map();
    
    // For each secretary (flexible + standard)
    for (const sec of secretaires) {
      const capaciteKey = `${date}_${sec.id}_${periode}`;
      
      // Check bloc conflicts
      const blocPeriods = blocAssignments.get(sec.id) || [];
      if (blocPeriods.includes(periode)) continue;
      
      // Check geographic compatibility (bloc other period)
      const otherPeriode = periode === 'matin' ? 'apres_midi' : 'matin';
      const isAtBlocOtherPeriod = blocPeriods.includes(otherPeriode);
      const isGeographicallyCompatible = !isAtBlocOtherPeriod || 
        (site && isCliniqueLaValleeCompatible(site.nom));
      
      if (!isGeographicallyCompatible) continue;
      
      // Check capacity exists
      const hasCapacity = capacitesMap.has(capaciteKey);
      
      // For flexible secretaries: allow assignment to ANY compatible site (ignore capacites)
      const isFlexible = flexibleSecretaries.has(sec.id);
      const isSiteCompatible = (sec.sites_assignes || []).includes(site_id);
      
      if (!hasCapacity && !isFlexible) continue;
      if (isFlexible && !isSiteCompatible) continue;
      
      // Create variable x_secId_rowId
      const varName = `x_${sec.id}_${row.id}`;
      let cost = -100; // Base: fill a need
      
      // Priority: linked medecin
      const medecinsIds = besoin.medecins_ids || [];
      if (medecinsIds.includes(sec.medecin_assigne_id)) {
        cost = -10000;
      }
      
      // Bonus: Port-en-Truie preference
      if (sec.prefere_port_en_truie && site_id === SITE_PORT_EN_TRUIE) {
        cost -= 80;
      }
      
      model.variables[varName] = {
        cost,
        [`row_${row.id}`]: 1,
        [`capacity_${sec.id}_${date}_${periode}`]: 1
      };
      model.ints[varName] = 1;
    }
  }
  
  console.log(`  ✅ ${Object.keys(model.variables).length} assignment variables created`);

  // ===== PHASE 2: Constraints =====
  
  // 2.1: Each row gets exactly 1 secretary
  console.log('  🔒 Adding row assignment constraints...');
  for (const row of personnelRows) {
    const constraint = `row_${row.id}`;
    model.constraints[constraint] = { equal: 1 };
  }
  
  // 2.2: Each secretary can work max 1 row per date/period
  console.log('  🔒 Adding capacity constraints...');
  for (const sec of secretaires) {
    for (const date of dates) {
      for (const periode of ['matin', 'apres_midi']) {
        const constraint = `capacity_${sec.id}_${date}_${periode}`;
        model.constraints[constraint] = { max: 1 };
      }
    }
  }
  
  // 2.3: FLEXIBLE SECRETARIES - Full day constraints
  console.log('  📅 Adding flexible secretaries constraints...');
  
  for (const [flexSecId, requiredDays] of flexibleSecretaries) {
    const sec = secretaires.find((s: any) => s.id === flexSecId);
    if (!sec) continue;
    
    console.log(`    🧮 Configuring ${sec.first_name} ${sec.name} for ${requiredDays} full days`);
    
    // Create day variables: has_matin, has_pm, fullday for each date
    for (const date of dates) {
      // has_matin_{secId}_{date} = 1 if works at least one morning slot this date
      const hasMatinVar = `has_matin_${flexSecId}_${date}`;
      model.variables[hasMatinVar] = {};
      model.ints[hasMatinVar] = 1;
      
      // has_pm_{secId}_{date} = 1 if works at least one PM slot this date
      const hasPmVar = `has_pm_${flexSecId}_${date}`;
      model.variables[hasPmVar] = {};
      model.ints[hasPmVar] = 1;
      
      // fullday_{secId}_{date} = 1 if works BOTH morning AND afternoon this date
      const fulldayVar = `fullday_${flexSecId}_${date}`;
      model.variables[fulldayVar] = {};
      model.ints[fulldayVar] = 1;
      
      // Link has_matin to assignments: sum(x matin) <= M * has_matin
      // And: sum(x matin) >= has_matin (if any assignment, has_matin must be 1)
      const matinVars = Object.keys(model.variables).filter(v => {
        if (!v.startsWith(`x_${flexSecId}_`)) return false;
        const rowId = v.split('_')[2];
        const row = personnelRows.find((r: any) => r.id === rowId);
        return row && row.planning_genere_site_besoin.date === date && 
               row.planning_genere_site_besoin.periode === 'matin';
      });
      
      if (matinVars.length > 0) {
        // sum(x) >= has_matin => sum(x) - has_matin >= 0
        const linkConstraint1 = `link_has_matin_${flexSecId}_${date}`;
        model.constraints[linkConstraint1] = { min: 0 };
        model.variables[hasMatinVar][linkConstraint1] = -1;
        for (const xVar of matinVars) {
          model.variables[xVar][linkConstraint1] = 1;
        }
        
        // sum(x) <= M * has_matin => sum(x) - M * has_matin <= 0
        const M = matinVars.length; // Max possible assignments
        const linkConstraint2 = `limit_has_matin_${flexSecId}_${date}`;
        model.constraints[linkConstraint2] = { max: 0 };
        model.variables[hasMatinVar][linkConstraint2] = -M;
        for (const xVar of matinVars) {
          model.variables[xVar][linkConstraint2] = 1;
        }
      }
      
      // Same for PM
      const pmVars = Object.keys(model.variables).filter(v => {
        if (!v.startsWith(`x_${flexSecId}_`)) return false;
        const rowId = v.split('_')[2];
        const row = personnelRows.find((r: any) => r.id === rowId);
        return row && row.planning_genere_site_besoin.date === date && 
               row.planning_genere_site_besoin.periode === 'apres_midi';
      });
      
      if (pmVars.length > 0) {
        const linkConstraint1 = `link_has_pm_${flexSecId}_${date}`;
        model.constraints[linkConstraint1] = { min: 0 };
        model.variables[hasPmVar][linkConstraint1] = -1;
        for (const xVar of pmVars) {
          model.variables[xVar][linkConstraint1] = 1;
        }
        
        const M = pmVars.length;
        const linkConstraint2 = `limit_has_pm_${flexSecId}_${date}`;
        model.constraints[linkConstraint2] = { max: 0 };
        model.variables[hasPmVar][linkConstraint2] = -M;
        for (const xVar of pmVars) {
          model.variables[xVar][linkConstraint2] = 1;
        }
      }
      
      // fullday = has_matin AND has_pm
      // fullday <= has_matin
      const fulldayConstraint1 = `fullday_matin_${flexSecId}_${date}`;
      model.constraints[fulldayConstraint1] = { max: 0 };
      model.variables[fulldayVar][fulldayConstraint1] = 1;
      model.variables[hasMatinVar][fulldayConstraint1] = -1;
      
      // fullday <= has_pm
      const fulldayConstraint2 = `fullday_pm_${flexSecId}_${date}`;
      model.constraints[fulldayConstraint2] = { max: 0 };
      model.variables[fulldayVar][fulldayConstraint2] = 1;
      model.variables[hasPmVar][fulldayConstraint2] = -1;
      
      // fullday >= has_matin + has_pm - 1 (forces fullday=1 if both are 1)
      const fulldayConstraint3 = `fullday_force_${flexSecId}_${date}`;
      model.constraints[fulldayConstraint3] = { min: 0 };
      model.variables[fulldayVar][fulldayConstraint3] = -1;
      model.variables[hasMatinVar][fulldayConstraint3] = 1;
      model.variables[hasPmVar][fulldayConstraint3] = 1;
    }
    
    // Main constraint: sum(fullday_vars) = requiredDays
    const fulldayVars = Object.keys(model.variables).filter(v => 
      v.startsWith(`fullday_${flexSecId}_`)
    );
    
    if (fulldayVars.length > 0) {
      const dayLimitConstraint = `required_days_${flexSecId}`;
      model.constraints[dayLimitConstraint] = { equal: requiredDays };
      for (const fulldayVar of fulldayVars) {
        model.variables[fulldayVar][dayLimitConstraint] = 1;
      }
      console.log(`      ✓ Must work exactly ${requiredDays} full days (${fulldayVars.length} possible)`);
    }
  }

  // 2.4: Site change penalties (same day matin→pm)
  console.log('  🚫 Adding site change penalties...');
  let changeCount = 0;
  
  for (const sec of secretaires) {
    for (const date of dates) {
      const matinAssignments = new Map<string, string[]>(); // site_id -> [x_vars]
      const pmAssignments = new Map<string, string[]>();
      
      for (const varName of Object.keys(model.variables)) {
        if (!varName.startsWith(`x_${sec.id}_`)) continue;
        
        const rowId = varName.split('_')[2];
        const row = personnelRows.find((r: any) => r.id === rowId);
        if (!row || row.planning_genere_site_besoin.date !== date) continue;
        
        const site_id = row.planning_genere_site_besoin.site_id;
        const periode = row.planning_genere_site_besoin.periode;
        
        if (periode === 'matin') {
          if (!matinAssignments.has(site_id)) matinAssignments.set(site_id, []);
          matinAssignments.get(site_id)!.push(varName);
        } else {
          if (!pmAssignments.has(site_id)) pmAssignments.set(site_id, []);
          pmAssignments.get(site_id)!.push(varName);
        }
      }
      
      // Penalty if assigned to different sites
      for (const [siteA, matinVars] of matinAssignments) {
        for (const [siteB, pmVars] of pmAssignments) {
          if (siteA === siteB) continue;
          
          const changeVar = `change_${sec.id}_${siteA.substring(0, 8)}_to_${siteB.substring(0, 8)}_${date}`;
          model.variables[changeVar] = { cost: PENALTY_SITE_CHANGE };
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
  
  console.log(`    ✅ ${changeCount} site change detection variables created`);

  console.log(`  📊 Total Variables: ${Object.keys(model.variables).length}, Constraints: ${Object.keys(model.constraints).length}`);
  
  const solution = solver.Solve(model);
  console.log(`  ✅ Week solution: feasible=${solution.feasible}, objective=${solution.result}`);
  
  return solution;
}

async function updateSitePersonnelAssignments(
  personnelRows: any[],
  solution: any,
  supabase: any
): Promise<number> {
  console.log('\n🔄 Updating site personnel assignments...');
  
  let assignmentCount = 0;
  
  for (const [varName, value] of Object.entries(solution)) {
    if (varName.startsWith('x_') && (value as number) > 0.5) {
      const parts = varName.split('_');
      const secId = parts[1];
      const rowId = parts[2];
      
      const { error } = await supabase
        .from('planning_genere_site_personnel')
        .update({ secretaire_id: secId })
        .eq('id', rowId);
      
      if (error) {
        console.error(`  ❌ Failed to update row ${rowId}:`, error);
      } else {
        assignmentCount++;
      }
    }
  }
  
  console.log(`  ✅ ${assignmentCount} assignments updated`);
  return assignmentCount;
}

async function createUnifiedPlanningGenere(
  capacites: any[],
  blocAssignments: Map<string, string[]>,
  personnelRows: any[],
  siteBesoins: any[],
  solution: any,
  planning_id: string,
  single_day: string,
  supabase: any
): Promise<{ sites: number; admin: number }> {
  console.log('\n📊 Creating unified planning_genere entries...');
  
  // IDEMPOTENCY: Delete existing site/admin entries for this day
  await supabase
    .from('planning_genere')
    .delete()
    .eq('date', single_day)
    .in('type', ['site', 'administratif']);
  
  // Step 1: Build assignment map from MILP solution
  const assignmentMap = new Map<string, { besoinId: string; personnelRowId: string }>();
  // Key: "secretaire_id_periode"
  
  for (const [varName, value] of Object.entries(solution)) {
    if (varName.startsWith('x_') && (value as number) > 0.5) {
      const parts = varName.split('_');
      const secId = parts[1];
      const rowId = parts[2];
      
      const row = personnelRows.find(r => r.id === rowId);
      if (row) {
        const periode = row.planning_genere_site_besoin.periode;
        const besoinId = row.planning_genere_site_besoin_id;
        assignmentMap.set(`${secId}_${periode}`, { besoinId, personnelRowId: rowId });
      }
    }
  }
  
  // Step 2: Create planning_genere entries
  const entries = [];
  const processedSecretaries = new Set<string>(); // Track "secId_periode"
  
  // 2a. For each secretary assigned to a site need
  for (const [key, assignment] of assignmentMap.entries()) {
    const firstUnderscoreIndex = key.indexOf('_');
    const secId = key.substring(0, firstUnderscoreIndex);
    const periode = key.substring(firstUnderscoreIndex + 1);
    
    entries.push({
      planning_id,
      date: single_day,
      periode,
      type: 'site',
      secretaire_id: secId,
      planning_genere_site_besoin_id: assignment.besoinId,
      statut: 'planifie'
    });
    
    processedSecretaries.add(key);
  }
  
  // 2b. For each admin assignment from MILP solution
  for (const [varName, value] of Object.entries(solution)) {
    if (varName.startsWith('admin_') && 
        !varName.startsWith('admin_count_') && 
        !varName.startsWith('admin_sum_') &&
        (value as number) > 0.5) {
      const parts = varName.split('_');
      const secId = parts[1];
      // Handle "apres_midi" which becomes ["admin", secId, "apres", "midi"]
      const periode = parts.length > 3 ? `${parts[2]}_${parts[3]}` : parts[2];
      
      entries.push({
        planning_id,
        date: single_day,
        periode,
        type: 'administratif',
        secretaire_id: secId,
        statut: 'planifie'
      });
      
      processedSecretaries.add(`${secId}_${periode}`);
    }
  }
  
  if (entries.length === 0) {
    console.log('  ℹ️ No planning_genere entries to create');
    return { sites: 0, admin: 0 };
  }
  
  const { error } = await supabase
    .from('planning_genere')
    .insert(entries);
  
  if (error) throw error;
  
  const sitesCount = entries.filter(e => e.type === 'site').length;
  const adminCount = entries.filter(e => e.type === 'administratif').length;
  
  console.log(`  ✅ Created ${sitesCount} site entries + ${adminCount} admin entries`);
  return { sites: sitesCount, admin: adminCount };
}
