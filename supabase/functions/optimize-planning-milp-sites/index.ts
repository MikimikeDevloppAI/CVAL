import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import solver from 'https://esm.sh/javascript-lp-solver@0.4.24';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const SITE_PORT_EN_TRUIE = '043899a1-a232-4c4b-9d7d-0eb44dad00ad';
const SITE_ADMIN_ID = '00000000-0000-0000-0000-000000000001';
const PENALTY_SITE_CHANGE = 0.001;
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

    const { single_day, exclude_bloc_assigned = true } = await req.json().catch(() => ({}));
    if (!single_day) {
      throw new Error('single_day parameter is required');
    }

    console.log(`📅 Optimizing sites for day: ${single_day}`);

    // 1. Fetch data
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
    const medecinMap = new Map(medecins.map(m => [m.id, m]));
    
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

    // 5. Fetch historical Port-en-Truie assignments (last 4 weeks)
    const fourWeeksAgo = new Date(new Date(single_day).getTime() - 28 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const { data: historicalAssignments } = await supabaseServiceRole
      .from('planning_genere_site_besoin')
      .select(`
        planning_genere_site_personnel!inner(secretaire_id)
      `)
      .eq('site_id', SITE_PORT_EN_TRUIE)
      .gte('date', fourWeeksAgo)
      .lte('date', single_day);

    const portEnTruieCounts = countPortEnTruieAssignments(historicalAssignments || []);

    // 6. Build and solve MILP
    const solution = buildSitesMILP(
      personnelRows,
      secretaires,
      capacites,
      blocAssignments,
      portEnTruieCounts,
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

    console.log(`✅ Phase 2 complete: ${sitesAssigned} sites entries, ${adminAssigned} admin entries`);

    return new Response(JSON.stringify({
      success: true,
      sites_personnel_assigned: assignedCount,
      sites_entries: sitesAssigned,
      admin_entries: adminAssigned
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('❌ Sites optimization error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

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
      planning_genere_site_besoin!inner(site_id, periode)
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

function countPortEnTruieAssignments(historicalAssignments: any[]): Map<string, number> {
  const counts = new Map();
  
  for (const assignment of historicalAssignments || []) {
    for (const personnel of assignment.planning_genere_site_personnel || []) {
      if (personnel.secretaire_id) {
        counts.set(personnel.secretaire_id, (counts.get(personnel.secretaire_id) || 0) + 1);
      }
    }
  }
  
  return counts;
}

function buildSitesMILP(
  personnelRows: any[],
  secretaires: any[],
  capacites: any[],
  blocAssignments: Map<string, string[]>,
  portEnTruieCounts: Map<string, number>,
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

    // PRIORITY 1: Secretary linked to the medecin of this row (-10000)
    if (row.medecin_id) {
      const linkedSec = secretaires.find(s => s.medecin_assigne_id === row.medecin_id);
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
          model.variables[varName] = {
            cost: -10000,
            [`row_${row.id}`]: 1,
            [`capacity_${linkedSec.id}_${periode}`]: 1
          };
          model.ints[varName] = 1;
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

      // Penalty for Port-en-Truie
      if (site_id === SITE_PORT_EN_TRUIE && !sec.prefere_port_en_truie) {
        const count = portEnTruieCounts.get(sec.id) || 0;
        cost += PENALTY_PORT_EN_TRUIE_BASE * (count + 1);
      }

      model.variables[varName] = {
        cost,
        [`row_${row.id}`]: 1,
        [`capacity_${sec.id}_${periode}`]: 1
      };
      model.ints[varName] = 1;
    }
  }

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

  console.log(`  📊 Variables: ${Object.keys(model.variables).length}, Constraints: ${Object.keys(model.constraints).length}`);
  
  const solution = solver.Solve(model);
  console.log(`  ✅ Solution: feasible=${solution.feasible}, objective=${solution.result}`);
  
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
  
  // 2b. For each capacity not assigned to site or bloc
  for (const cap of capacites) {
    const secId = cap.secretaire_id || cap.backup_id;
    if (!secId) continue;

    const periodes = cap.demi_journee === 'toute_journee' 
      ? ['matin', 'apres_midi'] 
      : [cap.demi_journee];

    for (const periode of periodes) {
      const key = `${secId}_${periode}`;
      
      // Skip if already processed (assigned to site)
      if (processedSecretaries.has(key)) continue;
      
      // Skip if at bloc
      const isAtBloc = blocAssignments.has(secId) && 
                      blocAssignments.get(secId)!.includes(periode);
      if (isAtBloc) continue;

      // Create admin assignment
      entries.push({
        planning_id,
        date: single_day,
        periode,
        type: 'administratif',
        secretaire_id: secId,
        statut: 'planifie'
      });
      
      processedSecretaries.add(key);
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
