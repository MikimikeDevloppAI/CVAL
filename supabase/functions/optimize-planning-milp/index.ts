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
const PENALTY_ADMIN_BASE = 0.00001; // Base pour récompense décroissante admin
const UNDERALLOCATION_PENALTY = 100; // Pénalité pour sous-allocation

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
    const { date_debut, date_fin, selected_dates } = await req.json().catch(() => ({}));
    const startDate = date_debut || new Date().toISOString().split('T')[0];
    const endDate = date_fin || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    console.log(`📊 Period: ${startDate} to ${endDate}`);
    if (selected_dates && selected_dates.length > 0) {
      console.log(`📅 Selected dates for reoptimization: ${selected_dates.join(', ')}`);
    }

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
    const days = selected_dates && selected_dates.length > 0 
      ? selected_dates 
      : generateDaysList(startDate, endDate);
    console.log(`📅 Processing ${days.length} days`);

    // 3. Gérer le planning pour cette semaine
    const weekStart = getWeekStart(new Date(startDate));
    const weekEnd = getWeekEnd(new Date(endDate));
    const weekStartStr = weekStart.toISOString().split('T')[0];
    const weekEndStr = weekEnd.toISOString().split('T')[0];
    
    console.log(`📋 Managing planning for week ${weekStartStr} to ${weekEndStr}`);
    
    // Chercher si un planning existe déjà pour cette semaine
    const { data: existingPlanning, error: planningFetchError } = await supabaseServiceRole
      .from('planning')
      .select('*')
      .eq('date_debut', weekStartStr)
      .eq('date_fin', weekEndStr)
      .maybeSingle();
    
    if (planningFetchError) {
      console.error('⚠️ Error fetching planning:', planningFetchError);
      throw planningFetchError;
    }
    
    let planningId: string;
    
    if (existingPlanning) {
      // Mettre à jour le planning existant
      console.log(`🔄 Updating existing planning ${existingPlanning.id}`);
      planningId = existingPlanning.id;
      
      const { error: updateError } = await supabaseServiceRole
        .from('planning')
        .update({
          date_generation: new Date().toISOString(),
          statut: 'en_cours',
          updated_at: new Date().toISOString()
        })
        .eq('id', planningId);
      
      if (updateError) {
        console.error('⚠️ Error updating planning:', updateError);
        throw updateError;
      }
      
      // Supprimer les anciennes assignations liées à ce planning pour les dates spécifiées
      console.log(`🗑️ Deleting old assignments for planning ${planningId}`);
      
      if (selected_dates && selected_dates.length > 0) {
        // Supprimer uniquement pour les dates sélectionnées
        const { error: deleteError } = await supabaseServiceRole
          .from('planning_genere')
          .delete()
          .eq('planning_id', planningId)
          .in('date', selected_dates);
        
        if (deleteError) {
          console.error('⚠️ Delete error:', deleteError);
          throw deleteError;
        }
      } else {
        // Supprimer tout pour ce planning
        const { error: deleteError } = await supabaseServiceRole
          .from('planning_genere')
          .delete()
          .eq('planning_id', planningId);
        
        if (deleteError) {
          console.error('⚠️ Delete error:', deleteError);
          throw deleteError;
        }
      }
    } else {
      // Créer un nouveau planning
      console.log(`✨ Creating new planning for week ${weekStartStr} to ${weekEndStr}`);
      const { data: newPlanning, error: insertError } = await supabaseServiceRole
        .from('planning')
        .insert({
          date_debut: weekStartStr,
          date_fin: weekEndStr,
          date_generation: new Date().toISOString(),
          statut: 'en_cours'
        })
        .select()
        .single();
      
      if (insertError || !newPlanning) {
        console.error('⚠️ Error creating planning:', insertError);
        throw insertError;
      }
      
      planningId = newPlanning.id;
      console.log(`✓ Created planning ${planningId}`);
    }

    // 4. Récupérer l'historique admin des 4 dernières semaines
    const fourWeeksAgo = new Date(startDate);
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
    const fourWeeksAgoStr = fourWeeksAgo.toISOString().split('T')[0];

    const { data: adminHistory, error: adminHistError } = await supabaseServiceRole
      .from('planning_genere')
      .select('secretaires_ids, backups_ids, date')
      .eq('type_assignation', 'administratif')
      .gte('date', fourWeeksAgoStr)
      .lt('date', startDate);

    if (adminHistError) throw adminHistError;

    // Compter les assignations admin par secrétaire
    const adminCounter = new Map<string, number>();
    for (const pg of adminHistory || []) {
      for (const sid of pg.secretaires_ids || []) {
        adminCounter.set(sid, (adminCounter.get(sid) || 0) + 1);
      }
      for (const bid of pg.backups_ids || []) {
        adminCounter.set(bid, (adminCounter.get(bid) || 0) + 1);
      }
    }

    console.log(`📊 Admin history: ${adminHistory?.length || 0} records found`);

    // 5. Traiter jour par jour
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
        portEnTruieCounter,
        adminCounter
      );

      // Ajouter le planning_id à chaque assignation
      dayAssignments.forEach(a => a.planning_id = planningId);
      
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

    // 6. Assigner les responsables 1R et 2F pour les sites fermés
    console.log(`\n👥 Assigning 1R and 2F responsibilities for closed sites...`);
    await assignResponsablesForClosedSites(
      supabaseServiceRole,
      days,
      sites,
      secretaires,
      weekStartStr,
      weekEndStr
    );

    console.log(`✅ Optimization complete!`);

    return new Response(JSON.stringify({
      success: true,
      planning_id: planningId,
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
  portEnTruieCounter: Map<string, number>,
  adminCounter: Map<string, number>
): Promise<any[]> {
  const assignments: any[] = [];

  // Traiter matin et après-midi séparément
  for (const periode of ['matin', 'apres_midi'] as const) {
    const periodeTime = periode === 'matin' 
      ? { heure_debut: '07:30:00', heure_fin: '12:00:00' }
      : { heure_debut: '13:00:00', heure_fin: '17:00:00' };

    console.log(`  ⏰ ${periode.toUpperCase()}`);

    // 1. Calculer les besoins par (site, specialite) pour cette période
    const besoinsParSite = calculateBesoins(besoins, medecinMap, siteMap, periode, periodeTime);
    
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
      portEnTruieCounter,
      adminCounter
    );

    assignments.push(...periodAssignments);
  }

  return assignments;
}

function calculateBesoins(
  besoins: any[],
  medecinMap: Map<string, any>,
  siteMap: Map<string, any>,
  periode: 'matin' | 'apres_midi',
  periodeTime: { heure_debut: string; heure_fin: string }
): Map<string, any> {
  const besoinsMap = new Map<string, any>();

  for (const besoin of besoins) {
    // Vérifier si le besoin chevauche cette période
    if (!overlaps(besoin.heure_debut, besoin.heure_fin, periodeTime.heure_debut, periodeTime.heure_fin)) {
      continue;
    }

    // Récupérer la spécialité depuis le site
    const site = siteMap.get(besoin.site_id);
    const specialite_id = site?.specialite_id || 'default';
    const key = `${besoin.site_id}|${specialite_id}`;
    
    console.log(`    📍 Besoin: site=${besoin.site_id.slice(0, 8)}, specialite=${specialite_id?.slice(0, 8) || 'default'}, key=${key.slice(0, 30)}`);
    
    if (!besoinsMap.has(key)) {
      besoinsMap.set(key, {
        site_id: besoin.site_id,
        specialite_id: specialite_id,
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
  portEnTruieCounter: Map<string, number>,
  adminCounter: Map<string, number>
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
      const hasSpeciality = specialite_id === 'default' || secretaire.specialites?.includes(specialite_id);
      if (!hasSpeciality) {
        continue;
      }

      const slotKey = `${secretaire.id}_${site_id}_${specialite_id}`;
      slots.push(slotKey);

      // Créer la variable
      const varName = `x_${slotKey}`;
      model.variables[varName] = {
        objective: 0,
        [`cap_${secretaire.id}`]: 1,     // Contrainte: max 1 assignation par secrétaire
        [`besoin_${besoinKey}`]: 1,      // Contribue à la contrainte max (arrondi)
        [`sum_x_${besoinKey}`]: 1        // Pour calculer Σx
      };

      // Pénalité Port-en-Truie (exponentielle: 0.0001 × 2^n)
      if (site_id === SITE_PORT_EN_TRUIE && !secretaire.prefere_port_en_truie) {
        const currentCount = portEnTruieCounter.get(secretaire.id) || 0;
        model.variables[varName].objective += 0.0001 * Math.pow(2, currentCount);
      }

      // Pénalité changement de site (si après-midi et site différent du matin)
      // IMPORTANT: Ne pas pénaliser si l'assignation du matin était admin
      if (periode === 'apres_midi') {
        const morningAssignment = previousAssignments.find(
          a => a.date === date && 
               a.heure_debut === '07:30:00' &&
               (a.secretaires_ids?.includes(secretaire.id) || a.backups_ids?.includes(secretaire.id))
        );
        
        if (morningAssignment && 
            morningAssignment.site_id !== site_id && 
            morningAssignment.type_assignation !== 'administratif') {
          model.variables[varName].objective += PENALTY_SITE_CHANGE;
        }
      }

      // LP mode: integers disabled for performance
      // model.ints[varName] = 1;
    }

    // Ajouter l'option administrative avec récompense décroissante
    const adminSlotKey = `${secretaire.id}_admin`;
    slots.push(adminSlotKey);
    
    const adminVarName = `x_${adminSlotKey}`;
    const adminCount = adminCounter.get(secretaire.id) || 0;
    model.variables[adminVarName] = {
      objective: -PENALTY_ADMIN_BASE / Math.pow(2, adminCount),  // Décroît avec les assignations
      [`cap_${secretaire.id}`]: 1
    };
    // LP mode: integers disabled for performance
    // model.ints[adminVarName] = 1;

    slotsBySecretary.set(secretaire.id, slots);
  }

  // Log des secrétaires compatibles par besoin
  const compatibleSecretariesByBesoin = new Map<string, number>();
  for (const [besoinKey] of besoinsParSite) {
    const [site_id, specialite_id] = besoinKey.split('|');
    let count = 0;
    for (const secretaire of secretairesDispos) {
      const hasSpeciality = specialite_id === 'default' || secretaire.specialites?.includes(specialite_id);
      if (hasSpeciality) count++;
    }
    compatibleSecretariesByBesoin.set(besoinKey, count);
    console.log(`      ✓ Site ${site_id.slice(0, 8)} (spec: ${specialite_id?.slice(0, 8) || 'default'}) → ${count} secrétaires compatibles`);
  }

  // 3. Contraintes
  // 3a. Chaque secrétaire max 1 assignation
  for (const secretaire of secretairesDispos) {
    model.constraints[`cap_${secretaire.id}`] = { max: 1 };
  }

  // 3b. Pour chaque besoin: pénalité de sous-allocation
  // Objectif: minimize UNDERALLOCATION_PENALTY * (besoin - Σx)
  for (const [besoinKey, besoin] of besoinsParSite) {
    const besoinValue = besoin.besoin;
    
    // Variable Σx (somme des assignations)
    const sumXVar = `sum_x_${besoinKey}`;
    model.variables[sumXVar] = {
      objective: 0,
      [`sum_x_${besoinKey}`]: -1,      // Σx est défini par les variables x
      [`def_ecart_${besoinKey}`]: 1    // sumX + ecart = besoin
    };
    
    // Variable d'écart: (besoin - Σx) avec pénalité forte
    const ecartVar = `ecart_${besoinKey}`;
    model.variables[ecartVar] = {
      objective: UNDERALLOCATION_PENALTY, // Pénalité forte pour sous-allocation
      [`def_ecart_${besoinKey}`]: 1,
      min: 0  // Force ecart >= 0, donc Σx <= besoin
    };

    // Contrainte: Σx définie par les variables x
    model.constraints[`sum_x_${besoinKey}`] = { equal: 0 };
    
    // Contrainte: ecart = besoin - Σx
    model.constraints[`def_ecart_${besoinKey}`] = { equal: besoinValue };
    
    // Contrainte: Σx ≤ besoin (exacte, pas arrondie) pour empêcher sur-allocation
    model.constraints[`besoin_${besoinKey}`] = { max: besoinValue };
  }

  // 4. Résoudre
  console.log(`    Solving LP (relaxation) with ${Object.keys(model.variables).length} variables...`);
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
      portEnTruieCounter,
      adminCounter
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
    portEnTruieCounter,
    adminCounter
  );
}

function parseAssignmentsFromSolution(
  date: string,
  periode: 'matin' | 'apres_midi',
  periodeTime: { heure_debut: string; heure_fin: string },
  solution: any,
  besoinsParSite: Map<string, any>,
  secretairesDispos: any[],
  portEnTruieCounter: Map<string, number>,
  adminCounter: Map<string, number>
): any[] {
  // Regrouper les secrétaires par site (en s'assurant qu'une secrétaire n'apparaît qu'une fois)
  const assignmentsBySite = new Map<string, string[]>(); // site_id -> secretary_ids
  const adminSecretaries: string[] = [];
  const usedSecretaries = new Set<string>(); // Pour éviter les doublons
  
  // Trier les assignations par valeur pour prioriser les meilleures
  const assignments: Array<{secretary_id: string, site_id: string | null, value: number, is_admin: boolean}> = [];
  
  for (const [varName, value] of Object.entries(solution)) {
    // Ignorer les métadonnées du solver
    if (varName === 'feasible' || varName === 'result' || varName === 'bounded' || varName === 'isIntegral') continue;
    if (!varName.startsWith('x_') || typeof value !== 'number' || value <= 0.01) continue;
    
    const parts = varName.substring(2).split('_');
    const secretary_id = parts[0];
    
    if (parts[1] === 'admin') {
      assignments.push({ secretary_id, site_id: null, value, is_admin: true });
    } else {
      const site_id = parts[1];
      assignments.push({ secretary_id, site_id, value, is_admin: false });
    }
  }
  
  // Trier par valeur décroissante pour prioriser les meilleures assignations
  assignments.sort((a, b) => b.value - a.value);
  
  // Traiter les assignations en s'assurant qu'une secrétaire n'est assignée qu'une fois
  for (const assignment of assignments) {
    if (usedSecretaries.has(assignment.secretary_id)) continue;
    
    if (assignment.is_admin) {
      adminSecretaries.push(assignment.secretary_id);
      usedSecretaries.add(assignment.secretary_id);
    } else {
      const site_id = assignment.site_id!;
      
      if (!assignmentsBySite.has(site_id)) {
        assignmentsBySite.set(site_id, []);
      }
      assignmentsBySite.get(site_id)!.push(assignment.secretary_id);
      usedSecretaries.add(assignment.secretary_id);
      
      // Mettre à jour le compteur Port-en-Truie
      if (site_id === SITE_PORT_EN_TRUIE) {
        const currentCount = portEnTruieCounter.get(assignment.secretary_id) || 0;
        portEnTruieCounter.set(assignment.secretary_id, currentCount + 1);
      }
    }
  }

  const result: any[] = [];

  // Créer une ligne par besoin (même si non satisfait)
  for (const [besoinKey, besoin] of besoinsParSite) {
    const [site_id, specialite_id] = besoinKey.split('|');
    const assignedSecretaries = assignmentsBySite.get(site_id) || [];
    
    result.push({
      date,
      site_id,
      type: 'secretaire',
      heure_debut: periodeTime.heure_debut,
      heure_fin: periodeTime.heure_fin,
      secretaires_ids: assignedSecretaries,
      backups_ids: [],
      medecins_ids: besoin.medecin_ids || [],
      type_assignation: 'site',
      statut: 'planifie'
    });
  }

  // Créer une ligne pour les tâches administratives si nécessaire
  if (adminSecretaries.length > 0) {
    result.push({
      date,
      site_id: null,
      type: 'secretaire',
      heure_debut: periodeTime.heure_debut,
      heure_fin: periodeTime.heure_fin,
      secretaires_ids: adminSecretaries,
      backups_ids: [],
      medecins_ids: [],
      type_assignation: 'administratif',
      statut: 'planifie'
    });
  }

  console.log(`    → ${result.length} assignments created (${assignmentsBySite.size} sites, ${usedSecretaries.size} secretaries)`);
  return result;
}

// Fonction pour assigner les responsables 1R et 2F aux sites fermés
async function assignResponsablesForClosedSites(
  supabase: any,
  days: string[],
  sites: any[],
  secretaires: any[],
  weekStartStr: string,
  weekEndStr: string
) {
  // 1. Identifier les sites fermés
  const closedSites = sites.filter(s => s.fermeture === true);
  if (closedSites.length === 0) {
    console.log('  No closed sites found, skipping 1R/2F assignment');
    return;
  }

  console.log(`  Found ${closedSites.length} closed sites requiring 1R/2F assignment`);

  // 2. Récupérer l'historique des 4 dernières semaines depuis planning_genere
  const fourWeeksAgo = new Date(weekStartStr);
  fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
  const fourWeeksAgoStr = fourWeeksAgo.toISOString().split('T')[0];

  const { data: historique, error: histError } = await supabase
    .from('planning_genere')
    .select('responsable_1r_id, responsable_2f_id, date')
    .gte('date', fourWeeksAgoStr)
    .lt('date', weekStartStr)
    .not('responsable_1r_id', 'is', null)
    .or('responsable_2f_id.not.is.null');

  if (histError) {
    console.error('  Error fetching history:', histError);
    return;
  }

  // 3. Compter les assignations par secrétaire
  const count1R = new Map<string, number>();
  const count2F = new Map<string, number>();

  secretaires.forEach(s => {
    count1R.set(s.id, 0);
    count2F.set(s.id, 0);
  });

  (historique || []).forEach((h: any) => {
    if (h.responsable_1r_id) {
      count1R.set(h.responsable_1r_id, (count1R.get(h.responsable_1r_id) || 0) + 1);
    }
    if (h.responsable_2f_id) {
      count2F.set(h.responsable_2f_id, (count2F.get(h.responsable_2f_id) || 0) + 1);
    }
  });

  console.log(`  Historical counts from planning_genere: ${historique?.length || 0} records analyzed`);

  // 4. Pour chaque jour, assigner les responsables aux sites fermés
  for (const day of days) {
    console.log(`  Processing ${day}...`);

    for (const site of closedSites) {
      // Récupérer TOUS les créneaux (matin et après-midi) pour ce site
      const { data: creneaux, error: creneauxError } = await supabase
        .from('planning_genere')
        .select('*')
        .eq('date', day)
        .eq('site_id', site.id)
        .order('heure_debut');

      if (creneauxError || !creneaux || creneaux.length === 0) {
        console.log(`    ⚠️ No slots found for ${site.nom} on ${day}`);
        continue;
      }

      // Récupérer toutes les secrétaires assignées ce jour sur ce site
      const assignedSecretaryIds = new Set<string>();
      creneaux.forEach((c: any) => {
        (c.secretaires_ids || []).forEach((id: string) => assignedSecretaryIds.add(id));
      });

      const availableSecretaries = Array.from(assignedSecretaryIds);

      if (availableSecretaries.length < 2) {
        console.log(`    ⚠️ Not enough secretaries for ${site.nom} (need 2, have ${availableSecretaries.length})`);
        continue;
      }

      // Trier les secrétaires par nombre d'assignations 1R (croissant)
      const sorted1R = [...availableSecretaries].sort((a, b) => {
        return (count1R.get(a) || 0) - (count1R.get(b) || 0);
      });

      // Trier les secrétaires par nombre d'assignations 2F (croissant)
      const sorted2F = [...availableSecretaries].sort((a, b) => {
        return (count2F.get(a) || 0) - (count2F.get(b) || 0);
      });

      // Assigner 1R (celle qui a le moins de 1R)
      const responsable1R = sorted1R[0];
      
      // Assigner 2F (celle qui a le moins de 2F et n'est pas la 1R)
      let responsable2F = sorted2F[0];
      if (responsable2F === responsable1R && sorted2F.length > 1) {
        responsable2F = sorted2F[1];
      }

      // Mettre à jour tous les créneaux du jour pour ce site
      const creneauIds = creneaux.map((c: any) => c.id);
      
      const { error: updateError } = await supabase
        .from('planning_genere')
        .update({
          responsable_1r_id: responsable1R,
          responsable_2f_id: responsable2F
        })
        .in('id', creneauIds);

      if (updateError) {
        console.error(`    ❌ Error updating ${site.nom}:`, updateError);
      } else {
        console.log(`    ✓ ${site.nom}: 1R=${responsable1R.slice(0, 8)}, 2F=${responsable2F.slice(0, 8)}`);
        
        // Incrémenter les compteurs pour la semaine en cours
        count1R.set(responsable1R, (count1R.get(responsable1R) || 0) + 1);
        count2F.set(responsable2F, (count2F.get(responsable2F) || 0) + 1);
      }
    }
  }

  console.log('  ✅ 1R/2F assignment complete');
}
