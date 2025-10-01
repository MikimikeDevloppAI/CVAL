import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import solver from 'https://esm.sh/javascript-lp-solver@0.4.24';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

// Configuration - Nouvelle formulation: MINIMISER écart quadratique + pénalités
const COEF_ECART_QUADRATIQUE = 1000; // Poids pour l'écart quadratique (objectif principal)
const COEF_ADMIN_BONUS = -0.1;       // Bonus pour affectation administrative (négatif car minimisation)
const COEF_CHANGEMENT_SITE = 0.01;   // Pénalité changement de site matin/après-midi
const COEF_PORT_EN_TRUIE_BASE = 0.002; // Pénalité de base Port-en-Truie (progression linéaire)
const COEF_PORT_EN_TRUIE_PREFERE_BASE = 0.0002; // Pénalité de base si préférence (progression géométrique)

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

    console.log(`✅ Solution: objective (minimized) = ${solution.result.toFixed(2)}`);

    // Parse results
    const parseResult = parseResults(solution, capacitesMap, besoinsMap);
    const results = parseResult.results;
    
    // Calculate statistics
    const statistics = calculateStatistics(results, besoinsMap, parseResult.penalties);
    
    console.log(`📊 Écart quadratique total: ${statistics.ecart_quadratique_total.toFixed(2)}`);
    console.log(`📊 Satisfaction globale: ${statistics.satisfaction_globale_pct}%`);
    console.log(`📊 Port-en-Truie: ${statistics.penalties.port_en_truie_total} assignations`);
    console.log(`📊 Changements de site: ${statistics.penalties.site_changes}`);
    console.log(`📊 Assignations admin: ${statistics.admin_assignments}`);

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
    opType: 'min', // MINIMISER l'écart quadratique + pénalités
    constraints: {},
    variables: {},
    ints: {}
  };

  let totalVars = 0;
  let siteVars = 0;
  let adminVars = 0;
  let matinCount = 0;
  let apresMidiCount = 0;

  // Track Port-en-Truie assignments per person across the period (for progressive penalty)
  const portEnTruieAssignments = new Map<string, number>();
  
  // Track site assignments per person per date for change detection
  const personDateSites = new Map<string, Map<string, Set<string>>>(); // personId -> date -> Set<sites>
  
  // Pre-calculate possible sites for each person per date and demi-journée
  for (const [personId, capData] of capacitesMap) {
    if (!personDateSites.has(personId)) {
      personDateSites.set(personId, new Map());
    }
    const personDates = personDateSites.get(personId)!;
    
    for (const slot of capData.slots) {
      const dateKey = `${slot.date}_${slot.demi_journee}`;
      if (!personDates.has(dateKey)) {
        personDates.set(dateKey, new Set());
      }
      const sites = personDates.get(dateKey)!;
      
      for (const spec of capData.specialites) {
        for (const [_, besoin] of besoinsMap) {
          if (besoin.date === slot.date && 
              besoin.demi_journee === slot.demi_journee && 
              besoin.specialite_id === spec) {
            sites.add(besoin.site_id);
          }
        }
      }
    }
  }

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

          // TERME 2: Pénalité Port-en-Truie progressive
          if (besoin.site_id === PORT_EN_TRUIE_SITE_ID) {
            const currentCount = portEnTruieAssignments.get(personId) || 0;
            
            if (capData.prefere_port_en_truie) {
              // Progression géométrique: 0.0002, 0.0004, 0.0008, 0.0016...
              const penalty = COEF_PORT_EN_TRUIE_PREFERE_BASE * Math.pow(2, currentCount);
              objectiveCoef += penalty;
            } else {
              // Progression linéaire: 0.002, 0.004, 0.006, 0.008...
              const penalty = COEF_PORT_EN_TRUIE_BASE * (currentCount + 1);
              objectiveCoef += penalty;
            }
            
            portEnTruieAssignments.set(personId, currentCount + 1);
          }

          // TERME 3: Pénalité changement de site matin/après-midi
          const personDates = personDateSites.get(personId);
          if (personDates) {
            const otherDemiKey = demi === 'matin' 
              ? `${date}_apres_midi` 
              : `${date}_matin`;
            const otherSites = personDates.get(otherDemiKey);
            
            if (otherSites && otherSites.size > 0 && !otherSites.has(besoin.site_id)) {
              objectiveCoef += COEF_CHANGEMENT_SITE;
            }
          }

          model.variables[varName] = {
            objective: objectiveCoef,
            [`unique_${personId}_${date}_${demi}`]: 1,
            [`def_total_${besoinKey}`]: -1  // Contribue -1 pour que total = Σ x
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
  // TERME 4: Bonus pour affectation administrative (-0.1)
  for (const [personId, capData] of capacitesMap) {
    for (const slot of capData.slots) {
      const yVarName = `y_${personId}_${slot.date}_${slot.demi_journee}`;
      
      model.variables[yVarName] = {
        objective: COEF_ADMIN_BONUS, // Négatif: réduit l'objectif (bonus)
        [`unique_${personId}_${slot.date}_${slot.demi_journee}`]: 1
      };
      
      model.ints[yVarName] = 1;
      totalVars++;
      adminVars++;
    }
  }

  // Variables auxiliaires pour l'écart et sa pénalité quadratique
  // Approche simplifiée: on pénalise linéairement l'écart, avec un poids élevé
  for (const [besoinKey, besoin] of besoinsMap) {
    const besoinReel = besoin.besoin;
    
    // Variable total_{besoinKey}: somme des assignations
    // Contrainte: total = Σ x_variables (définie par def_total)
    const totalVarName = `total_${besoinKey}`;
    model.variables[totalVarName] = {
      objective: 0,
      [`def_total_${besoinKey}`]: 1  // Contribue +1 pour que total = Σ x
    };
    // total n'est pas limité (peut dépasser besoin théoriquement)
    totalVars++;
    
    // Variable capacite_{besoinKey}: min(total, besoin)
    // Contraintes: capacite <= total ET capacite <= besoin
    const capaciteVarName = `capacite_${besoinKey}`;
    model.variables[capaciteVarName] = {
      objective: 0,
      [`cap_vs_total_${besoinKey}`]: 1,     // capacite <= total
      [`cap_vs_besoin_${besoinKey}`]: 1,    // capacite <= besoin
      [`def_ecart_${besoinKey}`]: 1         // ecart = besoin - capacite
    };
    totalVars++;
    
    // Variable ecart_{besoinKey}: besoin - capacite
    // Cette variable sera pénalisée dans l'objectif
    const ecartVarName = `ecart_${besoinKey}`;
    
    // Pour approximer (ecart + 1)², on utilise une pénalité linéaire forte
    // Approximation: (x+1)² ≈ 2x + 1 + x/2 pour x petit
    // On va utiliser un coefficient élevé pour pénaliser fortement
    const penaliteEcart = COEF_ECART_QUADRATIQUE * (2 + besoinReel * 0.5);
    
    model.variables[ecartVarName] = {
      objective: penaliteEcart,  // TERME 1: Pénalité pour écart
      [`def_ecart_${besoinKey}`]: -1  // ecart = besoin - capacite
    };
    totalVars++;
  }

  // CONTRAINTE 1: Chaque capacité utilisée exactement une fois
  for (const [personId, capData] of capacitesMap) {
    for (const slot of capData.slots) {
      const constraintName = `unique_${personId}_${slot.date}_${slot.demi_journee}`;
      model.constraints[constraintName] = { equal: 1 };
    }
  }

  // CONTRAINTE 2: Définition de total_{besoinKey} = Σ x_variables
  // total - Σ x = 0, donc total = Σ x
  for (const [besoinKey, besoin] of besoinsMap) {
    model.constraints[`def_total_${besoinKey}`] = { equal: 0 };
  }

  // CONTRAINTE 3: capacite_{besoinKey} <= total_{besoinKey}
  for (const [besoinKey, besoin] of besoinsMap) {
    model.constraints[`cap_vs_total_${besoinKey}`] = { max: 0 };
  }

  // CONTRAINTE 4: capacite_{besoinKey} <= besoin
  for (const [besoinKey, besoin] of besoinsMap) {
    const besoinReel = besoin.besoin;
    model.constraints[`cap_vs_besoin_${besoinKey}`] = { max: besoinReel };
  }

  // CONTRAINTE 5: Définition de ecart = besoin - capacite
  for (const [besoinKey, besoin] of besoinsMap) {
    const besoinReel = besoin.besoin;
    model.constraints[`def_ecart_${besoinKey}`] = { equal: besoinReel };
  }

  return {
    model,
    stats: {
      totalVars,
      siteVars,
      adminVars,
      matinCount,
      apresMidiCount,
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
  let portEnTruieTotal = 0;
  const portEnTruiePerPerson = new Map();

  // Regex patterns for parsing variable names
  const xVarRegex = /^x_(?<person>[^_]+)_(?<date>\d{4}-\d{2}-\d{2})_(?<demi>matin|apres_midi)_(?<site>[0-9a-f-]+)_(?<spec>.+)$/;
  const yVarRegex = /^y_(?<person>[^_]+)_(?<date>\d{4}-\d{2}-\d{2})_(?<demi>matin|apres_midi)$/;

  for (const [varName, value] of Object.entries(solution)) {
    if (value !== 1 || typeof varName !== 'string') continue;

    if (varName.startsWith('x_')) {
      const match = varName.match(xVarRegex);
      if (match && match.groups) {
        const personId = match.groups.person;
        const date = match.groups.date;
        const demi = match.groups.demi;
        const siteId = match.groups.site;
        const specialiteId = match.groups.spec;

        const key = `${date}|${demi}|${siteId}|${specialiteId}`;
        if (!assignmentGroups.has(key)) {
          assignmentGroups.set(key, []);
        }
        assignmentGroups.get(key).push(personId);

        if (siteId === PORT_EN_TRUIE_SITE_ID) {
          portEnTruieTotal++;
          portEnTruiePerPerson.set(personId, (portEnTruiePerPerson.get(personId) || 0) + 1);
        }
      }
    } else if (varName.startsWith('y_')) {
      const match = varName.match(yVarRegex);
      if (match && match.groups) {
        const personId = match.groups.person;
        const date = match.groups.date;
        const demi = match.groups.demi;
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

  // Administrative assignments with medecin_ids from besoinsMap
  for (const [key, persons] of adminGroups) {
    const [date, demi] = key.split('|');
    
    // Aggregate medecin_ids for this date+demi from besoinsMap
    const medecinIds: string[] = [];
    for (const [_, besoin] of besoinsMap) {
      if (besoin.date === date && besoin.demi_journee === demi) {
        for (const medecinId of besoin.medecin_ids) {
          if (!medecinIds.includes(medecinId)) {
            medecinIds.push(medecinId);
          }
        }
      }
    }
    
    results.push({
      date,
      demi_journee: demi,
      secretaires_assignees: persons,
      medecin_ids: medecinIds,
      type: 'administratif'
    });
  }

  return { 
    results,
    penalties: {
      siteChanges,
      portEnTruieTotal,
      portEnTruiePerPerson
    }
  };
}

function calculateStatistics(results: any[], besoinsMap: Map<string, any>, penalties: any) {
  let totalBesoin = 0;
  let totalAssigned = 0;
  let ecartQuadratiqueTotal = 0;
  let adminAssignments = 0;

  for (const result of results) {
    if (result.type === 'site') {
      totalBesoin += result.besoin;
      const assigned = result.secretaires_assignees.length;
      totalAssigned += assigned;
      
      // Calculer l'écart: (besoin - min(assigned, besoin) + 1)²
      const capaciteAssignee = Math.min(assigned, result.besoin);
      const ecart = result.besoin - capaciteAssignee + 1;
      ecartQuadratiqueTotal += ecart * ecart;
    } else if (result.type === 'administratif') {
      adminAssignments += result.secretaires_assignees.length;
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
    ecart_quadratique_total: ecartQuadratiqueTotal,
    admin_assignments: adminAssignments,
    penalties: {
      site_changes: penalties.siteChanges,
      port_en_truie_total: penalties.portEnTruieTotal,
      port_en_truie_per_person: Object.fromEntries(penalties.portEnTruiePerPerson)
    }
  };
}