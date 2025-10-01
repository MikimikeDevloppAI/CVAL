import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import solver from 'https://esm.sh/javascript-lp-solver@0.4.24';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

// Configuration - MAXIMISER le score de satisfaction
const COEF_SATISFACTION = 1000;      // Poids pour capacité/besoin (objectif principal)
const COEF_ADMIN_BONUS = 0.001;      // Bonus administratif marginal (divisé par 1000)
const COEF_PORT_EN_TRUIE = -0.01;    // Pénalité Port-en-Truie (diminue le score)
const COEF_CHANGEMENT_SITE = -0.005; // Pénalité changement de site (diminue le score)

const PORT_EN_TRUIE_SITE_ID = '043899a1-a232-4c4b-9d7d-0eb44dad00ad';

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

    console.log(`✓ ${stats.totalVars} variables (${stats.siteVars} site, ${stats.adminVars} admin), ${stats.totalConstraints} constraints`);
    console.log(`📊 Assignments by period: ${stats.matinCount} matin, ${stats.apresMidiCount} apres_midi`);
    console.log('⚡ Solving...');

    const solution = solver.Solve(model);

    if (!solution.feasible) {
      throw new Error('No feasible solution found');
    }

    console.log(`✅ Solution: score (maximized) = ${solution.result.toFixed(2)}`);

    // Parse results
    const results = parseResults(solution, capacitesMap, besoinsMap);
    
    // Calculate statistics
    const statistics = calculateStatistics(results, besoinsMap);
    
    console.log(`📊 Satisfaction: ${statistics.satisfaction_pct}% (${statistics.capacite_totale}/${statistics.besoin_total.toFixed(1)})`);
    console.log(`📊 Port-en-Truie: ${statistics.port_en_truie_count} assignations`);
    console.log(`📊 Assignations admin: ${statistics.admin_count}`);

    // Save to database
    console.log('💾 Saving to planning_genere...');
    
    // Calculer les bornes de la semaine complète pour supprimer toutes les données
    const startDateObj = new Date(startDate);
    const endDateObj = new Date(endDate);
    
    // Trouver le lundi de la semaine de startDate
    const weekStart = new Date(startDateObj);
    const dayOfWeek = weekStart.getDay();
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Si dimanche (0), reculer de 6 jours
    weekStart.setDate(weekStart.getDate() + diff);
    
    // Trouver le dimanche de la semaine de endDate
    const weekEnd = new Date(endDateObj);
    const dayOfWeekEnd = weekEnd.getDay();
    const diffEnd = dayOfWeekEnd === 0 ? 0 : 7 - dayOfWeekEnd;
    weekEnd.setDate(weekEnd.getDate() + diffEnd);
    
    const weekStartStr = weekStart.toISOString().split('T')[0];
    const weekEndStr = weekEnd.toISOString().split('T')[0];
    
    console.log(`🗑️ Deleting existing planning from ${weekStartStr} to ${weekEndStr}`);
    
    // Supprimer toutes les entrées de la semaine complète
    const { error: deleteError } = await supabase.from('planning_genere')
      .delete()
      .gte('date', weekStartStr)
      .lte('date', weekEndStr);
      
    if (deleteError) {
      console.error('⚠️ Delete error:', deleteError);
    }

    const insertData = results.map(r => ({
      date: r.date,
      type: 'medecin',
      type_assignation: r.type === 'site' ? 'site' : 'administratif',
      site_id: r.type === 'site' ? r.site_id : null,
      heure_debut: r.demi_journee === 'matin' ? '07:30:00' : '13:00:00',
      heure_fin: r.demi_journee === 'matin' ? '12:00:00' : '17:00:00',
      medecins_ids: r.medecin_ids || [],
      secretaires_ids: r.secretaires_assignees.filter((id: string) => !id.startsWith('backup_')),
      backups_ids: r.secretaires_assignees
        .filter((id: string) => id.startsWith('backup_'))
        .map((id: string) => id.replace('backup_', '')),
      statut: 'planifie'
    }));
    
    console.log(`📝 Inserting ${insertData.length} entries (${insertData.filter(d => d.type_assignation === 'site').length} site, ${insertData.filter(d => d.type_assignation === 'administratif').length} admin)`);

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
    opType: 'max', // MAXIMISER le score de satisfaction
    constraints: {},
    variables: {},
    ints: {}
  };

  let totalVars = 0;
  let siteVars = 0;
  let adminVars = 0;
  let matinCount = 0;
  let apresMidiCount = 0;

  // BUILD VARIABLES FOR SITE ASSIGNMENTS: x_{person}_{date}_{demi}_{site}_{spec}
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

          let objectiveCoef = 0;

          // Pénalité Port-en-Truie (diminue le score sauf si préféré)
          if (besoin.site_id === PORT_EN_TRUIE_SITE_ID && !capData.prefere_port_en_truie) {
            objectiveCoef += COEF_PORT_EN_TRUIE;
          }

          model.variables[varName] = {
            objective: objectiveCoef,
            [`unique_${personId}_${date}_${demi}`]: 1,
            [`besoin_${besoinKey}`]: 1  // Compte pour le besoin
          };

          model.ints[varName] = 1;
          totalVars++;
          siteVars++;
          
          if (demi === 'matin') matinCount++;
          else apresMidiCount++;
        }
      }
    }
  }

  // Variables administratives: y_{person}_{date}_{demi}
  for (const [personId, capData] of capacitesMap) {
    for (const slot of capData.slots) {
      const yVarName = `y_${personId}_${slot.date}_${slot.demi_journee}`;
      
      model.variables[yVarName] = {
        objective: COEF_ADMIN_BONUS, // Bonus marginal
        [`unique_${personId}_${slot.date}_${slot.demi_journee}`]: 1
      };
      
      model.ints[yVarName] = 1;
      totalVars++;
      adminVars++;
    }
  }

  // Variables pour le score: capacite/besoin pour chaque besoin
  for (const [besoinKey, besoin] of besoinsMap) {
    const besoinValue = besoin.besoin;
    
    // Variable capacite_{besoinKey} représente min(capacité assignée, besoin)
    const capaciteVarName = `cap_${besoinKey}`;
    
    // Le coefficient dans l'objectif est COEF_SATISFACTION / besoin
    // pour que capacite/besoin * COEF_SATISFACTION donne le bon poids
    const scoreCoef = COEF_SATISFACTION / besoinValue;
    
    model.variables[capaciteVarName] = {
      objective: scoreCoef,  // Maximiser capacité/besoin
      [`def_cap_${besoinKey}`]: 1,     // capacite = min(Σx, besoin)
      [`cap_max_${besoinKey}`]: 1      // capacite <= besoin
    };
    
    // Ajouter les x_variables avec coefficient -1 pour la définition
    for (const varName in model.variables) {
      if (varName.startsWith('x_') && model.variables[varName][`besoin_${besoinKey}`]) {
        if (!model.variables[varName][`def_cap_${besoinKey}`]) {
          model.variables[varName][`def_cap_${besoinKey}`] = 0;
        }
        model.variables[varName][`def_cap_${besoinKey}`] -= 1;
      }
    }
    
    totalVars++;
  }

  // CONTRAINTE 1: Chaque capacité utilisée exactement une fois
  for (const [personId, capData] of capacitesMap) {
    for (const slot of capData.slots) {
      const constraintName = `unique_${personId}_${slot.date}_${slot.demi_journee}`;
      model.constraints[constraintName] = { equal: 1 };
    }
  }

  // CONTRAINTE 2: Pour chaque besoin, définir capacite et plafond
  for (const [besoinKey, besoin] of besoinsMap) {
    const besoinValue = besoin.besoin;
    
    // def_cap: capacite = Σ x_variables (définie par les coefficients ci-dessus)
    model.constraints[`def_cap_${besoinKey}`] = { equal: 0 };
    
    // cap_max: capacite <= besoin
    model.constraints[`cap_max_${besoinKey}`] = { max: besoinValue };
  }

  const totalConstraints = Object.keys(model.constraints).length;

  return {
    model,
    stats: {
      totalVars,
      siteVars,
      adminVars,
      totalConstraints,
      matinCount,
      apresMidiCount
    }
  };
}

// ============================================================================
// RESULT PARSING
// ============================================================================

function parseResults(solution: any, capacitesMap: Map<string, any>, besoinsMap: Map<string, any>) {
  const results: any[] = [];
  const assignmentsByBesoin = new Map<string, any>();

  // Parse site assignments
  for (const varName in solution) {
    if (varName.startsWith('x_') && solution[varName] === 1) {
      const [_, personId, date, demi, siteId, specialiteId] = varName.split('_');
      
      const besoinKey = `${date}|${demi}|${siteId}|${specialiteId}`;
      const besoin = besoinsMap.get(besoinKey);
      
      if (!assignmentsByBesoin.has(besoinKey)) {
        assignmentsByBesoin.set(besoinKey, {
          date,
          demi_journee: demi,
          site_id: siteId,
          specialite_id: specialiteId,
          type: 'site',
          secretaires_assignees: [],
          medecin_ids: besoin?.medecin_ids || []
        });
      }
      
      assignmentsByBesoin.get(besoinKey).secretaires_assignees.push(personId);
    }
  }

  // Add site assignments to results
  for (const [_, assignment] of assignmentsByBesoin) {
    results.push(assignment);
  }

  // Parse administrative assignments
  const adminBySlot = new Map<string, any>();
  
  for (const varName in solution) {
    if (varName.startsWith('y_') && solution[varName] === 1) {
      const [_, personId, date, demi] = varName.split('_');
      const slotKey = `${date}|${demi}`;
      
      if (!adminBySlot.has(slotKey)) {
        adminBySlot.set(slotKey, {
          date,
          demi_journee: demi,
          type: 'administratif',
          secretaires_assignees: [],
          medecin_ids: []
        });
      }
      
      adminBySlot.get(slotKey).secretaires_assignees.push(personId);
    }
  }

  // Add administrative assignments to results
  for (const [_, admin] of adminBySlot) {
    results.push(admin);
  }

  return results;
}

// ============================================================================
// STATISTICS CALCULATION
// ============================================================================

function calculateStatistics(results: any[], besoinsMap: Map<string, any>) {
  let capaciteTotale = 0;
  let besoinTotal = 0;
  let adminCount = 0;
  let portEnTruieCount = 0;

  const besoinStats = new Map<string, { besoin: number, capacite: number }>();

  for (const result of results) {
    if (result.type === 'administratif') {
      adminCount += result.secretaires_assignees.length;
      continue;
    }

    if (result.site_id === PORT_EN_TRUIE_SITE_ID) {
      portEnTruieCount += result.secretaires_assignees.length;
    }

    const besoinKey = `${result.date}|${result.demi_journee}|${result.site_id}|${result.specialite_id}`;
    const besoin = besoinsMap.get(besoinKey);
    
    if (besoin) {
      if (!besoinStats.has(besoinKey)) {
        besoinStats.set(besoinKey, { besoin: besoin.besoin, capacite: 0 });
      }
      besoinStats.get(besoinKey)!.capacite += result.secretaires_assignees.length;
    }
  }

  for (const [_, stats] of besoinStats) {
    const capacite = Math.min(stats.capacite, stats.besoin);
    capaciteTotale += capacite;
    besoinTotal += stats.besoin;
  }

  const satisfactionPct = besoinTotal > 0 
    ? Math.round((capaciteTotale / besoinTotal) * 100) 
    : 100;

  return {
    satisfaction_pct: satisfactionPct,
    capacite_totale: Math.round(capaciteTotale * 10) / 10,
    besoin_total: besoinTotal,
    admin_count: adminCount,
    port_en_truie_count: portEnTruieCount
  };
}
