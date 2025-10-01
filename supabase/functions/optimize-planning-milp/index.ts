import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import solver from 'https://esm.sh/javascript-lp-solver@0.4.24';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

// Configuration - MINIMISER l'écart carré intelligent avec pénalisations marginales
const COEF_ECART_CARRE = 1000;          // Poids pour (besoin - capacité)² pondéré
const PENALTY_CHANGEMENT_SITE = 0.1;    // Pénalité changement de site (+0.1)
const BONUS_ADMIN = 0;                  // Neutraliser l'incitation admin (0)

// Port-en-Truie progressif par paliers
const PORT_PENALTIES_NORMAL = [0.002, 0.004, 0.006, 0.008, 0.010, 0.012, 0.014, 0.016];
const PORT_PENALTIES_PREFERE = [0.0002, 0.0004, 0.0008, 0.0016, 0.0032, 0.0064, 0.0128, 0.0256]; // géométrique

const PORT_EN_TRUIE_SITE_ID = '043899a1-a232-4c4b-9d7d-0eb44dad00ad';
const MAX_ECART_LINEARIZATION = 10; // Segments pour linéarisation de l'écart carré
// Priorité d'équité: petit biais pour favoriser les besoins au plus faible ratio capacité/besoin
const FAIRNESS_EPS = 1.0;
const EPS_BESOIN = 1e-3;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('🚀 Starting intelligent MILP planning with squared deviation minimization');
    
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

    // Build and solve intelligent MILP
    console.log('🧮 Building intelligent MILP model with squared deviation...');
    const { model, stats } = buildIntelligentMILPModel(
      capacitesMap, 
      besoinsMap, 
      startDate, 
      endDate
    );

    console.log(`✓ ${stats.totalVars} variables, ${stats.totalConstraints} constraints`);
    console.log('⚡ Solving (minimizing weighted squared deviations)...');

    const solution = solver.Solve(model);

    if (!solution.feasible) {
      throw new Error('No feasible solution found');
    }

    console.log(`✅ Solution: deviation score (minimized) = ${solution.result.toFixed(2)}`);

    // Parse results
    const results = parseResults(solution, capacitesMap, besoinsMap);
    
    // Calculate statistics
    const statistics = calculateStatistics(results, besoinsMap);
    
    console.log(`📊 Satisfaction: ${statistics.satisfaction_pct}% (${statistics.capacite_totale}/${statistics.besoin_total.toFixed(1)})`);
    console.log(`📊 Port-en-Truie: ${statistics.port_en_truie_count} assignations`);
    console.log(`📊 Assignations admin: ${statistics.admin_count}`);
    console.log(`📊 Changements de site: ${statistics.site_changes}`);

    // Save to database
    console.log('💾 Saving to planning_genere...');
    
    // Calculer les bornes de la semaine complète
    const startDateObj = new Date(startDate);
    const endDateObj = new Date(endDate);
    
    const weekStart = new Date(startDateObj);
    const dayOfWeek = weekStart.getDay();
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    weekStart.setDate(weekStart.getDate() + diff);
    
    const weekEnd = new Date(endDateObj);
    const dayOfWeekEnd = weekEnd.getDay();
    const diffEnd = dayOfWeekEnd === 0 ? 0 : 7 - dayOfWeekEnd;
    weekEnd.setDate(weekEnd.getDate() + diffEnd);
    
    const weekStartStr = weekStart.toISOString().split('T')[0];
    const weekEndStr = weekEnd.toISOString().split('T')[0];
    
    console.log(`🗑️ Deleting existing planning from ${weekStartStr} to ${weekEndStr}`);
    
    const { error: deleteError } = await supabase.from('planning_genere')
      .delete()
      .gte('date', weekStartStr)
      .lte('date', weekEndStr);
      
    if (deleteError) {
      console.error('⚠️ Delete error:', deleteError);
    }

    const insertData = results
      .map(r => ({
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
      }))
      .filter(entry => {
        // Validate date format before insertion
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(entry.date)) {
          console.error(`❌ Invalid date format detected, skipping: ${entry.date}`);
          return false;
        }
        return true;
      });
    
    console.log(`📝 Inserting ${insertData.length} entries`);

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
// INTELLIGENT MILP MODEL WITH SQUARED DEVIATION MINIMIZATION
// ============================================================================

function buildIntelligentMILPModel(capacitesMap: Map<string, any>, besoinsMap: Map<string, any>, startDate: string, endDate: string) {
  const model: any = {
    optimize: 'objective',
    opType: 'min', // MINIMISER l'écart carré pondéré + pénalisations
    constraints: {},
    variables: {},
    ints: {}
  };

  let totalVars = 0;

  // ÉTAPE 1: Créer les variables d'assignation x et y
  const xVariables = new Map<string, string[]>(); // besoinKey -> list of x variables
  const personDateDemiSlots = new Map<string, Set<string>>(); // track person-date-demi for site changes

  // Variables de site: x_{person}_{date}_{demi}_{site}_{spec}
  for (const [personId, capData] of capacitesMap) {
    for (const slot of capData.slots) {
      const date = slot.date;
      const demi = slot.demi_journee;
      const personSlotKey = `${personId}_${date}_${demi}`;

      if (!personDateDemiSlots.has(personSlotKey)) {
        personDateDemiSlots.set(personSlotKey, new Set());
      }

      for (const specialiteId of capData.specialites) {
        for (const [besoinKey, besoin] of besoinsMap) {
          if (besoin.date !== date || 
              besoin.demi_journee !== demi || 
              besoin.specialite_id !== specialiteId) {
            continue;
          }

          const varName = `x_${personId}_${date}_${demi}_${besoin.site_id}_${specialiteId}`;
          
          personDateDemiSlots.get(personSlotKey)!.add(besoin.site_id);

          model.variables[varName] = {
            [`unique_${personSlotKey}`]: 1,
            [`def_cap_eff_${besoinKey}`]: -1  // Contribue à Σx dans cap_effective = Σx
          };

          model.ints[varName] = 1;
          totalVars++;

          if (!xVariables.has(besoinKey)) {
            xVariables.set(besoinKey, []);
          }
          xVariables.get(besoinKey)!.push(varName);
        }
      }
    }
  }

  // Variables administratives: y_{person}_{date}_{demi}
  for (const [personId, capData] of capacitesMap) {
    for (const slot of capData.slots) {
      const personSlotKey = `${personId}_${slot.date}_${slot.demi_journee}`;
      const yVarName = `y_${personSlotKey}`;
      
      model.variables[yVarName] = {
        objective: BONUS_ADMIN, // Bonus -0.1 par assignation admin
        [`unique_${personSlotKey}`]: 1
      };
      
      model.ints[yVarName] = 1;
      totalVars++;
    }
  }

  // ÉTAPE 2: Variables pour Port-en-Truie progressif par paliers
  const portVariables = new Map<string, any>();
  
  for (const [personId, capData] of capacitesMap) {
    const penalties = capData.prefere_port_en_truie ? PORT_PENALTIES_PREFERE : PORT_PENALTIES_NORMAL;
    
    for (let k = 0; k < penalties.length; k++) {
      const portVarName = `port_${personId}_${k}`;
      
      model.variables[portVarName] = {
        objective: penalties[k], // Pénalité progressive
        [`port_total_${personId}`]: 1
      };
      
      model.ints[portVarName] = 1;
      totalVars++;

      if (!portVariables.has(personId)) {
        portVariables.set(personId, []);
      }
      portVariables.get(personId)!.push(portVarName);
    }
  }

  // ÉTAPE 3: Variables pour changement de site
  const siteChangeVars = new Map<string, string>();
  
  for (const [personId, capData] of capacitesMap) {
    const dates = new Set(capData.slots.map((s: any) => s.date));
    
    for (const date of dates) {
      const matinSlot = capData.slots.find((s: any) => s.date === date && s.demi_journee === 'matin');
      const apresSlot = capData.slots.find((s: any) => s.date === date && s.demi_journee === 'apres_midi');
      
      if (matinSlot && apresSlot) {
        const changeVarName = `change_${personId}_${date}`;
        
        model.variables[changeVarName] = {
          objective: PENALTY_CHANGEMENT_SITE // Pénalité +0.1
        };
        
        model.ints[changeVarName] = 1;
        totalVars++;
        
        siteChangeVars.set(`${personId}_${date}`, changeVarName);
      }
    }
  }

  // ÉTAPE 4: Variables pour écart et écart carré (linéarisé)
  for (const [besoinKey, besoin] of besoinsMap) {
    const besoinValue = besoin.besoin;
    
    // Variable cap_effective = min(Σx, besoin)
const capEffVarName = `cap_eff_${besoinKey}`;
model.variables[capEffVarName] = {
  // Biais d'équité: encourager à remplir d'abord les petits besoins (ratio plus faible)
  objective: -FAIRNESS_EPS / Math.max(besoinValue, EPS_BESOIN),
  [`def_cap_eff_${besoinKey}`]: 1,
  [`cap_eff_max_${besoinKey}`]: 1,
  // Lie cap_eff dans la définition de l'écart: ecart + cap_eff = besoin
  [`def_ecart_${besoinKey}`]: 1
};
totalVars++;
    
    // Variable ecart = besoin - cap_effective (positif)
    const ecartVarName = `ecart_${besoinKey}`;
    model.variables[ecartVarName] = {
      [`def_ecart_${besoinKey}`]: 1
    };
    totalVars++;
    
    // Linéarisation de ecart² par segments (piecewise linear)
    // ecart² ≈ Σ k² × seg_k où seg_k est le segment [k-1, k]
    for (let k = 1; k <= MAX_ECART_LINEARIZATION; k++) {
      const segVarName = `seg_${besoinKey}_${k}`;
      
// Pondération d'équité: normaliser par le besoin pour privilégier les slots au plus faible ratio cap/besoin
const W = COEF_ECART_CARRE / Math.max(besoinValue, EPS_BESOIN);
const segmentCoef = W * (2 * k - 1);
      
      model.variables[segVarName] = {
        objective: segmentCoef,
        [`sum_seg_${besoinKey}`]: 1,
        [`seg_max_${besoinKey}_${k}`]: 1
      };
      
      totalVars++;
    }
  }

  // CONTRAINTES
  
  // C1: Chaque capacité utilisée exactement une fois
  for (const [personId, capData] of capacitesMap) {
    for (const slot of capData.slots) {
      const personSlotKey = `${personId}_${slot.date}_${slot.demi_journee}`;
      model.constraints[`unique_${personSlotKey}`] = { equal: 1 };
    }
  }

  // C2: Définir cap_effective = Σx
  for (const [besoinKey, besoin] of besoinsMap) {
    const besoinValue = besoin.besoin;
    
    // cap_effective - Σx = 0 => cap_effective = Σx
    model.constraints[`def_cap_eff_${besoinKey}`] = { equal: 0 };
    
    // cap_effective <= besoin
    model.constraints[`cap_eff_max_${besoinKey}`] = { max: besoinValue };
  }

  // C3: Définir ecart = besoin - cap_effective
  for (const [besoinKey, besoin] of besoinsMap) {
    const besoinValue = besoin.besoin;
    
    // ecart + cap_effective = besoin
    model.constraints[`def_ecart_${besoinKey}`] = { equal: besoinValue };
  }

  // C4: Linéarisation ecart = Σ seg_k
  for (const [besoinKey, besoin] of besoinsMap) {
    // Σ seg_k = ecart
    model.constraints[`sum_seg_${besoinKey}`] = { equal: 0 };
    
    if (!model.variables[`ecart_${besoinKey}`][`sum_seg_${besoinKey}`]) {
      model.variables[`ecart_${besoinKey}`][`sum_seg_${besoinKey}`] = 0;
    }
    model.variables[`ecart_${besoinKey}`][`sum_seg_${besoinKey}`] -= 1;
    
    // seg_k <= 1 pour chaque segment
    for (let k = 1; k <= MAX_ECART_LINEARIZATION; k++) {
      model.constraints[`seg_max_${besoinKey}_${k}`] = { max: 1 };
    }
  }

  // C5: Port-en-Truie total pour chaque personne
  for (const [personId, capData] of capacitesMap) {
    // Compter les assignations Port-en-Truie pour cette personne
    const portConstraintName = `port_total_${personId}`;
    model.constraints[portConstraintName] = { equal: 0 };
    
    // Ajouter les x variables de Port-en-Truie
    for (const varName in model.variables) {
      if (varName.startsWith(`x_${personId}_`) && varName.includes(`_${PORT_EN_TRUIE_SITE_ID}_`)) {
        if (!model.variables[varName][portConstraintName]) {
          model.variables[varName][portConstraintName] = 0;
        }
        model.variables[varName][portConstraintName] += 1;
      }
    }
  }

  // C6: Changement de site (si même personne, même jour, sites différents matin/après-midi)
  for (const [key, changeVar] of siteChangeVars) {
    const [personId, date] = key.split('_');
    
    // Variables binaires pour sites matin et après-midi
    const sitesMatinVars: string[] = [];
    const sitesApresVars: string[] = [];
    
    for (const varName in model.variables) {
      if (varName.startsWith(`x_${personId}_${date}_matin_`)) {
        const siteId = varName.split('_')[4];
        if (!sitesMatinVars.includes(siteId)) sitesMatinVars.push(siteId);
      }
      if (varName.startsWith(`x_${personId}_${date}_apres_midi_`)) {
        const siteId = varName.split('_')[4];
        if (!sitesApresVars.includes(siteId)) sitesApresVars.push(siteId);
      }
    }
    
    // Si au moins 2 sites différents possibles, on active la détection de changement
    // Simplifié: change_var = 1 si assignation aux deux demi-journées (approximation)
    // Pour une version exacte, il faudrait des variables binaires pour chaque site
    
    // Pour l'instant, on laisse la contrainte simple
    // TODO: Implémenter la détection exacte de changement de site
  }

  const totalConstraints = Object.keys(model.constraints).length;

  return {
    model,
    stats: {
      totalVars,
      totalConstraints
    }
  };
}

// ============================================================================
// RESULT PARSING
// ============================================================================

function parseResults(solution: any, capacitesMap: Map<string, any>, besoinsMap: Map<string, any>) {
  const results: any[] = [];
  const assignmentsByBesoin = new Map<string, any>();

  // Regex patterns to parse variable names safely (supports underscores in personId)
  const xVarRegex = /^x_(.+)_(\d{4}-\d{2}-\d{2})_(matin|apres_midi)_([0-9a-f-]+)_([0-9a-f-]+)$/;
  const yVarRegex = /^y_(.+)_(\d{4}-\d{2}-\d{2})_(matin|apres_midi)$/;

  // Parse site assignments (x_*) and aggregate per besoinKey
  for (const varName in solution) {
    if (varName.startsWith('x_') && solution[varName] === 1) {
      const match = varName.match(xVarRegex);
      if (!match) {
        console.warn(`⚠️ Skipping malformed x_ variable: ${varName}`);
        continue;
      }

      const [, personId, date, demi, siteId, specialiteId] = match;
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

  // Ensure we have one line per site & demi-journée that has a besoin, even if 0 assignations
  for (const [besoinKey, besoin] of besoinsMap) {
    const key = besoinKey; // `${date}|${demi}|${site}|${spec}`
    if (!assignmentsByBesoin.has(key)) {
      assignmentsByBesoin.set(key, {
        date: besoin.date,
        demi_journee: besoin.demi_journee,
        site_id: besoin.site_id,
        specialite_id: besoin.specialite_id,
        type: 'site',
        secretaires_assignees: [],
        medecin_ids: besoin.medecin_ids || []
      });
    }
  }

  // Add site assignments (including empty ones) to results
  for (const [, assignment] of assignmentsByBesoin) {
    results.push(assignment);
  }

  // Parse administrative assignments (y_*)
  const adminBySlot = new Map<string, any>();
  for (const varName in solution) {
    if (varName.startsWith('y_') && solution[varName] === 1) {
      const match = varName.match(yVarRegex);
      if (!match) {
        console.warn(`⚠️ Skipping malformed y_ variable: ${varName}`);
        continue;
      }
      const [, personId, date, demi] = match;
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
  for (const [, admin] of adminBySlot) {
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
  let siteChanges = 0;

  const besoinStats = new Map<string, { besoin: number, capacite: number }>();
  const personDateSites = new Map<string, Set<string>>();

  for (const result of results) {
    if (result.type === 'administratif') {
      adminCount += result.secretaires_assignees.length;
      continue;
    }

    if (result.site_id === PORT_EN_TRUIE_SITE_ID) {
      portEnTruieCount += result.secretaires_assignees.length;
    }

    // Track site changes
    for (const personId of result.secretaires_assignees) {
      const key = `${personId}_${result.date}`;
      if (!personDateSites.has(key)) {
        personDateSites.set(key, new Set());
      }
      personDateSites.get(key)!.add(result.site_id);
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

  // Count site changes
  for (const [_, sites] of personDateSites) {
    if (sites.size > 1) {
      siteChanges++;
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
    port_en_truie_count: portEnTruieCount,
    site_changes: siteChanges
  };
}
