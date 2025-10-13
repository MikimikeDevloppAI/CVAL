import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import solver from 'https://esm.sh/javascript-lp-solver@0.4.24';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const SITE_PORT_EN_TRUIE = '043899a1-a232-4c4b-9d7d-0eb44dad00ad';
const SITE_GASTRO = '7723c334-d06c-413d-96f0-be281d76520d';
const SITES_INTERDITS_SI_BLOC = [SITE_PORT_EN_TRUIE, SITE_GASTRO];

const PENALTY_SITE_CHANGE = 0.001;
const PENALTY_PORT_EN_TRUIE_BASE = 0.0001;
const BONUS_ADMIN_BASE = -0.00001;
const BONUS_ADMIN_PRIORITAIRE = -0.001;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('🏢 Phase 2: Starting sites + remaining bloc MILP optimization');
    
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

    // 2. Calculate sites needs
    const sitesNeeds = calculateSitesNeeds(besoins, sites, medecinMap);
    console.log(`✓ ${sitesNeeds.length} sites needs calculated`);

    // 3. Identify remaining bloc needs
    const remainingBlocNeeds = identifyRemainingBlocNeeds(blocOperations);
    console.log(`⚠️ ${remainingBlocNeeds.length} remaining bloc needs`);

    // 4. Identify secretaries assigned to bloc
    const blocAssignments = getSecretariesAssignedToBloc(blocOperations);
    console.log(`✓ ${blocAssignments.size} secretaries already assigned to bloc`);

    // 5. Fetch historical Port-en-Truie assignments
    const fourWeeksAgo = new Date(new Date(single_day).getTime() - 28 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const { data: historicalAssignments } = await supabaseServiceRole
      .from('planning_genere_site')
      .select('secretaires_ids')
      .eq('site_id', SITE_PORT_EN_TRUIE)
      .gte('date', fourWeeksAgo)
      .lte('date', single_day);

    const portEnTruieCounts = countPortEnTruieAssignments(historicalAssignments);

    // 6. Get or create planning_id
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

    // 7. Build and solve MILP
    const solution = buildAndSolveSitesMILP(
      sitesNeeds,
      remainingBlocNeeds,
      secretaires,
      capacites,
      blocAssignments,
      portEnTruieCounts
    );

    // 8. Save results
    const results = await saveSitesAssignments(
      solution,
      planning_id,
      single_day,
      supabaseServiceRole
    );

    console.log(`✅ Phase 2 complete: ${results.sites_assigned} sites, ${results.remaining_bloc_filled} bloc filled`);

    return new Response(JSON.stringify({
      success: true,
      ...results
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('❌ Sites optimization error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
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

function calculateSitesNeeds(besoins: any[], sites: any[], medecinMap: Map<string, any>): any[] {
  const needs: any[] = [];
  
  for (const site of sites) {
    if (site.nom?.includes('Bloc opératoire')) continue;
    
    for (const periode of ['matin', 'apres_midi']) {
      const [start, end] = periode === 'matin' 
        ? ['07:30:00', '12:30:00']
        : ['13:00:00', '18:00:00'];
      
      const medecinsOnSite = besoins.filter(b => 
        b.site_id === site.id &&
        b.demi_journee === periode
      );
      
      const totalBesoin = medecinsOnSite.reduce((sum, b) => {
        const medecin = medecinMap.get(b.medecin_id);
        return sum + (Number(medecin?.besoin_secretaires) || 1.2);
      }, 0);
      
      if (totalBesoin > 0) {
        needs.push({
          site_id: site.id,
          periode,
          heure_debut: start,
          heure_fin: end,
          nombre_requis: Math.ceil(totalBesoin)
        });
      }
    }
  }
  
  return needs;
}

function identifyRemainingBlocNeeds(blocOperations: any[]): any[] {
  const remainingNeeds: any[] = [];
  
  for (const operation of blocOperations) {
    // Simplified: Assume all bloc needs are satisfied in Phase 1
  }
  
  return remainingNeeds;
}

function getSecretariesAssignedToBloc(blocOperations: any[]): Map<string, string[]> {
  const assignments = new Map();
  
  for (const operation of blocOperations) {
    const periode = operation.heure_debut < '12:30:00' ? 'matin' : 'apres_midi';
    
    for (const personnel of operation.planning_genere_bloc_personnel || []) {
      if (!assignments.has(personnel.secretaire_id)) {
        assignments.set(personnel.secretaire_id, []);
      }
      assignments.get(personnel.secretaire_id).push(periode);
    }
  }
  
  return assignments;
}

function countPortEnTruieAssignments(historicalAssignments: any[]): Map<string, number> {
  const counts = new Map();
  
  for (const assignment of historicalAssignments || []) {
    for (const secId of assignment.secretaires_ids || []) {
      counts.set(secId, (counts.get(secId) || 0) + 1);
    }
  }
  
  return counts;
}

function buildAndSolveSitesMILP(
  sitesNeeds: any[],
  remainingBlocNeeds: any[],
  secretaires: any[],
  capacites: any[],
  blocAssignments: Map<string, string[]>,
  portEnTruieCounts: Map<string, number>
): any {
  const model: any = {
    optimize: 'cost',
    opType: 'min',
    constraints: {},
    variables: {},
    ints: {}
  };

  const secretairesAuBlocMatin = new Set();
  const secretairesAuBlocAM = new Set();
  
  for (const [secId, periodes] of blocAssignments.entries()) {
    if (periodes.includes('matin')) secretairesAuBlocMatin.add(secId);
    if (periodes.includes('apres_midi')) secretairesAuBlocAM.add(secId);
  }

  const capacitesMap = new Map();
  capacites.forEach(c => {
    const key = `${c.secretaire_id || c.backup_id}_${c.demi_journee}`;
    capacitesMap.set(key, c);
  });

  // Variables for remaining bloc needs (PRIORITÉ 1000)
  for (const blocNeed of remainingBlocNeeds) {
    // Simplified: No remaining bloc needs in this implementation
  }

  // Variables for sites (PRIORITÉ 100)
  for (const need of sitesNeeds) {
    const periode = need.periode;
    
    let available = secretaires.filter(s => {
      const key = `${s.id}_${periode}`;
      return !blocAssignments.has(s.id) &&
             capacitesMap.has(key) &&
             (s.sites_assignes || []).includes(need.site_id);
    });

    // Constraint géographique "Clinique La Vallée First"
    if (SITES_INTERDITS_SI_BLOC.includes(need.site_id)) {
      if (periode === 'matin') {
        available = available.filter(s => !secretairesAuBlocAM.has(s.id));
      } else {
        available = available.filter(s => !secretairesAuBlocMatin.has(s.id));
      }
    }

    for (const sec of available) {
      const varName = `x_${sec.id}_${need.site_id}_${periode}`;
      
      let cost = -100;

      // Pénalité changement de site (simplified)
      // Pénalité Port-en-Truie progressive
      if (need.site_id === SITE_PORT_EN_TRUIE && !sec.prefere_port_en_truie) {
        const count = portEnTruieCounts.get(sec.id) || 0;
        cost += PENALTY_PORT_EN_TRUIE_BASE * (1 + count);
      }

      model.variables[varName] = {
        cost,
        [`site_need_${need.site_id}_${periode}`]: 1,
        [`capacity_${sec.id}_${periode}`]: 1
      };
      model.ints[varName] = 1;
    }

    model.constraints[`site_need_${need.site_id}_${periode}`] = {
      min: need.nombre_requis
    };
  }

  // Variables administratives
  for (const sec of secretaires.filter(s => !blocAssignments.has(s.id))) {
    for (const periode of ['matin', 'apres_midi']) {
      const key = `${sec.id}_${periode}`;
      if (!capacitesMap.has(key)) continue;

      const varName = `z_${sec.id}_admin_${periode}`;
      
      const bonus = sec.assignation_administrative ? BONUS_ADMIN_PRIORITAIRE : BONUS_ADMIN_BASE;

      model.variables[varName] = {
        cost: bonus,
        [`capacity_${sec.id}_${periode}`]: 1
      };
      model.ints[varName] = 1;
    }
  }

  // Contrainte unicité
  for (const sec of secretaires) {
    for (const periode of ['matin', 'apres_midi']) {
      model.constraints[`capacity_${sec.id}_${periode}`] = {
        max: 1
      };
    }
  }

  const solution = solver.Solve(model);
  return solution;
}

async function saveSitesAssignments(
  solution: any,
  planning_id: string,
  single_day: string,
  supabase: any
) {
  const siteRowsMap = new Map();
  const remainingBlocRows = [];

  for (const [varName, value] of Object.entries(solution)) {
    if (value < 0.5 || varName === 'feasible' || varName === 'result') continue;

    if (varName.startsWith('x_')) {
      const parts = varName.split('_');
      const secId = parts[1];
      const siteId = parts[2];
      const periode = parts[3];

      const [heure_debut, heure_fin] = periode === 'matin'
        ? ['07:30:00', '12:30:00']
        : ['13:00:00', '18:00:00'];

      const key = `${siteId}_${periode}`;
      if (!siteRowsMap.has(key)) {
        siteRowsMap.set(key, {
          planning_id,
          date: single_day,
          site_id: siteId,
          heure_debut,
          heure_fin,
          secretaires_ids: [],
          type_assignation: 'site',
          statut: 'planifie'
        });
      }
      siteRowsMap.get(key).secretaires_ids.push(secId);

    } else if (varName.startsWith('z_')) {
      const parts = varName.split('_');
      const secId = parts[1];
      const periode = parts[3];

      const [heure_debut, heure_fin] = periode === 'matin'
        ? ['07:30:00', '12:30:00']
        : ['13:00:00', '18:00:00'];

      const key = `admin_${periode}`;
      if (!siteRowsMap.has(key)) {
        siteRowsMap.set(key, {
          planning_id,
          date: single_day,
          site_id: null,
          heure_debut,
          heure_fin,
          secretaires_ids: [],
          type_assignation: 'administratif',
          statut: 'planifie'
        });
      }
      siteRowsMap.get(key).secretaires_ids.push(secId);
    }
  }

  const siteRows = Array.from(siteRowsMap.values());

  if (siteRows.length > 0) {
    const { error: siteError } = await supabase
      .from('planning_genere_site')
      .insert(siteRows);

    if (siteError) throw siteError;
  }

  if (remainingBlocRows.length > 0) {
    const { error: blocPersonnelError } = await supabase
      .from('planning_genere_bloc_personnel')
      .insert(remainingBlocRows);

    if (blocPersonnelError) throw blocPersonnelError;
  }

  return {
    sites_assigned: siteRows.length,
    remaining_bloc_filled: remainingBlocRows.length
  };
}
