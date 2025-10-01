import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import solver from 'https://esm.sh/javascript-lp-solver@0.4.24';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const SITE_PORT_EN_TRUIE = '043899a1-a232-4c4b-9d7d-0eb44dad00ad';

const DEMI_JOURNEE_SLOTS = {
  matin: { start: '07:30:00', end: '12:00:00' },
  apres_midi: { start: '13:00:00', end: '17:00:00' }
};

// Poids pour l'objectif
const WEIGHTS = {
  satisfaction: 10000,      // Priorité absolue: minimiser écart au carré
  changement_site: 50,      // Pénalité si changement site matin/après-midi
  port_en_truie: 10         // Pénalité légère pour Port-en-Truie
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('🚀 Starting simplified MILP planning optimization');
    
    const supabaseServiceRole = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Parse date range from request
    const { date_debut, date_fin } = await req.json().catch(() => ({}));
    const startDate = date_debut || new Date().toISOString().split('T')[0];
    const endDate = date_fin || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    console.log(`📊 Period: ${startDate} to ${endDate}`);

    // 1. Récupérer les données
    console.log('📥 Fetching data...');
    const { data: capacites, error: capError } = await supabaseServiceRole
      .from('capacite_effective')
      .select('*')
      .gte('date', startDate)
      .lte('date', endDate)
      .eq('actif', true);
    
    if (capError) {
      console.error('❌ Error fetching capacités:', capError);
      throw capError;
    }

    const { data: besoins, error: besError } = await supabaseServiceRole
      .from('besoin_effectif')
      .select('*')
      .gte('date', startDate)
      .lte('date', endDate)
      .eq('actif', true);
    
    if (besError) {
      console.error('❌ Error fetching besoins:', besError);
      throw besError;
    }

    console.log(`✓ ${capacites.length} capacités, ${besoins.length} besoins`);

    // 2. Agréger par (date, site, demi_journee, specialite)
    const capacitesAgg = aggregateCapacites(capacites);
    const besoinsAgg = aggregateBesoins(besoins);

    console.log(`✓ Aggregated to ${capacitesAgg.size} capacity groups, ${besoinsAgg.size} besoin groups`);

    // 3. Construire et résoudre le modèle MILP
    const { model, stats } = buildOptimizationModel(capacitesAgg, besoinsAgg);
    
    console.log(`🧮 Model: ${stats.totalVars} variables, ${stats.totalConstraints} constraints`);
    if (stats?.relaxed) {
      console.log('ℹ️ Using LP relaxation (no integer constraints) for performance.');
    }
    console.log('⚡ Solving optimization problem...');
    
    const startTime = Date.now();
    const solution = solver.Solve(model);
    const solveTime = Date.now() - startTime;
    
    console.log(`⏱️ Solved in ${solveTime}ms`);

    if (!solution.feasible) {
      console.error('❌ Problem is infeasible');
      throw new Error('Problem is infeasible - no valid solution found');
    }

    console.log(`✅ Solution found with objective: ${solution.result?.toFixed(2)}`);
    
    // Debug: Log solution variables
    console.log('🔍 Debug: Solution variables');
    let xCount = 0;
    let xValueOne = 0;
    for (const [varName, value] of Object.entries(solution)) {
      if (varName.startsWith('x_')) {
        xCount++;
        if (value === 1) xValueOne++;
      }
    }
    console.log(`  Total x_ variables in solution: ${xCount}`);
    console.log(`  x_ variables with value=1: ${xValueOne}`);
    console.log(`  Solution feasible: ${solution.feasible}`);
    console.log(`  Solution bounded: ${solution.bounded ?? 'unknown'}`);

    // 4. Parser les résultats
    const assignments = parseAssignments(solution, capacitesAgg, besoinsAgg);

    // 5. Sauvegarder dans la base
    console.log('💾 Saving assignments...');
    
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
    
    // Supprimer les anciennes assignations
    const { error: deleteError } = await supabaseServiceRole
      .from('planning_genere')
      .delete()
      .gte('date', weekStartStr)
      .lte('date', weekEndStr);
    
    if (deleteError) {
      console.error('⚠️ Delete error:', deleteError);
    }

    // Insérer les nouvelles
    if (assignments.length > 0) {
      const { error: insertError } = await supabaseServiceRole
        .from('planning_genere')
        .insert(assignments);
      
      if (insertError) {
        console.error('❌ Error inserting assignments:', insertError);
        throw insertError;
      }
    }

    console.log(`✅ Saved ${assignments.length} assignments`);

    // Statistiques
    const stats_result = calculateStats(assignments, besoinsAgg);

    return new Response(JSON.stringify({
      success: true,
      stats: stats_result,
      assignments: assignments.length,
      solve_time_ms: solveTime
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

function aggregateCapacites(capacites: any[]) {
  const map = new Map();

  for (const cap of capacites) {
    const isSecretary = cap.secretaire_id != null;
    const personId = isSecretary ? cap.secretaire_id : cap.backup_id;
    
    if (!personId) continue;

    for (const specialite of cap.specialites || []) {
      // Déterminer demi-journées
      const demiJournees = getDemiJournees(cap.heure_debut, cap.heure_fin);
      
      for (const dj of demiJournees) {
        const key = `${cap.date}|${dj}|${specialite}`;
        
        if (!map.has(key)) {
          map.set(key, {
            date: cap.date,
            demi_journee: dj,
            specialite_id: specialite,
            personnes: []
          });
        }
        
        map.get(key).personnes.push({
          person_id: personId,
          is_secretary: isSecretary,
          capacite_id: cap.id
        });
      }
    }
  }

  return map;
}

function aggregateBesoins(besoins: any[]) {
  const map = new Map();

  for (const besoin of besoins) {
    const demiJournees = getDemiJournees(besoin.heure_debut, besoin.heure_fin);
    
    for (const dj of demiJournees) {
      const key = `${besoin.date}|${besoin.site_id}|${dj}|${besoin.specialite_id}`;
      
      if (!map.has(key)) {
        map.set(key, {
          date: besoin.date,
          site_id: besoin.site_id,
          demi_journee: dj,
          specialite_id: besoin.specialite_id,
          besoin: 0,
          medecin_ids: [],
          type: besoin.type
        });
      }
      
      // Proportion de la demi-journée couverte
      const proportion = calculateOverlap(besoin.heure_debut, besoin.heure_fin, dj);
      const entry = map.get(key);
      entry.besoin += parseFloat(besoin.nombre_secretaires_requis) * proportion;
      
      if (besoin.medecin_id && !entry.medecin_ids.includes(besoin.medecin_id)) {
        entry.medecin_ids.push(besoin.medecin_id);
      }
    }
  }

  return map;
}

function getDemiJournees(debut: string, fin: string): string[] {
  const djs = [];
  
  // Overlap avec matin
  if (debut < '12:00:00' && fin > '07:30:00') {
    djs.push('matin');
  }
  
  // Overlap avec après-midi
  if (debut < '17:00:00' && fin > '13:00:00') {
    djs.push('apres_midi');
  }
  
  return djs;
}

function calculateOverlap(debut: string, fin: string, dj: string): number {
  const djSlot = DEMI_JOURNEE_SLOTS[dj as keyof typeof DEMI_JOURNEE_SLOTS];
  const overlapStart = debut > djSlot.start ? debut : djSlot.start;
  const overlapEnd = fin < djSlot.end ? fin : djSlot.end;
  
  if (overlapStart >= overlapEnd) return 0;
  
  const overlapMs = new Date(`2000-01-01T${overlapEnd}`).getTime() - 
                    new Date(`2000-01-01T${overlapStart}`).getTime();
  const totalMs = new Date(`2000-01-01T${djSlot.end}`).getTime() - 
                  new Date(`2000-01-01T${djSlot.start}`).getTime();
  
  return Math.max(0, Math.min(1, overlapMs / totalMs));
}

function buildOptimizationModel(capacitesAgg: Map<string, any>, besoinsAgg: Map<string, any>) {
  const model: any = {
    optimize: 'objective',
    opType: 'min',
    constraints: {},
    variables: {},
    ints: {}
  };

  let totalVars = 0;
  let totalConstraints = 0;
  let xVarCount = 0;
  let relaxed = false;
  const personSitesByDate = new Map(); // Pour détecter changements de site

  // Variables: x_{person}_{date}_{site}_{dj}_{spec}
  // = 1 si personne assignée à (date, site, dj, spec)
  
  for (const [besoinKey, besoin] of besoinsAgg) {
    const capKey = `${besoin.date}|${besoin.demi_journee}|${besoin.specialite_id}`;
    const capacite = capacitesAgg.get(capKey);
    
    if (!capacite) continue;

    for (const person of capacite.personnes) {
      const varName = `x_${person.person_id}_${besoin.date}_${besoin.site_id}_${besoin.demi_journee}_${besoin.specialite_id}`;
      
      // Contribution à la capacité du besoin
      const besoinConstraint = `besoin_${besoinKey}`;
      
      model.variables[varName] = {
        objective: 0,
        [`def_ecart_${besoinKey}`]: 1, // Contribue à satisfaire le besoin
        [`cap_${person.person_id}_${besoin.date}_${besoin.demi_journee}`]: 1
      };
      
      // Pénalité Port-en-Truie
      if (besoin.site_id === SITE_PORT_EN_TRUIE) {
        model.variables[varName].objective += WEIGHTS.port_en_truie;
      }
      
      // Tracking pour changement de site
      const dateKey = `${person.person_id}_${besoin.date}`;
      if (!personSitesByDate.has(dateKey)) {
        personSitesByDate.set(dateKey, new Set());
      }
      personSitesByDate.get(dateKey).add(besoin.site_id);
      
      model.ints[varName] = 1;
      xVarCount++;
      totalVars++;
    }
  }

  // Si trop de variables entières, on bascule en relaxation LP pour éviter les timeouts
  if (xVarCount > 220) {
    console.log(`⚠️ Large model detected with ${xVarCount} integer x vars - switching to LP relaxation`);
    model.ints = {}; // remove integer constraints
    relaxed = true;
  }

  // Contrainte 1: Chaque personne affectée max 1 fois par (date, demi_journee)
  const personDateDj = new Set();
  for (const varName of Object.keys(model.variables)) {
    const parts = varName.split('_');
    const personId = parts[1];
    const date = parts[2];
    const dj = parts[4];
    personDateDj.add(`${personId}_${date}_${dj}`);
  }
  
  for (const key of personDateDj) {
    model.constraints[`cap_${key}`] = { max: 1 };
    totalConstraints++;
  }

  // Contrainte 2: Pour chaque besoin, on veut que la capacité assignée soit <= besoin
  // On crée aussi des variables d'écart pour pénaliser les besoins non satisfaits
  for (const [besoinKey, besoin] of besoinsAgg) {
    const besoinValue = besoin.besoin; // Garder la valeur réelle (peut être décimale)
    
    // Variable d'écart (représente le manque de capacité)
    const ecartVarName = `ecart_${besoinKey}`;
    model.variables[ecartVarName] = {
      objective: WEIGHTS.satisfaction * Math.max(1, besoinValue), // Pénalité proportionnelle au besoin
      [`def_ecart_${besoinKey}`]: 1
    };
    totalVars++;
    
    // Contrainte: Σx + ecart >= besoin (on veut satisfaire le besoin)
    // Réécrit comme: Σx + ecart = besoin (pour simplifier)
    model.constraints[`def_ecart_${besoinKey}`] = { equal: besoinValue };
    totalConstraints++;
  }

  // Pénalité changement de site (si matin et après-midi sur sites différents)
  for (const [dateKey, sites] of personSitesByDate) {
    if (sites.size > 1) {
      // Ajouter une pénalité dans l'objectif pour les variables de l'après-midi
      const [personId, date] = dateKey.split('_');
      for (const varName of Object.keys(model.variables)) {
        if (varName.includes(`_${personId}_${date}_`) && varName.includes('_apres_midi_')) {
          model.variables[varName].objective = 
            (model.variables[varName].objective || 0) + WEIGHTS.changement_site;
        }
      }
    }
  }

  return { model, stats: { totalVars, totalConstraints, xVars: xVarCount, relaxed } };
}

function parseAssignments(solution: any, capacitesAgg: Map<string, any>, besoinsAgg: Map<string, any>) {
  const assignments: any[] = [];
  const djToTime = {
    matin: { heure_debut: '07:30:00', heure_fin: '12:00:00' },
    apres_midi: { heure_debut: '13:00:00', heure_fin: '17:00:00' }
  };

  console.log('🔍 Debug parseAssignments:');
  console.log(`  Solution keys: ${Object.keys(solution).length}`);
  
  // Debug: show first few solution entries
  let count = 0;
  for (const [key, value] of Object.entries(solution)) {
    if (count < 5) {
      console.log(`  ${key}: ${value}`);
      count++;
    }
  }

  // Build besoin info map
  const besoinInfo = new Map<string, any>();
  for (const [key, besoin] of besoinsAgg) {
    besoinInfo.set(key, {
      max: Math.ceil(besoin.besoin || 0),
      assigned: 0,
      type: besoin.type,
      medecin_ids: besoin.medecin_ids || []
    });
  }

  type Candidate = {
    varName: string;
    value: number;
    personId: string;
    date: string;
    siteId: string;
    dj: string;
    specId: string;
    besoinKey: string;
    times: { heure_debut: string; heure_fin: string };
  };

  const candidates: Candidate[] = [];
  let hasBinary = false;

  for (const [varName, value] of Object.entries(solution)) {
    if (typeof value !== 'number') continue;
    if (!varName.startsWith('x_') || value <= 0) continue;

    const parts = varName.split('_');
    const personId = parts[1];
    const date = parts[2];
    const siteId = parts[3];
    const dj = parts[4];
    const specId = parts.slice(5).join('_');
    const times = djToTime[dj as keyof typeof djToTime];
    const besoinKey = `${date}|${siteId}|${dj}|${specId}`;

    if (!times) continue;

    candidates.push({
      varName,
      value,
      personId,
      date,
      siteId,
      dj,
      specId,
      besoinKey,
      times
    });

    if (value === 1) hasBinary = true;
  }

  if (hasBinary) {
    // Use strict MILP selections
    for (const c of candidates) {
      if (c.value !== 1) continue;
      const info = besoinInfo.get(c.besoinKey);
      assignments.push({
        date: c.date,
        site_id: c.siteId,
        type: 'secretaire',
        heure_debut: c.times.heure_debut,
        heure_fin: c.times.heure_fin,
        secretaires_ids: [c.personId],
        backups_ids: [],
        medecins_ids: info?.medecin_ids || [],
        type_assignation: 'site',
        statut: 'planifie'
      });
    }
  } else {
    // LP relaxation fallback: greedy rounding
    candidates.sort((a, b) => b.value - a.value);
    const usedPersonDj = new Set<string>();

    for (const c of candidates) {
      const info = besoinInfo.get(c.besoinKey);
      if (!info || info.max <= 0) continue;
      if (info.assigned >= info.max) continue;

      const usedKey = `${c.personId}|${c.date}|${c.dj}`;
      if (usedPersonDj.has(usedKey)) continue;

      assignments.push({
        date: c.date,
        site_id: c.siteId,
        type: 'secretaire',
        heure_debut: c.times.heure_debut,
        heure_fin: c.times.heure_fin,
        secretaires_ids: [c.personId],
        backups_ids: [],
        medecins_ids: info.medecin_ids || [],
        type_assignation: 'site',
        statut: 'planifie'
      });

      usedPersonDj.add(usedKey);
      info.assigned++;
    }
  }

  return assignments;
}

function calculateStats(assignments: any[], besoinsAgg: Map<string, any>) {
  let totalBesoins = 0;
  let totalAssignments = 0;
  let satisfait = 0;
  let partiel = 0;
  let nonSatisfait = 0;

  // Calculer par besoin
  for (const [besoinKey, besoin] of besoinsAgg) {
    const besoinValue = besoin.besoin;
    totalBesoins += besoinValue;
    
    // Compter les assignations pour ce besoin
    const [date, siteId, dj, specId] = besoinKey.split('|');
    const assigned = assignments.filter(a => 
      a.date === date && 
      a.site_id === siteId && 
      a.heure_debut === DEMI_JOURNEE_SLOTS[dj as keyof typeof DEMI_JOURNEE_SLOTS].start &&
      a.secretaires_ids.some((sid: string) => sid) // Au moins une secrétaire
    ).length;
    
    totalAssignments += assigned;
    
    if (assigned >= Math.ceil(besoinValue)) {
      satisfait++;
    } else if (assigned > 0) {
      partiel++;
    } else {
      nonSatisfait++;
    }
  }

  return {
    total_besoins: Math.round(totalBesoins * 10) / 10,
    total_assignments: totalAssignments,
    satisfaction_rate: totalBesoins > 0 
      ? ((totalAssignments / totalBesoins) * 100).toFixed(1) + '%' 
      : '0%',
    satisfait,
    partiel,
    non_satisfait: nonSatisfait
  };
}
