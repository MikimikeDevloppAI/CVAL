import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    const { weekStart } = await req.json();
    const startDate = new Date(weekStart);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 6);

    console.log(`📅 Generating planning for week: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);

    // Fetch besoins
    const { data: besoins, error: besoinsError } = await supabase
      .from('besoin_effectif')
      .select('*, sites!inner(nom, fermeture), medecins(first_name, name)')
      .gte('date', startDate.toISOString().split('T')[0])
      .lte('date', endDate.toISOString().split('T')[0])
      .eq('actif', true);

    if (besoinsError) throw besoinsError;

    // Fetch capacites
    const { data: capacites, error: capacitesError } = await supabase
      .from('capacite_effective')
      .select(`
        *,
        secretaires(first_name, name, prefere_port_en_truie),
        backup(first_name, name)
      `)
      .gte('date', startDate.toISOString().split('T')[0])
      .lte('date', endDate.toISOString().split('T')[0])
      .eq('actif', true);

    if (capacitesError) throw capacitesError;

    console.log(`📊 Found ${besoins?.length || 0} besoins and ${capacites?.length || 0} capacites`);

    // Split into creneaux and group by site/date/periode
    const creneauxBesoins = groupBesoinsEnCreneaux(besoins);
    const creneauxCapacites = splitCapacitesEnCreneaux(capacites);

    console.log(`🔄 Grouped into ${creneauxBesoins.length} grouped besoins and ${creneauxCapacites.length} capacite slots`);

    // Run optimization
    const result = optimizePlanning(creneauxBesoins, creneauxCapacites);

    console.log(`✅ Optimization complete: Score ${result.score_total}`);

    // Save to planning_genere table
    try {
      // Clear existing planning for this week
      const { error: deleteError } = await supabase
        .from('planning_genere')
        .delete()
        .gte('date', startDate.toISOString().split('T')[0])
        .lte('date', endDate.toISOString().split('T')[0]);

      if (deleteError) throw deleteError;

      // Insert new planning
      const planningRows = [];
      for (const assignment of result.assignments) {
        for (const secretaire of assignment.secretaires) {
          planningRows.push({
            date: assignment.date,
            heure_debut: assignment.periode === 'matin' ? '07:30:00' : '13:00:00',
            heure_fin: assignment.periode === 'matin' ? '12:00:00' : '17:00:00',
            site_id: assignment.site_id,
            medecin_id: null,
            secretaire_id: secretaire.is_backup ? null : secretaire.id,
            type: assignment.medecins[0] === 'Bloc opératoire' ? 'bloc_operatoire' : 'medecin',
            statut: assignment.status === 'satisfait' ? 'confirme' : 'planifie',
            version_planning: 1,
          });
        }
      }

      if (planningRows.length > 0) {
        const { error: insertError } = await supabase
          .from('planning_genere')
          .insert(planningRows);

        if (insertError) {
          console.error('❌ Error saving planning:', insertError);
        } else {
          console.log(`✅ Planning saved: ${planningRows.length} rows`);
        }
      }
    } catch (error) {
      console.error('❌ Error in planning save:', error);
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
  const MATIN_START = '07:30:00';
  const MATIN_END = '12:00:00';
  const APRES_MIDI_START = '13:00:00';
  const APRES_MIDI_END = '17:00:00';

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
    if (heureDebut < MATIN_END && heureFin > MATIN_START) {
      slots.push({ periode: 'matin' });
    }
    
    // Check if overlaps with afternoon
    if (heureDebut < APRES_MIDI_END && heureFin > APRES_MIDI_START) {
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
  const creneaux: CreneauCapacite[] = [];
  const MATIN_START = '07:30:00';
  const MATIN_END = '12:00:00';
  const APRES_MIDI_START = '13:00:00';
  const APRES_MIDI_END = '17:00:00';

  for (const capacite of capacites) {
    const heureDebut = capacite.heure_debut;
    const heureFin = capacite.heure_fin;
    
    const isBackup = !!capacite.backup_id;
    const personne = isBackup ? capacite.backup : capacite.secretaires;
    if (!personne) continue;

    const nomComplet = `${personne.first_name || ''} ${personne.name || ''}`.trim();
    const preferePortEnTruie = isBackup ? false : (personne.prefere_port_en_truie || false);

    if (heureDebut < MATIN_END && heureFin > MATIN_START) {
      creneaux.push({
        id: `${capacite.id}-matin`,
        date: capacite.date,
        periode: 'matin',
        secretaire_id: capacite.secretaire_id,
        backup_id: capacite.backup_id,
        nom_complet: nomComplet,
        specialites: capacite.specialites || [],
        prefere_port_en_truie: preferePortEnTruie,
      });
    }

    if (heureDebut < APRES_MIDI_END && heureFin > APRES_MIDI_START) {
      creneaux.push({
        id: `${capacite.id}-apres_midi`,
        date: capacite.date,
        periode: 'apres_midi',
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

function optimizePlanning(besoins: CreneauBesoin[], capacites: CreneauCapacite[]) {
  const assignments: any[] = [];
  const usedCapaciteIds = new Set<string>();
  
  // Map to track 1R/2F assignments per day per site with fermeture
  const fermetureAssignments = new Map<string, { 
    secretaire1R?: { secretaire_id?: string, backup_id?: string },
    secretaire2F?: { secretaire_id?: string, backup_id?: string }
  }>();

  // Sort by priority: fermeture sites first, then by required secretaries
  const sortedBesoins = [...besoins].sort((a, b) => {
    if (a.site_fermeture && !b.site_fermeture) return -1;
    if (!a.site_fermeture && b.site_fermeture) return 1;
    return b.nombre_secretaires_requis - a.nombre_secretaires_requis;
  });

  // Group besoins by date and site to handle matin/apres_midi together for fermeture sites
  const besoinsByDateSite = new Map<string, CreneauBesoin[]>();
  for (const besoin of sortedBesoins) {
    const key = `${besoin.date}-${besoin.site_id}`;
    if (!besoinsByDateSite.has(key)) {
      besoinsByDateSite.set(key, []);
    }
    besoinsByDateSite.get(key)!.push(besoin);
  }

  for (const [dateSiteKey, siteBesoins] of besoinsByDateSite) {
    const matin = siteBesoins.find(b => b.periode === 'matin');
    const apresMidi = siteBesoins.find(b => b.periode === 'apres_midi');
    
    if (siteBesoins[0].site_fermeture && matin && apresMidi) {
      // For fermeture sites, assign same 1R and 2F for both periods
      const dayKey = `${siteBesoins[0].site_id}-${siteBesoins[0].date}`;
      
      const matinCapacites = capacites.filter(cap =>
        !usedCapaciteIds.has(cap.id) &&
        cap.date === matin.date &&
        cap.periode === 'matin' &&
        cap.specialites.includes(matin.specialite_id)
      );
      
      const apresMidiCapacites = capacites.filter(cap =>
        !usedCapaciteIds.has(cap.id) &&
        cap.date === apresMidi.date &&
        cap.periode === 'apres_midi' &&
        cap.specialites.includes(apresMidi.specialite_id)
      );

      // Find 1R (non-backup) available both matin and apres-midi
      const capacites1R = matinCapacites.filter(c => !c.backup_id);
      let selected1R_matin: CreneauCapacite | null = null;
      let selected1R_apresMidi: CreneauCapacite | null = null;
      
      for (const r1 of capacites1R) {
        const amMatch = apresMidiCapacites.find(c => 
          c.secretaire_id === r1.secretaire_id && !c.backup_id && !usedCapaciteIds.has(c.id)
        );
        if (amMatch) {
          selected1R_matin = r1;
          selected1R_apresMidi = amMatch;
          break;
        }
      }

      // Find 2F (backup) available both matin and apres-midi
      const capacites2F = matinCapacites.filter(c => !!c.backup_id);
      let selected2F_matin: CreneauCapacite | null = null;
      let selected2F_apresMidi: CreneauCapacite | null = null;
      
      for (const f2 of capacites2F) {
        const amMatch = apresMidiCapacites.find(c => 
          c.backup_id === f2.backup_id && !!c.backup_id && !usedCapaciteIds.has(c.id)
        );
        if (amMatch) {
          selected2F_matin = f2;
          selected2F_apresMidi = amMatch;
          break;
        }
      }

      // Store fermeture assignments
      if (selected1R_matin) {
        fermetureAssignments.set(dayKey, {
          ...fermetureAssignments.get(dayKey),
          secretaire1R: { secretaire_id: selected1R_matin.secretaire_id, backup_id: selected1R_matin.backup_id }
        });
      }
      if (selected2F_matin) {
        fermetureAssignments.set(dayKey, {
          ...fermetureAssignments.get(dayKey),
          secretaire2F: { secretaire_id: selected2F_matin.secretaire_id, backup_id: selected2F_matin.backup_id }
        });
      }

      // Assign matin
      const matinAssigned: CreneauCapacite[] = [];
      if (selected1R_matin) {
        matinAssigned.push(selected1R_matin);
        usedCapaciteIds.add(selected1R_matin.id);
      }
      if (selected2F_matin) {
        matinAssigned.push(selected2F_matin);
        usedCapaciteIds.add(selected2F_matin.id);
      }

      // Fill remaining spots for matin
      const matinRequis = Math.ceil(matin.nombre_secretaires_requis);
      const matinRemaining = matinRequis - matinAssigned.length;
      for (let i = 0; i < matinRemaining; i++) {
        const nextCap = matinCapacites.find(c => !usedCapaciteIds.has(c.id));
        if (nextCap) {
          matinAssigned.push(nextCap);
          usedCapaciteIds.add(nextCap.id);
        }
      }

      // Assign apres-midi
      const apresMidiAssigned: CreneauCapacite[] = [];
      if (selected1R_apresMidi) {
        apresMidiAssigned.push(selected1R_apresMidi);
        usedCapaciteIds.add(selected1R_apresMidi.id);
      }
      if (selected2F_apresMidi) {
        apresMidiAssigned.push(selected2F_apresMidi);
        usedCapaciteIds.add(selected2F_apresMidi.id);
      }

      // Fill remaining spots for apres-midi
      const apresMidiRequis = Math.ceil(apresMidi.nombre_secretaires_requis);
      const apresMidiRemaining = apresMidiRequis - apresMidiAssigned.length;
      for (let i = 0; i < apresMidiRemaining; i++) {
        const nextCap = apresMidiCapacites.find(c => !usedCapaciteIds.has(c.id));
        if (nextCap) {
          apresMidiAssigned.push(nextCap);
          usedCapaciteIds.add(nextCap.id);
        }
      }

      // Create assignments
      assignments.push(createAssignment(matin, matinAssigned, fermetureAssignments.get(dayKey)));
      assignments.push(createAssignment(apresMidi, apresMidiAssigned, fermetureAssignments.get(dayKey)));
      
    } else {
      // For non-fermeture sites or single period
      for (const besoin of siteBesoins) {
        const matchingCapacites = capacites.filter(cap =>
          !usedCapaciteIds.has(cap.id) &&
          cap.date === besoin.date &&
          cap.periode === besoin.periode &&
          cap.specialites.includes(besoin.specialite_id)
        );

        const nombreRequis = Math.ceil(besoin.nombre_secretaires_requis);
        const assignedCapacites: CreneauCapacite[] = [];

        for (let i = 0; i < nombreRequis && i < matchingCapacites.length; i++) {
          if (!usedCapaciteIds.has(matchingCapacites[i].id)) {
            assignedCapacites.push(matchingCapacites[i]);
            usedCapaciteIds.add(matchingCapacites[i].id);
          }
        }

        assignments.push(createAssignment(besoin, assignedCapacites, undefined));
      }
    }
  }

  // Calculate score with extreme penalty for red
  let scoreBase = 0;
  let redPenalty = 0;
  
  for (const a of assignments) {
    if (a.status === 'satisfait') {
      scoreBase += 1.0;
    } else if (a.status === 'arrondi_inferieur') {
      scoreBase += 0.7;
    } else {
      scoreBase += 0.0;
      redPenalty += 100; // Extreme penalty for red
    }
  }

  return {
    assignments,
    score_base: scoreBase,
    penalites: { changement_site: 0, multiple_fermetures: 0, centre_esplanade_depassement: 0 },
    score_total: scoreBase - redPenalty,
  };
}

function createAssignment(
  besoin: CreneauBesoin, 
  assignedCapacites: CreneauCapacite[],
  fermetureInfo?: { 
    secretaire1R?: { secretaire_id?: string, backup_id?: string },
    secretaire2F?: { secretaire_id?: string, backup_id?: string }
  }
) {
  const nombreRequis = Math.ceil(besoin.nombre_secretaires_requis);
  const nombreAssigne = assignedCapacites.length;
  
  let status: 'satisfait' | 'arrondi_inferieur' | 'non_satisfait';
  if (nombreAssigne >= nombreRequis) {
    status = 'satisfait';
  } else if (nombreAssigne >= Math.floor(besoin.nombre_secretaires_requis)) {
    status = 'arrondi_inferieur';
  } else {
    status = 'non_satisfait';
  }

  return {
    creneau_besoin_id: besoin.id,
    date: besoin.date,
    periode: besoin.periode,
    site_id: besoin.site_id,
    site_nom: besoin.site_nom,
    site_fermeture: besoin.site_fermeture,
    medecins: besoin.medecin_noms.length > 0 ? besoin.medecin_noms : ['Bloc opératoire'],
    secretaires: assignedCapacites.map(c => {
      const personId = c.secretaire_id || c.backup_id;
      let is1R = false;
      let is2F = false;
      
      if (besoin.site_fermeture && fermetureInfo) {
        const is1RMatch = fermetureInfo.secretaire1R && 
          ((c.secretaire_id && c.secretaire_id === fermetureInfo.secretaire1R.secretaire_id) ||
           (c.backup_id && c.backup_id === fermetureInfo.secretaire1R.backup_id));
        const is2FMatch = fermetureInfo.secretaire2F && 
          ((c.secretaire_id && c.secretaire_id === fermetureInfo.secretaire2F.secretaire_id) ||
           (c.backup_id && c.backup_id === fermetureInfo.secretaire2F.backup_id));
        
        is1R = besoin.periode === 'matin' && !!is1RMatch;
        is2F = besoin.periode === 'apres_midi' && !!is2FMatch;
      }
      
      return {
        id: personId || '',
        nom: c.nom_complet,
        is_backup: !!c.backup_id,
        is_1r: is1R,
        is_2f: is2F,
      };
    }),
    nombre_requis: nombreRequis,
    nombre_assigne: nombreAssigne,
    status,
  };
}
