import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SLOT_DEFS = {
  matin: { start: '07:30:00', end: '12:00:00' },
  apres_midi: { start: '13:00:00', end: '17:00:00' },
};

type Periode = 'matin' | 'apres_midi';

interface CreneauBesoin {
  id: string;
  date: string;
  periode: Periode;
  site_id: string;
  site_nom: string;
  site_fermeture: boolean;
  specialite_id: string;
  nombre_secretaires_requis: number;
  medecin_ids: string[]; // Liste des médecins pour ce créneau
}

interface CreneauCapacite {
  id: string;
  date: string;
  periode: Periode;
  secretaire_id?: string;
  backup_id?: string;
  nom_complet: string;
  specialites: string[];
  prefere_port_en_truie: boolean;
}

interface Phase1Assignment {
  date: string;
  periode: Periode;
  specialite_id: string;
  capacites: CreneauCapacite[];
  besoin_total: number;
}

interface Phase2Assignment {
  date: string;
  periode: Periode;
  site_id: string;
  site_nom: string;
  site_fermeture: boolean;
  specialite_id: string;
  capacites: CreneauCapacite[];
  besoin_site: number;
  medecins_ids: string[];
}

interface Phase3Assignment extends Phase2Assignment {
  is_1r?: boolean;
  is_2f?: boolean;
}

interface HistoriqueEntry {
  personne_id: string;
  type: '1r' | '2f';
  count: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    const supabaseServiceRole = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { weekStart } = await req.json();
    const startDate = new Date(weekStart);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 6);

    const weekStartStr = startDate.toISOString().split('T')[0];
    const weekEndStr = endDate.toISOString().split('T')[0];

    console.log(`📅 Generating planning for week: ${weekStartStr} to ${weekEndStr}`);

    // Fetch data
    const { data: besoins, error: besoinsError } = await supabase
      .from('besoin_effectif')
      .select('*, sites!inner(nom, fermeture)')
      .gte('date', weekStartStr)
      .lte('date', weekEndStr)
      .eq('actif', true);

    if (besoinsError) throw besoinsError;

    const { data: capacites, error: capacitesError } = await supabase
      .from('capacite_effective')
      .select(`
        *,
        secretaires(first_name, name, prefere_port_en_truie),
        backup(first_name, name)
      `)
      .gte('date', weekStartStr)
      .lte('date', weekEndStr)
      .eq('actif', true);

    if (capacitesError) throw capacitesError;

    // Fetch historique 1R/2F (4 dernières semaines)
    const historiqueStartDate = new Date(startDate);
    historiqueStartDate.setDate(historiqueStartDate.getDate() - 28);
    const historiqueStartStr = historiqueStartDate.toISOString().split('T')[0];

    const { data: historique, error: historiqueError } = await supabase
      .from('assignations_1r_2f_historique')
      .select('*')
      .gte('date', historiqueStartStr)
      .lt('date', weekStartStr);

    if (historiqueError) throw historiqueError;

    console.log(`📊 Found ${besoins?.length || 0} besoins, ${capacites?.length || 0} capacites, ${historique?.length || 0} historique entries`);

    // Transform data
    const creneauxBesoins = transformBesoins(besoins);
    const creneauxCapacites = transformCapacites(capacites);
    const historiqueMap = buildHistoriqueMap(historique);

    console.log(`🔄 Transformed: ${creneauxBesoins.length} besoin creneaux, ${creneauxCapacites.length} capacite slots`);

    // Run 3-phase optimization
    const result = optimizePlanning3Phases(creneauxBesoins, creneauxCapacites, historiqueMap);

    console.log(`✅ Optimization complete: Score ${result.score_total}`);

    // Save to planning_genere
    await savePlanning(supabaseServiceRole, weekStartStr, weekEndStr, result);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('❌ Error in optimize-planning:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function transformBesoins(besoins: any[]): CreneauBesoin[] {
  const creneaux: CreneauBesoin[] = [];
  
  for (const besoin of besoins) {
    const site = besoin.sites as any;
    const slots = getOverlappingSlots(besoin.heure_debut, besoin.heure_fin);
    
    for (const periode of slots) {
      creneaux.push({
        id: `${besoin.site_id}-${besoin.date}-${periode}`,
        date: besoin.date,
        periode,
        site_id: besoin.site_id,
        site_nom: site?.nom || '',
        site_fermeture: site?.fermeture || false,
        specialite_id: besoin.specialite_id,
        nombre_secretaires_requis: besoin.nombre_secretaires_requis,
        medecin_ids: besoin.medecin_id ? [besoin.medecin_id] : [],
      });
    }
  }
  
  // Group by (site, date, periode) and sum besoins + merge medecin_ids
  const grouped = new Map<string, CreneauBesoin>();
  for (const creneau of creneaux) {
    const key = creneau.id;
    if (!grouped.has(key)) {
      grouped.set(key, creneau);
    } else {
      const existing = grouped.get(key)!;
      existing.nombre_secretaires_requis += creneau.nombre_secretaires_requis;
      // Merge medecin_ids without duplicates
      existing.medecin_ids = [...new Set([...existing.medecin_ids, ...creneau.medecin_ids])];
    }
  }
  
  return Array.from(grouped.values());
}

function transformCapacites(capacites: any[]): CreneauCapacite[] {
  const creneaux: CreneauCapacite[] = [];
  
  for (const capacite of capacites) {
    const isBackup = !!capacite.backup_id;
    const personne = isBackup ? capacite.backup : capacite.secretaires;
    if (!personne) continue;

    const nomComplet = `${personne.first_name || ''} ${personne.name || ''}`.trim();
    const preferePortEnTruie = isBackup ? false : (personne.prefere_port_en_truie || false);
    const slots = getOverlappingSlots(capacite.heure_debut, capacite.heure_fin);
    
    for (const periode of slots) {
      creneaux.push({
        id: `${capacite.id}-${periode}`,
        date: capacite.date,
        periode,
        secretaire_id: capacite.secretaire_id,
        backup_id: capacite.backup_id,
        nom_complet: nomComplet,
        specialites: capacite.specialites || [],
        prefere_port_en_truie: preferePortEnTruie,
      });
    }
  }
  
  return creneaux;
}

function getOverlappingSlots(heureDebut: string, heureFin: string): Periode[] {
  const slots: Periode[] = [];
  
  if (heureDebut < SLOT_DEFS.matin.end && heureFin > SLOT_DEFS.matin.start) {
    slots.push('matin');
  }
  
  if (heureDebut < SLOT_DEFS.apres_midi.end && heureFin > SLOT_DEFS.apres_midi.start) {
    slots.push('apres_midi');
  }
  
  return slots;
}

function buildHistoriqueMap(historique: any[]): Map<string, HistoriqueEntry> {
  const map = new Map<string, HistoriqueEntry>();
  
  for (const entry of historique) {
    const personneId = entry.secretaire_id || entry.backup_id;
    const key = `${personneId}-${entry.type_assignation}`;
    
    if (!map.has(key)) {
      map.set(key, {
        personne_id: personneId,
        type: entry.type_assignation,
        count: 0,
      });
    }
    
    map.get(key)!.count++;
  }
  
  return map;
}

function optimizePlanning3Phases(
  besoins: CreneauBesoin[],
  capacites: CreneauCapacite[],
  historique: Map<string, HistoriqueEntry>
) {
  console.log('\n🎯 Starting 3-phase optimization');
  
  // PHASE 1: Optimisation par spécialité
  console.log('\n📍 PHASE 1: Optimisation par spécialité');
  const phase1Result = phase1OptimisationSpecialite(besoins, capacites);
  
  // PHASE 2: Répartition par site
  console.log('\n📍 PHASE 2: Répartition par site');
  const phase2Result = phase2RepartitionSite(besoins, phase1Result);
  
  // PHASE 3: Assignation 1R/2F
  console.log('\n📍 PHASE 3: Assignation 1R/2F');
  const phase3Result = phase3Assignation1R2F(phase2Result, historique);
  
  // Calculate final scores
  const stats = calculateStats(phase3Result.assignments, besoins);
  const score_base = phase1Result.score;
  const penalites = {
    changement_site: phase2Result.penalite_matin_apres_midi + phase2Result.penalite_changement_specialite,
    multiple_fermetures: 0,
    centre_esplanade_depassement: phase2Result.penalite_centre_esplanade,
    penalite_1r_2f: phase3Result.penalite,
  };
  
  const score_total = score_base + penalites.changement_site + penalites.centre_esplanade_depassement + penalites.penalite_1r_2f;
  
  console.log(`\n✅ Final scores:`);
  console.log(`   Base score (Phase 1): ${score_base}`);
  console.log(`   Pénalité sites (Phase 2): ${penalites.changement_site + penalites.centre_esplanade_depassement}`);
  console.log(`   Pénalité 1R/2F (Phase 3): ${penalites.penalite_1r_2f}`);
  console.log(`   Score total: ${score_total}`);
  
  return {
    assignments: convertToAssignmentResults(phase3Result.assignments),
    unusedCapacites: phase1Result.unusedCapacites,
    stats,
    score_base,
    penalites,
    score_total,
  };
}

function phase1OptimisationSpecialite(
  besoins: CreneauBesoin[],
  capacites: CreneauCapacite[]
): {
  assignments: Phase1Assignment[];
  unusedCapacites: CreneauCapacite[];
  score: number;
} {
  const assignments: Phase1Assignment[] = [];
  const usedCapacites = new Set<string>();
  
  // Group besoins by (date, periode, specialite)
  const besoinGroups = new Map<string, { specialite_id: string; total: number; date: string; periode: Periode }>();
  for (const b of besoins) {
    const key = `${b.date}|${b.periode}|${b.specialite_id}`;
    if (!besoinGroups.has(key)) {
      besoinGroups.set(key, {
        specialite_id: b.specialite_id,
        total: 0,
        date: b.date,
        periode: b.periode,
      });
    }
    besoinGroups.get(key)!.total += b.nombre_secretaires_requis;
  }
  
  console.log(`   Found ${besoinGroups.size} specialty groups`);
  
  // For each group, assign capacites to minimize (100 - percentage * 100)²
  let totalScore = 0;
  
  for (const [key, group] of besoinGroups) {
    const besoinRounded = Math.ceil(group.total);
    
    // Get available capacites for this (date, periode, specialite)
    const availableCaps = capacites.filter(
      cap =>
        cap.date === group.date &&
        cap.periode === group.periode &&
        cap.specialites.includes(group.specialite_id) &&
        !usedCapacites.has(cap.id)
    );
    
    // Assign as many as possible (up to besoinRounded)
    const assignedCaps: CreneauCapacite[] = [];
    for (let i = 0; i < Math.min(availableCaps.length, besoinRounded); i++) {
      assignedCaps.push(availableCaps[i]);
      usedCapacites.add(availableCaps[i].id);
    }
    
    const percentage = (assignedCaps.length / besoinRounded) * 100;
    const score = Math.pow(100 - percentage, 2);
    totalScore += score;
    
    assignments.push({
      date: group.date,
      periode: group.periode,
      specialite_id: group.specialite_id,
      capacites: assignedCaps,
      besoin_total: group.total,
    });
    
    console.log(`   ${group.date} ${group.periode} spec=${group.specialite_id.substring(0, 8)}: ${assignedCaps.length}/${besoinRounded} (${percentage.toFixed(1)}%, score=${score.toFixed(2)})`);
  }
  
  const unusedCapacites = capacites.filter(cap => !usedCapacites.has(cap.id));
  
  console.log(`   Phase 1 score: ${totalScore.toFixed(2)}`);
  console.log(`   Unused capacites (administratif): ${unusedCapacites.length}`);
  
  return {
    assignments,
    unusedCapacites,
    score: -totalScore, // Negative because we want to minimize
  };
}

function phase2RepartitionSite(
  besoins: CreneauBesoin[],
  phase1Result: { assignments: Phase1Assignment[] }
): {
  assignments: Phase2Assignment[];
  penalite_matin_apres_midi: number;
  penalite_centre_esplanade: number;
  penalite_changement_specialite: number;
} {
  const assignments: Phase2Assignment[] = [];
  let penalite_matin_apres_midi = 0;
  let penalite_centre_esplanade = 0;
  let penalite_changement_specialite = 0;
  
  // For each phase1 assignment, distribute to sites
  for (const phase1Assignment of phase1Result.assignments) {
    // Get all besoins for this (date, periode, specialite)
    const relevantBesoins = besoins.filter(
      b =>
        b.date === phase1Assignment.date &&
        b.periode === phase1Assignment.periode &&
        b.specialite_id === phase1Assignment.specialite_id
    );
    
    if (relevantBesoins.length === 0) continue;
    
    // If single site, direct assignment
    if (relevantBesoins.length === 1) {
      assignments.push({
        date: phase1Assignment.date,
        periode: phase1Assignment.periode,
        site_id: relevantBesoins[0].site_id,
        site_nom: relevantBesoins[0].site_nom,
        site_fermeture: relevantBesoins[0].site_fermeture,
        specialite_id: phase1Assignment.specialite_id,
        capacites: phase1Assignment.capacites,
        besoin_site: relevantBesoins[0].nombre_secretaires_requis,
        medecins_ids: relevantBesoins[0].medecin_ids,
      });
      continue;
    }
    
    // Multiple sites: distribute with penalties
    const distribution = distributeCapsToMultipleSites(
      relevantBesoins,
      phase1Assignment.capacites,
      phase1Assignment.date
    );
    
    assignments.push(...distribution.assignments);
    penalite_matin_apres_midi += distribution.penalite_matin_apres_midi;
    penalite_centre_esplanade += distribution.penalite_centre_esplanade;
  }
  
  // Calculate penalty for secretaries changing specialty between morning/afternoon
  penalite_changement_specialite = calculateChangementSpecialitePenalty(assignments);
  
  console.log(`   Pénalité matin/après-midi différents: ${penalite_matin_apres_midi}`);
  console.log(`   Pénalité Centre Esplanade: ${penalite_centre_esplanade}`);
  console.log(`   Pénalité changement spécialité: ${penalite_changement_specialite}`);
  
  return {
    assignments,
    penalite_matin_apres_midi,
    penalite_centre_esplanade,
    penalite_changement_specialite,
  };
}

function distributeCapsToMultipleSites(
  besoins: CreneauBesoin[],
  capacites: CreneauCapacite[],
  date: string
): {
  assignments: Phase2Assignment[];
  penalite_matin_apres_midi: number;
  penalite_centre_esplanade: number;
} {
  const assignments: Phase2Assignment[] = [];
  let penalite_matin_apres_midi = 0;
  let penalite_centre_esplanade = 0;
  
  // Calculate total besoin
  const totalBesoin = besoins.reduce((sum, b) => sum + b.nombre_secretaires_requis, 0);
  
  // Distribute proportionally
  const availableCaps = [...capacites];
  
  for (const besoin of besoins) {
    const proportion = besoin.nombre_secretaires_requis / totalBesoin;
    const targetCount = Math.round(capacites.length * proportion);
    
    const assignedCaps: CreneauCapacite[] = [];
    
    // Prioritize prefere_port_en_truie for Centre Esplanade
    if (besoin.site_nom.includes('Centre Esplanade')) {
      // First, assign those who prefer
      const preferedCaps = availableCaps.filter(cap => cap.prefere_port_en_truie);
      for (let i = 0; i < Math.min(preferedCaps.length, targetCount); i++) {
        assignedCaps.push(preferedCaps[i]);
        const idx = availableCaps.indexOf(preferedCaps[i]);
        availableCaps.splice(idx, 1);
      }
    }
    
    // Fill remaining with available
    while (assignedCaps.length < targetCount && availableCaps.length > 0) {
      assignedCaps.push(availableCaps[0]);
      availableCaps.shift();
    }
    
    // Apply Centre Esplanade penalty
    if (besoin.site_nom.includes('Centre Esplanade')) {
      for (const cap of assignedCaps) {
        if (!cap.prefere_port_en_truie) {
          penalite_centre_esplanade -= 100; // Negative penalty
        }
      }
    }
    
    assignments.push({
      date: besoin.date,
      periode: besoin.periode,
      site_id: besoin.site_id,
      site_nom: besoin.site_nom,
      site_fermeture: besoin.site_fermeture,
      specialite_id: besoin.specialite_id,
      capacites: assignedCaps,
      besoin_site: besoin.nombre_secretaires_requis,
      medecins_ids: besoin.medecin_ids,
    });
  }
  
  // Check for same person morning/afternoon at different sites
  const morningAssignments = assignments.filter(a => a.periode === 'matin');
  const afternoonAssignments = assignments.filter(a => a.periode === 'apres_midi');
  
  for (const morning of morningAssignments) {
    for (const cap of morning.capacites) {
      const personneId = cap.secretaire_id || cap.backup_id;
      
      // Check if same person in afternoon at different site
      const afternoonAtSameSite = afternoonAssignments.find(
        a => a.site_id === morning.site_id && a.date === morning.date
      );
      
      if (afternoonAtSameSite) {
        const isInAfternoon = afternoonAtSameSite.capacites.some(
          c => (c.secretaire_id || c.backup_id) === personneId
        );
        
        if (!isInAfternoon) {
          penalite_matin_apres_midi -= 50; // Penalty for different person
        }
      }
    }
  }
  
  return {
    assignments,
    penalite_matin_apres_midi,
    penalite_centre_esplanade,
  };
}

function calculateChangementSpecialitePenalty(assignments: Phase2Assignment[]): number {
  let penalty = 0;
  
  // Group by (date, personne)
  const personneByDate = new Map<string, Map<string, Set<string>>>();
  
  for (const assignment of assignments) {
    for (const cap of assignment.capacites) {
      const personneId = cap.secretaire_id || cap.backup_id;
      if (!personneId) continue;
      
      const dateKey = assignment.date;
      if (!personneByDate.has(dateKey)) {
        personneByDate.set(dateKey, new Map());
      }
      
      if (!personneByDate.get(dateKey)!.has(personneId)) {
        personneByDate.get(dateKey)!.set(personneId, new Set());
      }
      
      personneByDate.get(dateKey)!.get(personneId)!.add(assignment.specialite_id);
    }
  }
  
  // Penalize if same person works different specialties on same day
  for (const [date, personneMap] of personneByDate) {
    for (const [personneId, specialites] of personneMap) {
      if (specialites.size > 1) {
        penalty -= 25 * (specialites.size - 1); // Penalty for each additional specialty
      }
    }
  }
  
  return penalty;
}

function phase3Assignation1R2F(
  phase2Result: { assignments: Phase2Assignment[] },
  historique: Map<string, HistoriqueEntry>
): {
  assignments: Phase3Assignment[];
  penalite: number;
} {
  const assignments: Phase3Assignment[] = [];
  let totalPenalty = 0;
  
  // Group by (date, site) for fermeture sites
  const fermetureSites = new Map<string, Phase2Assignment[]>();
  
  for (const assignment of phase2Result.assignments) {
    if (assignment.site_fermeture) {
      const key = `${assignment.date}|${assignment.site_id}`;
      if (!fermetureSites.has(key)) {
        fermetureSites.set(key, []);
      }
      fermetureSites.get(key)!.push(assignment);
    } else {
      // Non-fermeture sites: pass through
      assignments.push({
        ...assignment,
        is_1r: false,
        is_2f: false,
      });
    }
  }
  
  // For each fermeture site, assign 1R (morning) and 2F (afternoon)
  for (const [key, siteAssignments] of fermetureSites) {
    const morning = siteAssignments.find(a => a.periode === 'matin');
    const afternoon = siteAssignments.find(a => a.periode === 'apres_midi');
    
    if (!morning || !afternoon) {
      // Missing period, skip
      if (morning) assignments.push({ ...morning, is_1r: false, is_2f: false });
      if (afternoon) assignments.push({ ...afternoon, is_1r: false, is_2f: false });
      continue;
    }
    
    // Find person with least historical 1R assignments for morning
    let best1R: CreneauCapacite | null = null;
    let best1RPenalty = Infinity;
    
    for (const cap of morning.capacites) {
      const personneId = cap.secretaire_id || cap.backup_id;
      if (!personneId) continue;
      
      const histKey = `${personneId}-1r`;
      const count = historique.get(histKey)?.count || 0;
      const penalty = count * 25;
      
      if (penalty < best1RPenalty) {
        best1RPenalty = penalty;
        best1R = cap;
      }
    }
    
    // Find person with least historical 2F assignments for afternoon
    let best2F: CreneauCapacite | null = null;
    let best2FPenalty = Infinity;
    
    for (const cap of afternoon.capacites) {
      const personneId = cap.secretaire_id || cap.backup_id;
      if (!personneId) continue;
      
      const histKey = `${personneId}-2f`;
      const count = historique.get(histKey)?.count || 0;
      const penalty = count * 25;
      
      if (penalty < best2FPenalty) {
        best2FPenalty = penalty;
        best2F = cap;
      }
    }
    
    // Try to assign same person to both if possible
    if (best1R && best2F) {
      const best1RId = best1R.secretaire_id || best1R.backup_id;
      const best2FId = best2F.secretaire_id || best2F.backup_id;
      
      // Check if same person is available for both
      const samePersonInAfternoon = afternoon.capacites.find(
        c => (c.secretaire_id || c.backup_id) === best1RId
      );
      
      if (samePersonInAfternoon) {
        // Use same person for both
        assignments.push({
          ...morning,
          is_1r: true,
          is_2f: false,
        });
        
        assignments.push({
          ...afternoon,
          is_1r: false,
          is_2f: true,
        });
        
        totalPenalty -= (best1RPenalty + best2FPenalty);
      } else {
        // Different people
        assignments.push({
          ...morning,
          is_1r: true,
          is_2f: false,
        });
        
        assignments.push({
          ...afternoon,
          is_1r: false,
          is_2f: true,
        });
        
        totalPenalty -= (best1RPenalty + best2FPenalty + 50); // Extra penalty for different people
      }
    } else {
      // No valid assignment
      assignments.push({ ...morning, is_1r: false, is_2f: false });
      assignments.push({ ...afternoon, is_1r: false, is_2f: false });
    }
  }
  
  console.log(`   Total 1R/2F penalty: ${totalPenalty}`);
  
  return {
    assignments,
    penalite: totalPenalty,
  };
}

function calculateStats(assignments: Phase3Assignment[], besoins: CreneauBesoin[]) {
  let satisfait = 0;
  let partiel = 0;
  let non_satisfait = 0;
  
  // Group assignments by besoin
  for (const besoin of besoins) {
    const assignment = assignments.find(
      a =>
        a.date === besoin.date &&
        a.periode === besoin.periode &&
        a.site_id === besoin.site_id &&
        a.specialite_id === besoin.specialite_id
    );
    
    if (!assignment) {
      non_satisfait++;
      continue;
    }
    
    const required = Math.ceil(besoin.nombre_secretaires_requis);
    const assigned = assignment.capacites.length;
    
    if (assigned >= required) {
      satisfait++;
    } else if (assigned > 0) {
      partiel++;
    } else {
      non_satisfait++;
    }
  }
  
  return { satisfait, partiel, non_satisfait };
}

function convertToAssignmentResults(assignments: Phase3Assignment[]) {
  return assignments.map(assignment => {
    const required = Math.ceil(assignment.besoin_site);
    const assigned = assignment.capacites.length;
    
    let status: 'satisfait' | 'arrondi_inferieur' | 'non_satisfait';
    if (assigned >= required) {
      status = 'satisfait';
    } else if (assigned > 0) {
      status = 'arrondi_inferieur';
    } else {
      status = 'non_satisfait';
    }
    
    return {
      creneau_besoin_id: `${assignment.site_id}-${assignment.date}-${assignment.periode}`,
      date: assignment.date,
      periode: assignment.periode,
      site_id: assignment.site_id,
      site_nom: assignment.site_nom,
      site_fermeture: assignment.site_fermeture,
      medecins: [],
      medecins_ids: assignment.medecins_ids || [],
      secretaires: assignment.capacites.map(cap => ({
        id: cap.id,
        secretaire_id: cap.secretaire_id,
        backup_id: cap.backup_id,
        nom: cap.nom_complet,
        is_backup: !!cap.backup_id,
        is_1r: assignment.is_1r || false,
        is_2f: assignment.is_2f || false,
      })),
      nombre_requis: required,
      nombre_assigne: assigned,
      status,
      type_assignation: 'site',
    };
  });
}

async function savePlanning(supabaseServiceRole: any, weekStartStr: string, weekEndStr: string, result: any) {
  console.log('\n💾 Saving planning to database...');
  
  // Clear existing planning
  const { error: deleteError } = await supabaseServiceRole
    .from('planning_genere')
    .delete()
    .gte('date', weekStartStr)
    .lte('date', weekEndStr);
  
  if (deleteError) {
    console.error('❌ Error clearing old planning:', deleteError);
    throw deleteError;
  }
  
  console.log('✅ Cleared old planning');
  
  // Group assignments by (site, date, periode)
  const siteAssignmentMap = new Map<string, any>();
  
  for (const assignment of result.assignments) {
    const key = `${assignment.site_id}-${assignment.date}-${assignment.periode}`;
    
    if (!siteAssignmentMap.has(key)) {
      siteAssignmentMap.set(key, {
        date: assignment.date,
        site_id: assignment.site_id,
        periode: assignment.periode,
        secretaires_ids: [],
        backups_ids: [],
        medecins_ids: assignment.medecins_ids || [],
        responsable_1r_id: null,
        responsable_2f_id: null,
        site_fermeture: assignment.site_fermeture,
      });
    }
    
    const grouped = siteAssignmentMap.get(key)!;
    
    // Add secretaries and backups
    for (const sec of assignment.secretaires) {
      if (sec.is_backup) {
        grouped.backups_ids.push(sec.backup_id);
      } else {
        grouped.secretaires_ids.push(sec.secretaire_id);
      }
      
      // Set 1R/2F responsables
      if (sec.is_1r) {
        grouped.responsable_1r_id = sec.is_backup ? sec.backup_id : sec.secretaire_id;
      }
      if (sec.is_2f) {
        grouped.responsable_2f_id = sec.is_backup ? sec.backup_id : sec.secretaire_id;
      }
    }
  }
  
  // Convert to planning rows
  const planningRows = Array.from(siteAssignmentMap.values()).map(assignment => ({
    date: assignment.date,
    heure_debut: SLOT_DEFS[assignment.periode as keyof typeof SLOT_DEFS].start,
    heure_fin: SLOT_DEFS[assignment.periode as keyof typeof SLOT_DEFS].end,
    site_id: assignment.site_id,
    secretaires_ids: assignment.secretaires_ids,
    backups_ids: assignment.backups_ids,
    medecins_ids: assignment.medecins_ids,
    responsable_1r_id: assignment.responsable_1r_id,
    responsable_2f_id: assignment.responsable_2f_id,
    type: 'medecin' as const,
    statut: 'planifie' as const,
    version_planning: 1,
    type_assignation: 'site',
  }));
  
  console.log(`📊 Planning to insert: ${planningRows.length} site assignments`);
  
  if (planningRows.length > 0) {
    const { error: insertError } = await supabaseServiceRole
      .from('planning_genere')
      .insert(planningRows);
    
    if (insertError) {
      console.error('❌ Error saving planning:', insertError);
      throw insertError;
    }
    
    console.log(`✅ Saved ${planningRows.length} site assignment entries`);
  }
  
  // Group administratif assignments by date and periode
  const adminAssignmentMap = new Map<string, any>();
  
  for (const cap of result.unusedCapacites) {
    const key = `${cap.date}-${cap.periode}`;
    
    if (!adminAssignmentMap.has(key)) {
      adminAssignmentMap.set(key, {
        date: cap.date,
        periode: cap.periode,
        secretaires_ids: [],
        backups_ids: [],
      });
    }
    
    const grouped = adminAssignmentMap.get(key)!;
    
    if (cap.backup_id) {
      grouped.backups_ids.push(cap.backup_id);
    } else if (cap.secretaire_id) {
      grouped.secretaires_ids.push(cap.secretaire_id);
    }
  }
  
  const adminRows = Array.from(adminAssignmentMap.values()).map(assignment => ({
    date: assignment.date,
    type: 'medecin' as const,
    secretaires_ids: assignment.secretaires_ids,
    backups_ids: assignment.backups_ids,
    medecins_ids: [],
    responsable_1r_id: null,
    responsable_2f_id: null,
    site_id: null,
    heure_debut: SLOT_DEFS[assignment.periode as Periode].start,
    heure_fin: SLOT_DEFS[assignment.periode as Periode].end,
    type_assignation: 'administratif',
    statut: 'planifie' as const,
    version_planning: 1,
  }));
  
  console.log(`📊 Planning to insert: ${adminRows.length} administratif assignments`);
  
  if (adminRows.length > 0) {
    const { error: adminError } = await supabaseServiceRole
      .from('planning_genere')
      .insert(adminRows);
    
    if (adminError) {
      console.error('❌ Error saving administratif assignments:', adminError);
    } else {
      console.log(`✅ Saved ${adminRows.length} administratif assignment entries`);
    }
  }
  
  // Cleanup old history (> 4 weeks)
  await supabaseServiceRole.rpc('cleanup_old_assignations_1r_2f');
}
