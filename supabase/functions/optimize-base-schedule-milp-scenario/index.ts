import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
//@ts-ignore
import solver from 'https://cdn.jsdelivr.net/npm/javascript-lp-solver@0.4.24/prod/solver.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface FictionalDoctor {
  id: string;
  name: string;
  specialite_id: string;
  horaires: Array<{
    jour_semaine: number;
    demi_journee?: 'matin' | 'apres_midi';
    heure_debut: string;
    heure_fin: string;
  }>;
  besoin_secretaires: number;
}

interface FictionalSecretary {
  id: string;
  name: string;
  specialites: string[];
  horaires: Array<{
    jour_semaine: number;
    heure_debut: string;
    heure_fin: string;
  }>;
}

interface WhatIfScenario {
  fictionalDoctors: FictionalDoctor[];
  fictionalSecretaries: FictionalSecretary[];
}

type DemiJournee = 'matin' | 'apres_midi';

interface SecretaireData {
  id: string;
  nom: string;
  specialites: string[];
  creneaux: Map<string, boolean>; // key = "jour|demi"
}

interface BesoinData {
  jour_semaine: number;
  demi_journee: DemiJournee;
  specialite_id: string;
  specialite_nom: string;
  besoin: number; // in secretary units
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseServiceRole = createClient(supabaseUrl, supabaseServiceRoleKey);

    const body = await req.json();
    const scenario: WhatIfScenario = body.scenario;

    console.log('🎬 Starting MILP optimization with what-if scenario...');
    console.log(`   📋 Fictional doctors: ${scenario.fictionalDoctors.length}`);
    console.log(`   📋 Fictional secretaries: ${scenario.fictionalSecretaries.length}`);

    // 1. Fetch real data
    const { data: secretaires, error: secError } = await supabaseServiceRole
      .from('secretaires')
      .select('id, name, first_name, specialites, actif')
      .eq('actif', true);
    if (secError) throw secError;

    const { data: horairesSecretaires, error: hsError } = await supabaseServiceRole
      .from('horaires_base_secretaires')
      .select('*')
      .eq('actif', true);
    if (hsError) throw hsError;

    const { data: medecins, error: medError } = await supabaseServiceRole
      .from('medecins')
      .select('id, name, first_name, specialite_id, besoin_secretaires, actif')
      .eq('actif', true);
    if (medError) throw medError;

    const { data: horairesMedecins, error: hmError } = await supabaseServiceRole
      .from('horaires_base_medecins')
      .select('*, medecins!inner(specialite_id, besoin_secretaires)')
      .eq('actif', true);
    if (hmError) throw hmError;

    const { data: specialites, error: specError } = await supabaseServiceRole
      .from('specialites')
      .select('id, nom');
    if (specError) throw specError;

    const specialitesMap = new Map(specialites.map(s => [s.id, s.nom]));

    console.log(`📊 Real data: ${secretaires.length} secretaries, ${medecins.length} doctors`);

    // 2. Build maps with real + fictional data
    const secretairesMap = buildSecretairesMapWithFictional(
      secretaires,
      horairesSecretaires,
      scenario.fictionalSecretaries
    );
    
    const besoinsMap = buildBesoinsMapWithFictional(
      medecins,
      horairesMedecins,
      scenario.fictionalDoctors,
      specialitesMap
    );

    let matinCount = 0;
    let apresMidiCount = 0;
    for (const [_, sec] of secretairesMap) {
      for (const [creneau, dispo] of sec.creneaux) {
        if (dispo) {
          if (creneau.includes('matin')) matinCount++;
          if (creneau.includes('apres_midi')) apresMidiCount++;
        }
      }
    }
    console.log(`   📊 Total available slots: ${matinCount} morning, ${apresMidiCount} afternoon`);
    
    let matinBesoins = 0;
    let apresMidiBesoins = 0;
    for (const [_, besoin] of besoinsMap) {
      if (besoin.demi_journee === 'matin') matinBesoins++;
      if (besoin.demi_journee === 'apres_midi') apresMidiBesoins++;
    }
    console.log(`   📊 Needs: ${matinBesoins} morning groups, ${apresMidiBesoins} afternoon groups`);

    // 3. Build and solve MILP
    console.log('🧮 Building MILP model...');
    const { model, stats } = buildMILPModel(secretairesMap, besoinsMap);
    
    console.log(`   📊 Variables: ${stats.totalVars} (${stats.matinVars} morning, ${stats.apresMidiVars} afternoon)`);
    console.log(`   📊 Constraints: ${stats.totalConstraints}`);
    
    console.log('⚡ Solving MILP...');
    const solution = solver.Solve(model);

    if (!solution.feasible) {
      throw new Error('MILP problem is infeasible');
    }

    console.log(`✅ Solution found with objective: ${solution.result}`);

    // 4. Parse results
    const results = parseResults(solution, secretairesMap, besoinsMap);
    
    let matinAssignments = 0;
    let apresMidiAssignments = 0;
    for (const r of results) {
      if (r.demi_journee === 'matin') matinAssignments += r.capacites_assignees;
      if (r.demi_journee === 'apres_midi') apresMidiAssignments += r.capacites_assignees;
    }
    console.log(`   📊 Assignments: ${matinAssignments} morning, ${apresMidiAssignments} afternoon`);

    // 5. Calculate summary stats
    const totalAssignments = results.reduce((sum, r) => sum + r.capacites_assignees, 0);
    const totalBesoins = results.reduce((sum, r) => sum + r.besoins, 0);
    const satisfactionRate = totalBesoins > 0 ? (totalAssignments / totalBesoins) * 100 : 0;

    const response = {
      success: true,
      stats: {
        total_groups: results.length,
        total_assignments: totalAssignments,
        total_besoins: Math.ceil(totalBesoins),
        satisfaction_rate: satisfactionRate.toFixed(1) + '%',
        objective_value: solution.result,
      },
      results: results,
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('❌ Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function buildSecretairesMapWithFictional(
  realSecretaires: any[],
  realHoraires: any[],
  fictionalSecretaries: FictionalSecretary[]
): Map<string, SecretaireData> {
  const map = new Map<string, SecretaireData>();

  // Add real secretaries
  for (const sec of realSecretaires) {
    const creneaux = new Map<string, boolean>();
    for (let jour = 1; jour <= 5; jour++) {
      creneaux.set(`${jour}|matin`, false);
      creneaux.set(`${jour}|apres_midi`, false);
    }

    const secHoraires = realHoraires.filter(h => h.secretaire_id === sec.id);
    for (const h of secHoraires) {
      const debut = parseTime(h.heure_debut);
      const fin = parseTime(h.heure_fin);
      
      const matin = { debut: parseTime('07:30'), fin: parseTime('12:00') };
      const apresMidi = { debut: parseTime('13:00'), fin: parseTime('17:00') };
      
      const overlapMatin = Math.max(0, Math.min(fin, matin.fin) - Math.max(debut, matin.debut));
      const overlapApresMidi = Math.max(0, Math.min(fin, apresMidi.fin) - Math.max(debut, apresMidi.debut));
      
      if (overlapMatin >= 60) {
        creneaux.set(`${h.jour_semaine}|matin`, true);
      }
      if (overlapApresMidi >= 60) {
        creneaux.set(`${h.jour_semaine}|apres_midi`, true);
      }
    }

    map.set(sec.id, {
      id: sec.id,
      nom: `${sec.first_name || ''} ${sec.name || ''}`.trim() || 'Sans nom',
      specialites: sec.specialites || [],
      creneaux,
    });
  }

  // Add fictional secretaries
  for (const fictionalSec of fictionalSecretaries) {
    const creneaux = new Map<string, boolean>();
    for (let jour = 1; jour <= 5; jour++) {
      creneaux.set(`${jour}|matin`, false);
      creneaux.set(`${jour}|apres_midi`, false);
    }

    for (const h of fictionalSec.horaires) {
      const debut = parseTime(h.heure_debut);
      const fin = parseTime(h.heure_fin);
      
      const matin = { debut: parseTime('07:30'), fin: parseTime('12:00') };
      const apresMidi = { debut: parseTime('13:00'), fin: parseTime('17:00') };
      
      const overlapMatin = Math.max(0, Math.min(fin, matin.fin) - Math.max(debut, matin.debut));
      const overlapApresMidi = Math.max(0, Math.min(fin, apresMidi.fin) - Math.max(debut, apresMidi.debut));
      
      if (overlapMatin >= 60) {
        creneaux.set(`${h.jour_semaine}|matin`, true);
      }
      if (overlapApresMidi >= 60) {
        creneaux.set(`${h.jour_semaine}|apres_midi`, true);
      }
    }

    map.set(fictionalSec.id, {
      id: fictionalSec.id,
      nom: fictionalSec.name,
      specialites: fictionalSec.specialites,
      creneaux,
    });
  }

  return map;
}

function buildBesoinsMapWithFictional(
  realMedecins: any[],
  realHoraires: any[],
  fictionalDoctors: FictionalDoctor[],
  specialitesMap: Map<string, string>
): Map<string, BesoinData> {
  const besoinsAggregated = new Map<string, number>();

  // Process real doctors
  for (const h of realHoraires) {
    const medecin = realMedecins.find(m => m.id === h.medecin_id);
    if (!medecin) continue;

    const debut = parseTime(h.heure_debut);
    const fin = parseTime(h.heure_fin);
    
    const matin = { debut: parseTime('07:30'), fin: parseTime('12:00') };
    const apresMidi = { debut: parseTime('13:00'), fin: parseTime('17:00') };
    
    const overlapMatin = Math.max(0, Math.min(fin, matin.fin) - Math.max(debut, matin.debut));
    const overlapApresMidi = Math.max(0, Math.min(fin, apresMidi.fin) - Math.max(debut, apresMidi.debut));
    
    const specId = medecin.specialite_id;
    const besoinSec = medecin.besoin_secretaires || 1.2;
    
    if (overlapMatin >= 30) {
      const key = `${h.jour_semaine}|matin|${specId}`;
      const proportionMatin = overlapMatin / ((matin.fin - matin.debut) || 1);
      besoinsAggregated.set(key, (besoinsAggregated.get(key) || 0) + (besoinSec * proportionMatin));
    }
    if (overlapApresMidi >= 30) {
      const key = `${h.jour_semaine}|apres_midi|${specId}`;
      const proportionAM = overlapApresMidi / ((apresMidi.fin - apresMidi.debut) || 1);
      besoinsAggregated.set(key, (besoinsAggregated.get(key) || 0) + (besoinSec * proportionAM));
    }
  }

  // Process fictional doctors
  for (const doctor of fictionalDoctors) {
    for (const h of doctor.horaires) {
      const debut = parseTime(h.heure_debut);
      const fin = parseTime(h.heure_fin);
      
      const matin = { debut: parseTime('07:30'), fin: parseTime('12:00') };
      const apresMidi = { debut: parseTime('13:00'), fin: parseTime('17:00') };
      
      const overlapMatin = Math.max(0, Math.min(fin, matin.fin) - Math.max(debut, matin.debut));
      const overlapApresMidi = Math.max(0, Math.min(fin, apresMidi.fin) - Math.max(debut, apresMidi.debut));
      
      const specId = doctor.specialite_id;
      const besoinSec = doctor.besoin_secretaires;
      
      // If demi_journee specified, only process that period
      if (!h.demi_journee || h.demi_journee === 'matin') {
        if (overlapMatin >= 30) {
          const key = `${h.jour_semaine}|matin|${specId}`;
          const proportionMatin = overlapMatin / ((matin.fin - matin.debut) || 1);
          besoinsAggregated.set(key, (besoinsAggregated.get(key) || 0) + (besoinSec * proportionMatin));
        }
      }
      
      if (!h.demi_journee || h.demi_journee === 'apres_midi') {
        if (overlapApresMidi >= 30) {
          const key = `${h.jour_semaine}|apres_midi|${specId}`;
          const proportionAM = overlapApresMidi / ((apresMidi.fin - apresMidi.debut) || 1);
          besoinsAggregated.set(key, (besoinsAggregated.get(key) || 0) + (besoinSec * proportionAM));
        }
      }
    }
  }

  const besoinsMap = new Map<string, BesoinData>();
  for (const [key, besoin] of besoinsAggregated) {
    const [jourStr, demi, specId] = key.split('|');
    besoinsMap.set(key, {
      jour_semaine: parseInt(jourStr),
      demi_journee: demi as DemiJournee,
      specialite_id: specId,
      specialite_nom: specialitesMap.get(specId) || 'Inconnue',
      besoin,
    });
  }

  return besoinsMap;
}

function parseTime(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function buildMILPModel(
  secretairesMap: Map<string, SecretaireData>,
  besoinsMap: Map<string, BesoinData>
) {
  const model: any = {
    optimize: 'satisfaction',
    opType: 'max',
    constraints: {},
    variables: {},
    ints: {},
  };

  let totalVars = 0;
  let matinVars = 0;
  let apresMidiVars = 0;

  // Variables
  for (const [besoinKey, besoin] of besoinsMap) {
    for (const [secId, sec] of secretairesMap) {
      const hasSpeciality = besoin.specialite_id === 'default' || 
        sec.specialites.includes(besoin.specialite_id);
      if (!hasSpeciality) continue;

      const creneauKey = `${besoin.jour_semaine}|${besoin.demi_journee}`;
      if (!sec.creneaux.get(creneauKey)) continue;

      const varName = `x_${secId}_${besoinKey}`;
      
      const realBesoin = Math.max(besoin.besoin, 0.01);
      const satisfaction = 100 / realBesoin;

      model.variables[varName] = {
        satisfaction,
        [`cap_${besoinKey}`]: 1,
        [`uniq_${secId}_${besoin.jour_semaine}_${besoin.demi_journee}`]: 1,
      };
      model.ints[varName] = 1;
      
      totalVars++;
      if (besoin.demi_journee === 'matin') matinVars++;
      else apresMidiVars++;
    }
  }

  // Constraints
  let totalConstraints = 0;

  // Uniqueness
  const uniquenessKeys = new Set<string>();
  for (const [secId, sec] of secretairesMap) {
    for (let jour = 1; jour <= 5; jour++) {
      for (const demi of ['matin', 'apres_midi'] as DemiJournee[]) {
        if (!sec.creneaux.get(`${jour}|${demi}`)) continue;
        const constraintKey = `uniq_${secId}_${jour}_${demi}`;
        uniquenessKeys.add(constraintKey);
        model.constraints[constraintKey] = { max: 1 };
        totalConstraints++;
      }
    }
  }

  // Capacity
  for (const [besoinKey, besoin] of besoinsMap) {
    const constraintKey = `cap_${besoinKey}`;
    model.constraints[constraintKey] = { max: Math.ceil(besoin.besoin) };
    totalConstraints++;
  }

  return {
    model,
    stats: { totalVars, matinVars, apresMidiVars, totalConstraints },
  };
}

function parseResults(
  solution: any,
  secretairesMap: Map<string, SecretaireData>,
  besoinsMap: Map<string, BesoinData>
) {
  const resultsByBesoin = new Map<string, {
    besoin: BesoinData;
    assignedSecretaries: string[];
    count: number;
  }>();

  for (const [besoinKey, besoin] of besoinsMap) {
    resultsByBesoin.set(besoinKey, {
      besoin,
      assignedSecretaries: [],
      count: 0,
    });
  }

  for (const varName in solution) {
    if (!varName.startsWith('x_') || solution[varName] !== 1) continue;

    const parts = varName.split('_');
    const secId = parts[1];
    const besoinKey = parts.slice(2).join('_');

    const result = resultsByBesoin.get(besoinKey);
    if (result) {
      result.assignedSecretaries.push(secId);
      result.count++;
    }
  }

  return Array.from(resultsByBesoin.values()).map(r => ({
    specialite_id: r.besoin.specialite_id,
    specialite_nom: r.besoin.specialite_nom,
    jour_semaine: r.besoin.jour_semaine,
    demi_journee: r.besoin.demi_journee,
    besoins: r.besoin.besoin,
    capacites_assignees: r.count,
    secretaires_assignees: r.assignedSecretaries,
  }));
}
