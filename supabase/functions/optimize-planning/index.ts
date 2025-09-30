import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Slot definitions (strict coverage required)
const SLOT_DEFS = {
  matin: { start: '07:30:00', end: '12:00:00' },
  apres_midi: { start: '13:00:00', end: '17:00:00' },
};

// Convert HH:mm:ss to minutes
function toMinutes(hhmmss: string): number {
  const [h, m] = hhmmss.split(':').map(Number);
  return h * 60 + m;
}

// Check if capacity covers the ENTIRE slot (strict requirement)
function coversWholeSlot(
  capStart: string,
  capEnd: string,
  slotStart: string,
  slotEnd: string
): boolean {
  return toMinutes(capStart) <= toMinutes(slotStart) && toMinutes(capEnd) >= toMinutes(slotEnd);
}

interface CreneauBesoin {
  id: string;
  date: string;
  periode: 'matin' | 'apres_midi';
  site_id: string;
  site_nom: string;
  site_fermeture: boolean;
  specialite_id: string;
  nombre_secretaires_requis: number;
  type: 'medecin' | 'bloc_operatoire';
  medecin_ids: string[];
  medecin_noms: string[];
}

interface CreneauCapacite {
  id: string;
  date: string;
  periode: 'matin' | 'apres_midi';
  secretaire_id?: string;
  backup_id?: string;
  nom_complet: string;
  specialites: string[];
  prefere_port_en_truie: boolean;
  heure_debut: string;
  heure_fin: string;
}

interface Assignment {
  creneau_besoin: CreneauBesoin;
  capacites_assignees: Array<{
    id: string;
    secretaire_id?: string;
    backup_id?: string;
    nom_complet: string;
    is_backup: boolean;
    is_1r?: boolean;
    is_2f?: boolean;
  }>;
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

    // Create service role client for RLS bypass
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

    // Fetch besoins
    const { data: besoins, error: besoinsError } = await supabase
      .from('besoin_effectif')
      .select('*, sites!inner(nom, fermeture), medecins(first_name, name)')
      .gte('date', weekStartStr)
      .lte('date', weekEndStr)
      .eq('actif', true);

    if (besoinsError) throw besoinsError;

    // Fetch capacites WITH time ranges
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

    console.log(`📊 Found ${besoins?.length || 0} besoins and ${capacites?.length || 0} capacites`);

    // Group and split
    const creneauxBesoins = groupBesoinsEnCreneaux(besoins);
    const creneauxCapacites = splitCapacitesEnCreneaux(capacites);

    console.log(`🔄 Grouped into ${creneauxBesoins.length} besoin creneaux and ${creneauxCapacites.length} capacite slots`);

    // Run NEW optimization
    const result = optimizePlanning(creneauxBesoins, creneauxCapacites);

    console.log(`✅ Optimization complete: Score ${result.score_total}`);

    // Save to planning_genere using service role
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

    // Insert new planning (site assignments)
    const planningRows = result.assignments.flatMap((assignment: any) =>
      assignment.secretaires.map((sec: any) => ({
        date: assignment.date,
        heure_debut: SLOT_DEFS[assignment.periode as keyof typeof SLOT_DEFS].start,
        heure_fin: SLOT_DEFS[assignment.periode as keyof typeof SLOT_DEFS].end,
        site_id: assignment.site_id,
        medecin_id: null,
        secretaire_id: sec.is_backup ? null : sec.secretaire_id,
        backup_id: sec.is_backup ? sec.backup_id : null,
        type: 'medecin' as const,
        statut: 'planifie' as const,
        version_planning: 1,
        type_assignation: 'site',
      }))
    );

    console.log(`📊 Planning to insert: ${planningRows.length} site assignments`);

    if (planningRows.length > 0) {
      const { error: insertError } = await supabaseServiceRole
        .from('planning_genere')
        .insert(planningRows);

      if (insertError) {
        console.error('❌ Error saving planning:', insertError);
        console.error('Sample failing row:', planningRows[0]);
        throw insertError;
      }

      console.log(`✅ Saved ${planningRows.length} site assignment entries`);
    }

    // Insert administratif assignments
    const adminRows = result.unusedCapacites.map((cap: CreneauCapacite) => ({
      date: cap.date,
      type: 'medecin' as const,
      secretaire_id: cap.backup_id ? null : cap.secretaire_id,
      backup_id: cap.backup_id ? cap.backup_id : null,
      site_id: null,
      heure_debut: SLOT_DEFS[cap.periode].start,
      heure_fin: SLOT_DEFS[cap.periode].end,
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
        console.error('Sample failing row:', adminRows[0]);
      } else {
        console.log(`✅ Saved ${adminRows.length} administratif assignment entries`);
      }
    }

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

function groupBesoinsEnCreneaux(besoins: any[]): CreneauBesoin[] {
  console.log('\n📦 Grouping besoins into creneaux...');
  
  // Group besoins by (site_id, date, periode)
  const grouped = new Map<string, {
    site_id: string;
    site_nom: string;
    date: string;
    periode: 'matin' | 'apres_midi';
    specialite_id: string;
    total_besoin: number;
    medecin_ids: string[];
    medecin_noms: string[];
    site_fermeture: boolean;
    type: 'medecin' | 'bloc_operatoire';
  }>();

  for (const besoin of besoins) {
    const heureDebut = besoin.heure_debut;
    const heureFin = besoin.heure_fin;
    const site = besoin.sites as any;
    const medecin = besoin.medecins as any;
    
    const slots: Array<{ periode: 'matin' | 'apres_midi' }> = [];
    
    // Check if overlaps with morning
    if (heureDebut < SLOT_DEFS.matin.end && heureFin > SLOT_DEFS.matin.start) {
      slots.push({ periode: 'matin' });
    }
    
    // Check if overlaps with afternoon
    if (heureDebut < SLOT_DEFS.apres_midi.end && heureFin > SLOT_DEFS.apres_midi.start) {
      slots.push({ periode: 'apres_midi' });
    }

    for (const slot of slots) {
      const key = `${besoin.site_id}-${besoin.date}-${slot.periode}`;
      
      if (!grouped.has(key)) {
        grouped.set(key, {
          site_id: besoin.site_id,
          site_nom: site?.nom || '',
          date: besoin.date,
          periode: slot.periode,
          specialite_id: besoin.specialite_id,
          total_besoin: 0,
          medecin_ids: [],
          medecin_noms: [],
          site_fermeture: site?.fermeture || false,
          type: besoin.type,
        });
      }
      
      const group = grouped.get(key)!;
      group.total_besoin += besoin.nombre_secretaires_requis;
      
      if (besoin.type === 'medecin' && medecin && besoin.medecin_id) {
        group.medecin_ids.push(besoin.medecin_id);
        group.medecin_noms.push(`${medecin.first_name || ''} ${medecin.name || ''}`.trim());
      }
    }
  }

  // Convert grouped data to CreneauBesoin
  const creneaux: CreneauBesoin[] = [];
  for (const [key, group] of grouped) {
    creneaux.push({
      id: key,
      date: group.date,
      periode: group.periode,
      site_id: group.site_id,
      site_nom: group.site_nom,
      specialite_id: group.specialite_id,
      nombre_secretaires_requis: group.total_besoin,
      type: group.type,
      medecin_ids: group.medecin_ids,
      medecin_noms: group.medecin_noms,
      site_fermeture: group.site_fermeture,
    });
  }
  
  return creneaux;
}

function splitCapacitesEnCreneaux(capacites: any[]): CreneauCapacite[] {
  console.log('\n📦 Splitting capacites into creneaux...');
  const creneaux: CreneauCapacite[] = [];

  for (const capacite of capacites) {
    const heureDebut = capacite.heure_debut;
    const heureFin = capacite.heure_fin;
    
    const isBackup = !!capacite.backup_id;
    const personne = isBackup ? capacite.backup : capacite.secretaires;
    if (!personne) continue;

    const nomComplet = `${personne.first_name || ''} ${personne.name || ''}`.trim();
    const preferePortEnTruie = isBackup ? false : (personne.prefere_port_en_truie || false);

    // Check if covers morning slot
    if (heureDebut < SLOT_DEFS.matin.end && heureFin > SLOT_DEFS.matin.start) {
      creneaux.push({
        id: `${capacite.id}-matin`,
        date: capacite.date,
        periode: 'matin',
        secretaire_id: capacite.secretaire_id,
        backup_id: capacite.backup_id,
        nom_complet: nomComplet,
        specialites: capacite.specialites || [],
        prefere_port_en_truie: preferePortEnTruie,
        heure_debut: heureDebut,
        heure_fin: heureFin,
      });
    }

    // Check if covers afternoon slot
    if (heureDebut < SLOT_DEFS.apres_midi.end && heureFin > SLOT_DEFS.apres_midi.start) {
      creneaux.push({
        id: `${capacite.id}-apres_midi`,
        date: capacite.date,
        periode: 'apres_midi',
        secretaire_id: capacite.secretaire_id,
        backup_id: capacite.backup_id,
        nom_complet: nomComplet,
        specialites: capacite.specialites || [],
        prefere_port_en_truie: preferePortEnTruie,
        heure_debut: heureDebut,
        heure_fin: heureFin,
      });
    }
  }

  return creneaux;
}

/**
 * NEW OPTIMIZATION using MILP-inspired heuristic:
 * - Global pooling per (date, periode, specialite)
 * - Only capacities covering ENTIRE slot are valid
 * - Greedy allocation to site with highest deficit
 * - Minimizes sum of squared deficits
 */
function optimizePlanning(besoins: CreneauBesoin[], capacites: CreneauCapacite[]) {
  console.log('🎯 Starting MILP-inspired optimization');
  
  // Filter capacities: only keep those that cover the ENTIRE slot
  const validCapacites = capacites.filter(cap => {
    const slotDef = SLOT_DEFS[cap.periode];
    const covers = coversWholeSlot(cap.heure_debut, cap.heure_fin, slotDef.start, slotDef.end);
    if (!covers) {
      console.log(`⚠️  Capacity ${cap.id} (${cap.nom_complet}) does NOT cover full slot ${cap.periode} [${cap.heure_debut}-${cap.heure_fin}]`);
    }
    return covers;
  });
  
  console.log(`✅ Valid capacities covering full slots: ${validCapacites.length}/${capacites.length}`);
  
  const usedCapacities = new Set<string>();
  
  // Group besoins by (date, periode, specialite) - GLOBAL pooling level
  const besoinGroups = new Map<string, CreneauBesoin[]>();
  for (const b of besoins) {
    const key = `${b.date}|${b.periode}|${b.specialite_id}`;
    if (!besoinGroups.has(key)) besoinGroups.set(key, []);
    besoinGroups.get(key)!.push(b);
  }
  
  console.log(`📊 Total besoin groups (date|periode|specialite): ${besoinGroups.size}`);
  
  const allAssignments = new Map<string, Assignment>();
  
  // Initialize empty assignments for all besoins
  for (const b of besoins) {
    allAssignments.set(b.id, {
      creneau_besoin: b,
      capacites_assignees: [],
    });
  }
  
  // Process each group: distribute capacities to minimize sum of squared deficits
  for (const [groupKey, groupBesoins] of Array.from(besoinGroups.entries()).sort()) {
    const [date, periode, specialiteId] = groupKey.split('|');
    console.log(`\n🔄 Processing group: ${date} ${periode} specialite=${specialiteId.substring(0, 8)}`);
    
    // Get available capacities for this (date, periode, specialite)
    const availableCaps = validCapacites.filter(
      cap =>
        cap.date === date &&
        cap.periode === (periode as 'matin' | 'apres_midi') &&
        cap.specialites.includes(specialiteId) &&
        !usedCapacities.has(cap.id)
    );
    
    console.log(`   Available capacities: ${availableCaps.length}`);
    console.log(`   Besoins in group: ${groupBesoins.length} sites`);
    groupBesoins.forEach(b => {
      console.log(`     - ${b.site_nom}: needs ${b.nombre_secretaires_requis} (fermeture: ${b.site_fermeture})`);
    });
    
    // Handle 1R/2F for fermeture sites (priority assignment)
    const fermetureBesoins = groupBesoins.filter(b => b.site_fermeture);
    
    for (const fermetureBesoin of fermetureBesoins) {
      if (periode === 'matin') {
        // Find afternoon besoin for same site
        const afternoonBesoin = besoins.find(
          b =>
            b.site_id === fermetureBesoin.site_id &&
            b.date === fermetureBesoin.date &&
            b.periode === 'apres_midi' &&
            b.specialite_id === fermetureBesoin.specialite_id
        );
        
        if (afternoonBesoin) {
          // Find capacities available for both AM and PM
          const afternoonCaps = validCapacites.filter(
            cap =>
              cap.date === date &&
              cap.periode === 'apres_midi' &&
              cap.specialites.includes(specialiteId) &&
              !usedCapacities.has(cap.id)
          );
          
          // Find someone who has both AM and PM available
          for (const amCap of availableCaps) {
            const secretaireId = amCap.secretaire_id || amCap.backup_id;
            const pmCap = afternoonCaps.find(
              c => (c.secretaire_id || c.backup_id) === secretaireId
            );
            
            if (pmCap && secretaireId) {
              // Assign this person to both AM (1R) and PM (2F)
              allAssignments.get(fermetureBesoin.id)!.capacites_assignees.push({
                id: amCap.id,
                secretaire_id: amCap.secretaire_id,
                backup_id: amCap.backup_id,
                nom_complet: amCap.nom_complet,
                is_backup: !!amCap.backup_id,
                is_1r: true,
              });
              
              allAssignments.get(afternoonBesoin.id)!.capacites_assignees.push({
                id: pmCap.id,
                secretaire_id: pmCap.secretaire_id,
                backup_id: pmCap.backup_id,
                nom_complet: pmCap.nom_complet,
                is_backup: !!pmCap.backup_id,
                is_2f: true,
              });
              
              usedCapacities.add(amCap.id);
              usedCapacities.add(pmCap.id);
              
              // Remove from available
              const amIdx = availableCaps.findIndex(c => c.id === amCap.id);
              if (amIdx >= 0) availableCaps.splice(amIdx, 1);
              
              console.log(`   ✅ 1R/2F: Assigned ${amCap.nom_complet} to ${fermetureBesoin.site_nom} (fermeture)`);
              break;
            }
          }
        }
      }
    }
    
    // Greedy: repeatedly assign one capacity to the besoin with highest remaining deficit
    while (availableCaps.length > 0) {
      // Calculate current deficit for each besoin in this group
      let maxDeficit = -1;
      let maxDeficitBesoin: CreneauBesoin | null = null;
      
      for (const b of groupBesoins) {
        const assignment = allAssignments.get(b.id)!;
        const assigned = assignment.capacites_assignees.length;
        const deficit = Math.ceil(b.nombre_secretaires_requis) - assigned;
        
        if (deficit > maxDeficit) {
          maxDeficit = deficit;
          maxDeficitBesoin = b;
        }
      }
      
      if (!maxDeficitBesoin || maxDeficit <= 0) {
        // All besoins in this group are satisfied
        break;
      }
      
      // Assign next available capacity to maxDeficitBesoin
      const cap = availableCaps.shift()!;
      const assignment = allAssignments.get(maxDeficitBesoin.id)!;
      
      assignment.capacites_assignees.push({
        id: cap.id,
        secretaire_id: cap.secretaire_id,
        backup_id: cap.backup_id,
        nom_complet: cap.nom_complet,
        is_backup: !!cap.backup_id,
        is_1r: false,
        is_2f: false,
      });
      
      usedCapacities.add(cap.id);
      
      console.log(`   📌 Assigned ${cap.nom_complet} to ${maxDeficitBesoin.site_nom} (deficit was ${maxDeficit})`);
    }
  }
  
  // Convert to array
  const assignments = Array.from(allAssignments.values());
  
  // Unused capacities -> administratif
  const unusedCapacites = validCapacites.filter(cap => !usedCapacities.has(cap.id));
  console.log(`\n📋 Unused capacities (Administratif): ${unusedCapacites.length}`);
  
  // Calculate scoring: minimize squared deficit
  let totalSquaredDeficit = 0;
  let totalSatisfiedCount = 0;
  let totalPartialCount = 0;
  let totalUnsatisfiedCount = 0;
  
  for (const assignment of assignments) {
    const required = Math.ceil(assignment.creneau_besoin.nombre_secretaires_requis);
    const assigned = assignment.capacites_assignees.length;
    const deficit = Math.max(0, required - assigned);
    
    totalSquaredDeficit += deficit * deficit;
    
    if (assigned >= required) {
      totalSatisfiedCount++;
    } else if (assigned > 0) {
      totalPartialCount++;
    } else {
      totalUnsatisfiedCount++;
    }
  }
  
  // Score = -100 * sum(deficit²) to prioritize minimizing squared deficit
  const score_base = -100 * totalSquaredDeficit;
  const penalites = {
    changement_site: 0,
    multiple_fermetures: 0,
    centre_esplanade_depassement: 0,
  };
  const score_total = score_base;
  
  console.log(`\n✅ Optimization complete:`);
  console.log(`   Total squared deficit: ${totalSquaredDeficit}`);
  console.log(`   Score: ${score_total} (= -100 × ${totalSquaredDeficit})`);
  console.log(`   Satisfied: ${totalSatisfiedCount}, Partial: ${totalPartialCount}, Unsatisfied: ${totalUnsatisfiedCount}`);
  
  const stats = {
    satisfait: totalSatisfiedCount,
    partiel: totalPartialCount,
    non_satisfait: totalUnsatisfiedCount,
  };
  
  // Log specific example for validation (2025-09-30)
  const exampleDate = '2025-09-30';
  const exampleBesoins = assignments.filter(a => a.creneau_besoin.date === exampleDate);
  if (exampleBesoins.length > 0) {
    console.log(`\n🔍 Example validation for ${exampleDate}:`);
    for (const a of exampleBesoins) {
      const required = Math.ceil(a.creneau_besoin.nombre_secretaires_requis);
      const assigned = a.capacites_assignees.length;
      console.log(`   ${a.creneau_besoin.site_nom}: ${assigned}/${required} assigned`);
    }
  }

  return {
    assignments: convertToAssignmentResults(assignments),
    unusedCapacites,
    stats,
    score_base,
    penalites,
    score_total,
  };
}

function convertToAssignmentResults(assignments: Assignment[]) {
  return assignments.map(assignment => {
    const required = Math.ceil(assignment.creneau_besoin.nombre_secretaires_requis);
    const assigned = assignment.capacites_assignees.length;
    
    let status: 'satisfait' | 'arrondi_inferieur' | 'non_satisfait';
    if (assigned >= required) {
      status = 'satisfait';
    } else if (assigned > 0) {
      status = 'arrondi_inferieur';
    } else {
      status = 'non_satisfait';
    }
    
    return {
      creneau_besoin_id: assignment.creneau_besoin.id,
      date: assignment.creneau_besoin.date,
      periode: assignment.creneau_besoin.periode,
      site_id: assignment.creneau_besoin.site_id,
      site_nom: assignment.creneau_besoin.site_nom,
      site_fermeture: assignment.creneau_besoin.site_fermeture,
      medecins: assignment.creneau_besoin.medecin_noms,
      secretaires: assignment.capacites_assignees.map(cap => ({
        id: cap.id,
        secretaire_id: cap.secretaire_id,
        backup_id: cap.backup_id,
        nom: cap.nom_complet,
        is_backup: cap.is_backup,
        is_1r: cap.is_1r,
        is_2f: cap.is_2f,
      })),
      nombre_requis: required,
      nombre_assigne: assigned,
      status,
      type_assignation: 'site',
    };
  });
}
