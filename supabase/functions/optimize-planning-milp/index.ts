import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import solver from 'https://esm.sh/javascript-lp-solver@0.4.24';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

// Configuration hiérarchique des poids
const WEIGHT_SATISFACTION = 1000; // Priorité absolue
const PENALTY_SITE_CHANGE = 10;   // Priorité secondaire niveau 1
const PENALTY_ESPLANADE_BASE = 1; // Priorité secondaire niveau 2
const BONUS_PREFERE_ESPLANADE = -0.5; // Bonus (pénalité négative)

const ESPLANADE_SITE_ID = '043899a1-a232-4c4b-9d7d-0eb44dad00ad';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('🚀 Starting optimized MILP planning');
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Parse date range
    const { date_debut, date_fin } = await req.json().catch(() => ({}));
    const startDate = date_debut || new Date().toISOString().split('T')[0];
    const endDate = date_fin || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    console.log(`📊 Period: ${startDate} to ${endDate}`);

    // Fetch data in parallel
    const [
      { data: besoins, error: besoinError },
      { data: capacites, error: capaciteError },
      { data: secretaires, error: secretairesError },
      { data: backups, error: backupsError }
    ] = await Promise.all([
      supabase.from('besoin_effectif').select('*')
        .gte('date', startDate).lte('date', endDate).eq('actif', true),
      supabase.from('capacite_effective').select('*')
        .gte('date', startDate).lte('date', endDate).eq('actif', true),
      supabase.from('secretaires').select('id, prefere_port_en_truie').eq('actif', true),
      supabase.from('backup').select('id').eq('actif', true)
    ]);

    if (besoinError || capaciteError || secretairesError || backupsError) {
      throw new Error('Database fetch error');
    }

    console.log(`✓ ${besoins?.length || 0} besoins, ${capacites?.length || 0} capacités`);

    // Build data structures
    const capacitesMap = buildCapacitesMap(capacites, secretaires, backups);
    const besoinsMap = buildBesoinsMap(besoins);

    console.log(`✓ ${capacitesMap.size} capacités, ${besoinsMap.size} besoins`);

    // Build and solve MILP
    console.log('🧮 Building optimized MILP model...');
    const { model, stats } = buildOptimizedMILPModel(
      capacitesMap, 
      besoinsMap, 
      startDate, 
      endDate
    );

    console.log(`✓ ${stats.totalVars} variables, ${stats.totalConstraints} constraints`);
    console.log('⚡ Solving...');

    const solution = solver.Solve(model);

    if (!solution.feasible) {
      throw new Error('No feasible solution found');
    }

    console.log(`✅ Solution: objective = ${solution.result.toFixed(2)}`);

    // Parse results
    const results = parseResults(solution, capacitesMap, besoinsMap);
    
    // Calculate statistics
    const statistics = calculateStatistics(results, besoinsMap);
    
    console.log(`📊 Satisfaction: ${statistics.satisfaction_globale_pct}%`);
    console.log(`📊 Site changes: ${statistics.penalties.site_changes}`);
    console.log(`📊 Esplanade assignments: ${statistics.penalties.esplanade_total}`);

    // Save to database
    console.log('💾 Saving to planning_genere...');
    
    await supabase.from('planning_genere')
      .delete()
      .gte('date', startDate)
      .lte('date', endDate);

    const insertData = results.map(r => ({
      date: r.date,
      type: 'medecin',
      type_assignation: r.type === 'site' ? 'site' : 'administratif',
      site_id: r.type === 'site' ? r.site_id : null,
      heure_debut: r.demi_journee === 'matin' ? '07:30:00' : '13:00:00',
      heure_fin: r.demi_journee === 'matin' ? '12:00:00' : '17:00:00',
      medecins_ids: r.type === 'site' ? r.medecin_ids : [],
      secretaires_ids: r.secretaires_assignees.filter((id: string) => !id.startsWith('backup_')),
      backups_ids: r.secretaires_assignees
        .filter((id: string) => id.startsWith('backup_'))
        .map((id: string) => id.replace('backup_', '')),
      statut: 'planifie'
    }));

    const { error: insertError } = await supabase
      .from('planning_genere')
      .insert(insertData);

    if (insertError) throw insertError;

    console.log(`✅ Saved ${insertData.length} entries`);

    return new Response(JSON.stringify({
      success: true,
      stats: statistics,
      results: results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('❌ Error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

// ============================================================================
// DATA BUILDING FUNCTIONS
// ============================================================================

function buildCapacitesMap(capacites: any[], secretaires: any[], backups: any[]) {
  const map = new Map();
  const secretairesMap = new Map(
    secretaires.map((s: any) => [s.id, s.prefere_port_en_truie || false])
  );

  for (const cap of capacites) {
    const personId = cap.secretaire_id 
      ? cap.secretaire_id 
      : `backup_${cap.backup_id}`;

    if (!map.has(personId)) {
      map.set(personId, {
        id: personId,
        secretaire_id: cap.secretaire_id,
        backup_id: cap.backup_id,
        specialites: cap.specialites || [],
        prefere_port_en_truie: cap.secretaire_id 
          ? (secretairesMap.get(cap.secretaire_id) || false)
          : false,
        slots: []
      });
    }

    const data = map.get(personId);
    
    // Parse time slots into demi-journées
    const matinSlot = getTimeOverlap(cap.heure_debut, cap.heure_fin, '07:30:00', '12:00:00');
    const apresSlot = getTimeOverlap(cap.heure_debut, cap.heure_fin, '13:00:00', '17:00:00');

    if (matinSlot >= 1) {
      data.slots.push({ date: cap.date, demi_journee: 'matin' });
    }
    if (apresSlot >= 1) {
      data.slots.push({ date: cap.date, demi_journee: 'apres_midi' });
    }
  }

  return map;
}

function buildBesoinsMap(besoins: any[]) {
  const map = new Map();

  for (const besoin of besoins) {
    // Parse matin
    const matinOverlap = getTimeOverlap(
      besoin.heure_debut, besoin.heure_fin, '07:30:00', '12:00:00'
    );
    if (matinOverlap > 0) {
      const key = `${besoin.date}|matin|${besoin.site_id}|${besoin.specialite_id}`;
      if (!map.has(key)) {
        map.set(key, {
          date: besoin.date,
          demi_journee: 'matin',
          site_id: besoin.site_id,
          specialite_id: besoin.specialite_id,
          besoin: 0,
          medecin_ids: []
        });
      }
      const entry = map.get(key);
      const proportion = matinOverlap / 4.5;
      entry.besoin += besoin.nombre_secretaires_requis * proportion;
      if (besoin.medecin_id && !entry.medecin_ids.includes(besoin.medecin_id)) {
        entry.medecin_ids.push(besoin.medecin_id);
      }
    }

    // Parse apres_midi
    const apresOverlap = getTimeOverlap(
      besoin.heure_debut, besoin.heure_fin, '13:00:00', '17:00:00'
    );
    if (apresOverlap > 0) {
      const key = `${besoin.date}|apres_midi|${besoin.site_id}|${besoin.specialite_id}`;
      if (!map.has(key)) {
        map.set(key, {
          date: besoin.date,
          demi_journee: 'apres_midi',
          site_id: besoin.site_id,
          specialite_id: besoin.specialite_id,
          besoin: 0,
          medecin_ids: []
        });
      }
      const entry = map.get(key);
      const proportion = apresOverlap / 4.0;
      entry.besoin += besoin.nombre_secretaires_requis * proportion;
      if (besoin.medecin_id && !entry.medecin_ids.includes(besoin.medecin_id)) {
        entry.medecin_ids.push(besoin.medecin_id);
      }
    }
  }

  return map;
}

function getTimeOverlap(start1: string, end1: string, start2: string, end2: string) {
  const overlapStart = start1 > start2 ? start1 : start2;
  const overlapEnd = end1 < end2 ? end1 : end2;
  
  if (overlapStart >= overlapEnd) return 0;
  
  return (new Date(`2000-01-01T${overlapEnd}`).getTime() - 
          new Date(`2000-01-01T${overlapStart}`).getTime()) / (1000 * 60 * 60);
}

// ============================================================================
// OPTIMIZED MILP MODEL
// ============================================================================

function buildOptimizedMILPModel(capacitesMap: Map<string, any>, besoinsMap: Map<string, any>, startDate: string, endDate: string) {
  const model: any = {
    optimize: 'objective',
    opType: 'max',
    constraints: {},
    variables: {},
    ints: {}
  };

  let totalVars = 0;

  // Pre-calculate: which sites can each person work at for each date
  const personDateSites = new Map();
  for (const [personId, capData] of capacitesMap) {
    for (const slot of capData.slots) {
      const key = `${personId}_${slot.date}`;
      if (!personDateSites.has(key)) {
        personDateSites.set(key, { matin: new Set(), apres: new Set() });
      }
      
      const sites = personDateSites.get(key);
      
      // Find all sites this person could work at
      for (const spec of capData.specialites) {
        for (const [_, besoin] of besoinsMap) {
          if (besoin.date === slot.date && 
              besoin.demi_journee === slot.demi_journee && 
              besoin.specialite_id === spec) {
            if (slot.demi_journee === 'matin') {
              sites.matin.add(besoin.site_id);
            } else {
              sites.apres.add(besoin.site_id);
            }
          }
        }
      }
    }
  }

  // Count Esplanade assignments per person per week
  const weekKey = (date: string) => {
    const d = new Date(date);
    const weekNum = Math.floor((d.getTime() - new Date(startDate).getTime()) / (7 * 24 * 60 * 60 * 1000));
    return weekNum;
  };

  const esplanadeCounters = new Map(); // personId_week -> count

  // BUILD VARIABLES: x_{person}_{date}_{demi}_{site}_{spec}
  for (const [personId, capData] of capacitesMap) {
    for (const slot of capData.slots) {
      const date = slot.date;
      const demi = slot.demi_journee;

      for (const specialiteId of capData.specialites) {
        for (const [besoinKey, besoin] of besoinsMap) {
          if (besoin.date !== date || 
              besoin.demi_journee !== demi || 
              besoin.specialite_id !== specialiteId) {
            continue;
          }

          const varName = `x_${personId}_${date}_${demi}_${besoin.site_id}_${specialiteId}`;

          // ===== CONTRIBUTION À LA SATISFACTION (PRIORITÉ 1) =====
          // Contribution pondérée par besoin réel, plafonnée à 100%
          const ceilBesoin = Math.ceil(besoin.besoin);
          const satisfactionContribution = WEIGHT_SATISFACTION * (besoin.besoin / ceilBesoin);

          // ===== PÉNALITÉS (PRIORITÉ 2) =====
          let penalties = 0;

          // Pénalité 1: Changement de site le même jour
          const personDateKey = `${personId}_${date}`;
          const sitesInfo = personDateSites.get(personDateKey);
          
          if (sitesInfo) {
            const otherDemi = demi === 'matin' ? 'apres' : 'matin';
            const otherSites = demi === 'matin' ? sitesInfo.apres : sitesInfo.matin;
            
            // Si travaille l'autre demi-journée et sur un site différent
            if (otherSites.size > 0 && !otherSites.has(besoin.site_id)) {
              penalties += PENALTY_SITE_CHANGE;
            }
          }

          // Pénalité 2: Esplanade (progressive par semaine)
          if (besoin.site_id === ESPLANADE_SITE_ID) {
            const week = weekKey(date);
            const counterKey = `${personId}_${week}`;
            
            // Compter combien de fois déjà assigné à Esplanade cette semaine
            const currentCount = esplanadeCounters.get(counterKey) || 0;
            
            if (!capData.prefere_port_en_truie) {
              // Pénalité progressive: 1, 2, 3, 4...
              penalties += PENALTY_ESPLANADE_BASE * (1 + currentCount);
            } else {
              // Bonus pour les personnes qui préfèrent
              penalties += BONUS_PREFERE_ESPLANADE;
            }
            
            // Incrémenter le compteur
            esplanadeCounters.set(counterKey, currentCount + 1);
          }

          // CONTRIBUTION FINALE
          const contribution = satisfactionContribution - penalties;

          model.variables[varName] = {
            objective: contribution,
            [`unique_${personId}_${date}_${demi}`]: 1,
            [`capacity_${date}_${demi}_${besoin.site_id}_${specialiteId}`]: 1
          };

          model.ints[varName] = 1;
          totalVars++;
        }
      }
    }
  }

  // Variables administratives (fallback)
  for (const [personId, capData] of capacitesMap) {
    for (const slot of capData.slots) {
      const yVarName = `y_${personId}_${slot.date}_${slot.demi_journee}`;
      
      // Très petite contribution pour encourager l'utilisation
      model.variables[yVarName] = {
        objective: 0.000001,
        [`unique_${personId}_${slot.date}_${slot.demi_journee}`]: 1
      };
      
      model.ints[yVarName] = 1;
      totalVars++;
    }
  }

  // CONTRAINTE 1: Chaque capacité utilisée exactement une fois
  for (const [personId, capData] of capacitesMap) {
    for (const slot of capData.slots) {
      const constraintName = `unique_${personId}_${slot.date}_${slot.demi_journee}`;
      model.constraints[constraintName] = { equal: 1 };
    }
  }

  // CONTRAINTE 2: Max secretaires par besoin = ceil(besoin)
  for (const [key, besoin] of besoinsMap) {
    const maxCapacity = Math.ceil(besoin.besoin);
    const constraintName = `capacity_${besoin.date}_${besoin.demi_journee}_${besoin.site_id}_${besoin.specialite_id}`;
    model.constraints[constraintName] = { max: maxCapacity };
  }

  return {
    model,
    stats: {
      totalVars,
      totalConstraints: Object.keys(model.constraints).length
    }
  };
}

// ============================================================================
// RESULT PARSING
// ============================================================================

function parseResults(solution: any, capacitesMap: Map<string, any>, besoinsMap: Map<string, any>) {
  const results = [];
  const assignmentGroups = new Map();
  const adminGroups = new Map();
  
  let siteChanges = 0;
  let esplanadeTotal = 0;
  const esplanadePerPerson = new Map();

  for (const [varName, value] of Object.entries(solution)) {
    if (value !== 1 || typeof varName !== 'string') continue;

    if (varName.startsWith('x_')) {
      const parts = varName.split('_');
      if (parts.length >= 6) {
        const personId = parts[1];
        const date = parts[2];
        const demi = parts[3];
        const siteId = parts[4];
        const specialiteId = parts.slice(5).join('_');

        const key = `${date}|${demi}|${siteId}|${specialiteId}`;
        if (!assignmentGroups.has(key)) {
          assignmentGroups.set(key, []);
        }
        assignmentGroups.get(key).push(personId);

        if (siteId === ESPLANADE_SITE_ID) {
          esplanadeTotal++;
          esplanadePerPerson.set(personId, (esplanadePerPerson.get(personId) || 0) + 1);
        }
      }
    } else if (varName.startsWith('y_')) {
      const parts = varName.split('_');
      if (parts.length >= 4) {
        const personId = parts[1];
        const date = parts[2];
        const demi = parts[3];
        const key = `${date}|${demi}`;
        if (!adminGroups.has(key)) {
          adminGroups.set(key, []);
        }
        adminGroups.get(key).push(personId);
      }
    }
  }

  // Site assignments
  for (const [key, besoin] of besoinsMap) {
    const assigned = assignmentGroups.get(key) || [];
    results.push({
      date: besoin.date,
      demi_journee: besoin.demi_journee,
      site_id: besoin.site_id,
      specialite_id: besoin.specialite_id,
      besoin: Math.round(besoin.besoin * 100) / 100,
      besoin_ceil: Math.ceil(besoin.besoin),
      secretaires_assignees: assigned,
      medecin_ids: besoin.medecin_ids,
      type: 'site',
      satisfaction_pct: Math.min((assigned.length / besoin.besoin) * 100, 100)
    });
  }

  // Administrative assignments
  for (const [key, persons] of adminGroups) {
    const [date, demi] = key.split('|');
    results.push({
      date,
      demi_journee: demi,
      secretaires_assignees: persons,
      medecin_ids: [],
      type: 'administratif'
    });
  }

  return results;
}

function calculateStatistics(results: any[], besoinsMap: Map<string, any>) {
  let totalBesoin = 0;
  let totalAssigned = 0;

  for (const result of results) {
    if (result.type === 'site') {
      totalBesoin += result.besoin;
      totalAssigned += result.secretaires_assignees.length;
    }
  }

  const satisfactionGlobalePct = totalBesoin > 0
    ? Math.min((totalAssigned / totalBesoin) * 100, 100)
    : 0;

  return {
    total_entries: results.length,
    total_besoin: Math.round(totalBesoin * 100) / 100,
    total_assigned: totalAssigned,
    satisfaction_globale_pct: Math.round(satisfactionGlobalePct),
    penalties: {
      site_changes: 0, // À calculer si nécessaire
      esplanade_total: 0, // À calculer si nécessaire
    }
  };
}