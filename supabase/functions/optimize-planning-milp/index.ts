import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import solver from 'https://esm.sh/javascript-lp-solver@0.4.24';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const SITE_PORT_EN_TRUIE = '043899a1-a232-4c4b-9d7d-0eb44dad00ad';

// Pénalités
const PENALTY_SITE_CHANGE = 0.001;
const PENALTY_PORT_EN_TRUIE_BASE = 0.0001; // Base pour pénalité progressive

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('🚀 Starting day-by-day MILP planning optimization');
    
    const supabaseServiceRole = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Parse date range from request
    const { date_debut, date_fin } = await req.json().catch(() => ({}));
    const startDate = date_debut || new Date().toISOString().split('T')[0];
    const endDate = date_fin || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    console.log(`📊 Period: ${startDate} to ${endDate}`);

    // 1. Récupérer toutes les données nécessaires
    console.log('📥 Fetching data...');
    
    const [
      { data: medecins, error: medError },
      { data: secretaires, error: secError },
      { data: sites, error: siteError },
      { data: specialites, error: specError },
      { data: capacites, error: capError },
      { data: besoins, error: besError }
    ] = await Promise.all([
      supabaseServiceRole.from('medecins').select('*').eq('actif', true),
      supabaseServiceRole.from('secretaires').select('*').eq('actif', true),
      supabaseServiceRole.from('sites').select('*').eq('actif', true),
      supabaseServiceRole.from('specialites').select('*'),
      supabaseServiceRole.from('capacite_effective')
        .select('*')
        .gte('date', startDate)
        .lte('date', endDate)
        .eq('actif', true),
      supabaseServiceRole.from('besoin_effectif')
        .select('*')
        .gte('date', startDate)
        .lte('date', endDate)
        .eq('actif', true)
    ]);

    if (medError) throw medError;
    if (secError) throw secError;
    if (siteError) throw siteError;
    if (specError) throw specError;
    if (capError) throw capError;
    if (besError) throw besError;

    console.log(`✓ ${medecins.length} médecins, ${secretaires.length} secrétaires, ${sites.length} sites`);
    console.log(`✓ ${capacites.length} capacités, ${besoins.length} besoins`);

    // Créer des maps pour accès rapide
    const medecinMap = new Map(medecins.map(m => [m.id, m]));
    const secretaireMap = new Map(secretaires.map(s => [s.id, s]));
    const siteMap = new Map(sites.map(s => [s.id, s]));

    // 2. Générer la liste des jours à optimiser
    const days = generateDaysList(startDate, endDate);
    console.log(`📅 Processing ${days.length} days`);

    // 3. Supprimer les anciennes assignations pour la période
    const weekStart = getWeekStart(new Date(startDate));
    const weekEnd = getWeekEnd(new Date(endDate));
    const weekStartStr = weekStart.toISOString().split('T')[0];
    const weekEndStr = weekEnd.toISOString().split('T')[0];
    
    console.log(`🗑️ Deleting existing planning from ${weekStartStr} to ${weekEndStr}`);
    const { error: deleteError } = await supabaseServiceRole
      .from('planning_genere')
      .delete()
      .gte('date', weekStartStr)
      .lte('date', weekEndStr);
    
    if (deleteError) {
      console.error('⚠️ Delete error:', deleteError);
    }

    // 4. Traiter jour par jour
    const allAssignments: any[] = [];
    const portEnTruieCounter = new Map<string, number>(); // secretary_id -> count

    for (const day of days) {
      console.log(`\n📆 Processing ${day}...`);
      
      // Filtrer les données pour ce jour
      const dayCapacites = capacites.filter(c => c.date === day);
      const dayBesoins = besoins.filter(b => b.date === day);

      if (dayBesoins.length === 0) {
        console.log(`  ⏭️ No besoins for ${day}, skipping`);
        continue;
      }

      // Optimiser ce jour (matin et après-midi séparément)
      const dayAssignments = await optimizeDay(
        day,
        dayCapacites,
        dayBesoins,
        secretaireMap,
        medecinMap,
        siteMap,
        portEnTruieCounter
      );

      allAssignments.push(...dayAssignments);
    }

    // 5. Sauvegarder les assignations
    if (allAssignments.length > 0) {
      console.log(`\n💾 Saving ${allAssignments.length} assignments...`);
      const { error: insertError } = await supabaseServiceRole
        .from('planning_genere')
        .insert(allAssignments);
      
      if (insertError) {
        console.error('❌ Error inserting assignments:', insertError);
        throw insertError;
      }
    }

    console.log(`✅ Optimization complete!`);

    return new Response(JSON.stringify({
      success: true,
      assignments_count: allAssignments.length,
      days_processed: days.length
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

function generateDaysList(startDate: string, endDate: string): string[] {
  const days: string[] = [];
  const current = new Date(startDate);
  const end = new Date(endDate);
  
  while (current <= end) {
    days.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }
  
  return days;
}

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function getWeekEnd(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? 0 : 7 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

async function optimizeDay(
  date: string,
  capacites: any[],
  besoins: any[],
  secretaireMap: Map<string, any>,
  medecinMap: Map<string, any>,
  siteMap: Map<string, any>,
  portEnTruieCounter: Map<string, number>
): Promise<any[]> {
  const assignments: any[] = [];

  // Traiter matin et après-midi séparément
  for (const periode of ['matin', 'apres_midi'] as const) {
    const periodeTime = periode === 'matin' 
      ? { heure_debut: '07:30:00', heure_fin: '12:00:00' }
      : { heure_debut: '13:00:00', heure_fin: '17:00:00' };

    console.log(`  ⏰ ${periode.toUpperCase()}`);

    // 1. Calculer les besoins par (site, specialite) pour cette période
    const besoinsParSite = calculateBesoins(besoins, medecinMap, periode, periodeTime);
    
    if (besoinsParSite.size === 0) {
      console.log(`    No besoins for ${periode}`);
      continue;
    }

    // 2. Identifier les secrétaires disponibles pour cette période
    const secretairesDispos = getAvailableSecretaries(capacites, secretaireMap, periode, periodeTime);
    
    if (secretairesDispos.length === 0) {
      console.log(`    No secretaries available for ${periode}`);
      continue;
    }

    console.log(`    ${besoinsParSite.size} besoins, ${secretairesDispos.length} secretaries available`);

    // 3. Construire et résoudre le modèle MILP pour cette demi-journée
    const periodAssignments = optimizePeriod(
      date,
      periode,
      periodeTime,
      besoinsParSite,
      secretairesDispos,
      assignments, // Pour détecter les changements de site
      portEnTruieCounter
    );

    assignments.push(...periodAssignments);
  }

  return assignments;
}

function calculateBesoins(
  besoins: any[],
  medecinMap: Map<string, any>,
  periode: 'matin' | 'apres_midi',
  periodeTime: { heure_debut: string; heure_fin: string }
): Map<string, any> {
  const besoinsMap = new Map<string, any>();

  for (const besoin of besoins) {
    // Vérifier si le besoin chevauche cette période
    if (!overlaps(besoin.heure_debut, besoin.heure_fin, periodeTime.heure_debut, periodeTime.heure_fin)) {
      continue;
    }

    const key = `${besoin.site_id}|${besoin.specialite_id || 'default'}`;
    
    if (!besoinsMap.has(key)) {
      besoinsMap.set(key, {
        site_id: besoin.site_id,
        specialite_id: besoin.specialite_id,
        besoin: 0,
        medecin_ids: []
      });
    }

    const entry = besoinsMap.get(key);
    
    // Calculer le besoin en secrétaires
    if (besoin.type === 'medecin' && besoin.medecin_id) {
      const medecin = medecinMap.get(besoin.medecin_id);
      if (medecin) {
        const proportion = calculateOverlapProportion(
          besoin.heure_debut,
          besoin.heure_fin,
          periodeTime.heure_debut,
          periodeTime.heure_fin
        );
        entry.besoin += (medecin.besoin_secretaires || 1.2) * proportion;
        if (!entry.medecin_ids.includes(besoin.medecin_id)) {
          entry.medecin_ids.push(besoin.medecin_id);
        }
      }
    } else if (besoin.type === 'bloc_operatoire') {
      const proportion = calculateOverlapProportion(
        besoin.heure_debut,
        besoin.heure_fin,
        periodeTime.heure_debut,
        periodeTime.heure_fin
      );
      entry.besoin += (besoin.nombre_secretaires_requis || 1) * proportion;
    }
  }

  return besoinsMap;
}

function overlaps(start1: string, end1: string, start2: string, end2: string): boolean {
  return start1 < end2 && end1 > start2;
}

function calculateOverlapProportion(
  start1: string,
  end1: string,
  start2: string,
  end2: string
): number {
  const overlapStart = start1 > start2 ? start1 : start2;
  const overlapEnd = end1 < end2 ? end1 : end2;
  
  if (overlapStart >= overlapEnd) return 0;
  
  const overlapMs = timeToMs(overlapEnd) - timeToMs(overlapStart);
  const totalMs = timeToMs(end2) - timeToMs(start2);
  
  return Math.max(0, Math.min(1, overlapMs / totalMs));
}

function timeToMs(time: string): number {
  const [h, m, s] = time.split(':').map(Number);
  return ((h * 60 + m) * 60 + (s || 0)) * 1000;
}

function getAvailableSecretaries(
  capacites: any[],
  secretaireMap: Map<string, any>,
  periode: 'matin' | 'apres_midi',
  periodeTime: { heure_debut: string; heure_fin: string }
): any[] {
  const availableSet = new Set<string>();

  for (const cap of capacites) {
    if (!cap.secretaire_id && !cap.backup_id) continue;
    
    // Vérifier si la capacité chevauche cette période
    if (!overlaps(cap.heure_debut, cap.heure_fin, periodeTime.heure_debut, periodeTime.heure_fin)) {
      continue;
    }

    const secretaire_id = cap.secretaire_id || cap.backup_id;
    availableSet.add(secretaire_id);
  }

  return Array.from(availableSet)
    .map(id => secretaireMap.get(id))
    .filter(s => s != null);
}

function optimizePeriod(
  date: string,
  periode: 'matin' | 'apres_midi',
  periodeTime: { heure_debut: string; heure_fin: string },
  besoinsParSite: Map<string, any>,
  secretairesDispos: any[],
  previousAssignments: any[],
  portEnTruieCounter: Map<string, number>
): any[] {
  // 1. Construire le modèle MILP
  const model: any = {
    optimize: 'objective',
    opType: 'min',
    constraints: {},
    variables: {},
    ints: {}
  };

  const slotsBySecretary = new Map<string, string[]>(); // secretary_id -> [slot_keys]

  // 2. Créer les créneaux possibles pour chaque secrétaire
  for (const secretaire of secretairesDispos) {
    const slots: string[] = [];

    // Créneaux par site/spécialité où elle a la compétence
    for (const [besoinKey, besoin] of besoinsParSite) {
      const [site_id, specialite_id] = besoinKey.split('|');
      
      // Vérifier si la secrétaire a la spécialité
      if (specialite_id !== 'default' && !secretaire.specialites?.includes(specialite_id)) {
        continue;
      }

      const slotKey = `${secretaire.id}_${site_id}_${specialite_id}`;
      slots.push(slotKey);

      // Créer la variable
      const varName = `x_${slotKey}`;
      model.variables[varName] = {
        objective: 0,
        [`cap_${secretaire.id}`]: 1, // Contrainte: max 1 assignation par secrétaire
        [`besoin_${besoinKey}`]: 1  // Contribue au besoin
      };

      // Pénalité Port-en-Truie (progressive)
      if (site_id === SITE_PORT_EN_TRUIE && !secretaire.prefere_port_en_truie) {
        const currentCount = portEnTruieCounter.get(secretaire.id) || 0;
        model.variables[varName].objective += PENALTY_PORT_EN_TRUIE_BASE * (1 + currentCount);
      }

      // Pénalité changement de site (si après-midi et site différent du matin)
      if (periode === 'apres_midi') {
        const morningAssignment = previousAssignments.find(
          a => a.date === date && 
               a.heure_debut === '07:30:00' &&
               (a.secretaires_ids?.includes(secretaire.id) || a.backups_ids?.includes(secretaire.id))
        );
        
        if (morningAssignment && morningAssignment.site_id !== site_id) {
          model.variables[varName].objective += PENALTY_SITE_CHANGE;
        }
      }

      model.ints[varName] = 1;
    }

    // Ajouter l'option administrative
    const adminSlotKey = `${secretaire.id}_admin`;
    slots.push(adminSlotKey);
    
    const adminVarName = `x_${adminSlotKey}`;
    model.variables[adminVarName] = {
      objective: 0,
      [`cap_${secretaire.id}`]: 1
    };
    model.ints[adminVarName] = 1;

    slotsBySecretary.set(secretaire.id, slots);
  }

  // 3. Contraintes
  // 3a. Chaque secrétaire max 1 assignation
  for (const secretaire of secretairesDispos) {
    model.constraints[`cap_${secretaire.id}`] = { max: 1 };
  }

  // 3b. Pour chaque besoin: capacité <= besoin
  // On ajoute des variables d'écart pour minimiser (besoin - capacite)²
  for (const [besoinKey, besoin] of besoinsParSite) {
    const besoinValue = besoin.besoin;
    
    // Variable d'écart (manque de capacité)
    const ecartVar = `ecart_${besoinKey}`;
    model.variables[ecartVar] = {
      objective: 1000 * besoinValue, // Poids fort pour satisfaire les besoins
      [`def_besoin_${besoinKey}`]: 1
    };

    // Contrainte: Σx + ecart = besoin
    model.constraints[`def_besoin_${besoinKey}`] = { equal: besoinValue };
    model.constraints[`besoin_${besoinKey}`] = { max: Math.ceil(besoinValue) };
  }

  // 4. Résoudre
  console.log(`    Solving MILP with ${Object.keys(model.variables).length} variables...`);
  const solution = solver.Solve(model);

  if (!solution.feasible) {
    console.log('    ⚠️ Infeasible, trying LP relaxation...');
    model.ints = {};
    const relaxedSolution = solver.Solve(model);
    if (!relaxedSolution.feasible) {
      console.log('    ❌ Still infeasible');
      return [];
    }
    return parseAssignmentsFromSolution(
      date,
      periode,
      periodeTime,
      relaxedSolution,
      besoinsParSite,
      secretairesDispos,
      portEnTruieCounter
    );
  }

  console.log(`    ✅ Solved with objective: ${solution.result?.toFixed(4)}`);

  // 5. Parser la solution
  return parseAssignmentsFromSolution(
    date,
    periode,
    periodeTime,
    solution,
    besoinsParSite,
    secretairesDispos,
    portEnTruieCounter
  );
}

function parseAssignmentsFromSolution(
  date: string,
  periode: 'matin' | 'apres_midi',
  periodeTime: { heure_debut: string; heure_fin: string },
  solution: any,
  besoinsParSite: Map<string, any>,
  secretairesDispos: any[],
  portEnTruieCounter: Map<string, number>
): any[] {
  const assignments: any[] = [];
  const assignedPerBesoin = new Map<string, number>();

  // Extraire les assignations
  const candidates: any[] = [];
  
  for (const [varName, value] of Object.entries(solution)) {
    if (!varName.startsWith('x_') || typeof value !== 'number' || value <= 0) continue;
    
    const parts = varName.substring(2).split('_');
    const secretary_id = parts[0];
    
    if (parts[1] === 'admin') {
      // Assignation administrative
      candidates.push({
        secretary_id,
        site_id: null,
        specialite_id: null,
        is_admin: true,
        value
      });
    } else {
      const site_id = parts[1];
      const specialite_id = parts.slice(2).join('_');
      candidates.push({
        secretary_id,
        site_id,
        specialite_id,
        is_admin: false,
        value
      });
    }
  }

  // Trier par valeur décroissante (priorité aux assignations fermes)
  candidates.sort((a, b) => b.value - a.value);

  const usedSecretaries = new Set<string>();

  // Traiter les assignations
  for (const candidate of candidates) {
    if (usedSecretaries.has(candidate.secretary_id)) continue;

    if (candidate.is_admin) {
      // Assignation administrative
      assignments.push({
        date,
        site_id: null,
        type: 'secretaire',
        heure_debut: periodeTime.heure_debut,
        heure_fin: periodeTime.heure_fin,
        secretaires_ids: [candidate.secretary_id],
        backups_ids: [],
        medecins_ids: [],
        type_assignation: 'administratif',
        statut: 'planifie'
      });
      usedSecretaries.add(candidate.secretary_id);
    } else {
      // Assignation à un site
      const besoinKey = `${candidate.site_id}|${candidate.specialite_id}`;
      const besoin = besoinsParSite.get(besoinKey);
      
      if (!besoin) continue;

      const currentAssigned = assignedPerBesoin.get(besoinKey) || 0;
      if (currentAssigned >= Math.ceil(besoin.besoin)) continue;

      assignments.push({
        date,
        site_id: candidate.site_id,
        type: 'secretaire',
        heure_debut: periodeTime.heure_debut,
        heure_fin: periodeTime.heure_fin,
        secretaires_ids: [candidate.secretary_id],
        backups_ids: [],
        medecins_ids: besoin.medecin_ids || [],
        type_assignation: 'site',
        statut: 'planifie'
      });

      // Mettre à jour le compteur Port-en-Truie
      if (candidate.site_id === SITE_PORT_EN_TRUIE) {
        const currentCount = portEnTruieCounter.get(candidate.secretary_id) || 0;
        portEnTruieCounter.set(candidate.secretary_id, currentCount + 1);
      }

      assignedPerBesoin.set(besoinKey, currentAssigned + 1);
      usedSecretaries.add(candidate.secretary_id);
    }
  }

  console.log(`    → ${assignments.length} assignments created`);
  return assignments;
}
