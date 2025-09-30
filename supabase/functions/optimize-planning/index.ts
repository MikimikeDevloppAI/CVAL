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
  medecin_nom: string;
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

    // Split into creneaux
    const creneauxBesoins = splitBesoinsEnCreneaux(besoins);
    const creneauxCapacites = splitCapacitesEnCreneaux(capacites);

    // Run optimization
    const result = optimizePlanning(creneauxBesoins, creneauxCapacites);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in optimize-planning:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function splitBesoinsEnCreneaux(besoins: any[]): CreneauBesoin[] {
  const creneaux: CreneauBesoin[] = [];
  const MATIN_START = '07:30:00';
  const MATIN_END = '12:00:00';
  const APRES_MIDI_START = '13:00:00';
  const APRES_MIDI_END = '17:00:00';

  for (const besoin of besoins) {
    const heureDebut = besoin.heure_debut;
    const heureFin = besoin.heure_fin;
    const medecinNom = besoin.medecins 
      ? `${besoin.medecins.first_name || ''} ${besoin.medecins.name || ''}`.trim()
      : 'Bloc opératoire';

    if (heureDebut < MATIN_END && heureFin > MATIN_START) {
      creneaux.push({
        id: `${besoin.id}-matin`,
        date: besoin.date,
        periode: 'matin',
        site_id: besoin.site_id,
        site_nom: besoin.sites.nom,
        site_fermeture: besoin.sites.fermeture || false,
        specialite_id: besoin.specialite_id,
        nombre_secretaires_requis: besoin.nombre_secretaires_requis,
        type: besoin.type,
        medecin_nom: medecinNom,
      });
    }

    if (heureDebut < APRES_MIDI_END && heureFin > APRES_MIDI_START) {
      creneaux.push({
        id: `${besoin.id}-apres_midi`,
        date: besoin.date,
        periode: 'apres_midi',
        site_id: besoin.site_id,
        site_nom: besoin.sites.nom,
        site_fermeture: besoin.sites.fermeture || false,
        specialite_id: besoin.specialite_id,
        nombre_secretaires_requis: besoin.nombre_secretaires_requis,
        type: besoin.type,
        medecin_nom: medecinNom,
      });
    }
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
  const fermetureAssignments = new Map<string, { r1_id?: string, f2_id?: string }>();

  // Sort by priority with EXTREME penalty for non_satisfait
  const sortedBesoins = [...besoins].sort((a, b) => {
    if (a.type === 'bloc_operatoire' && b.type !== 'bloc_operatoire') return -1;
    if (a.type !== 'bloc_operatoire' && b.type === 'bloc_operatoire') return 1;
    if (a.site_fermeture && !b.site_fermeture) return -1;
    if (!a.site_fermeture && b.site_fermeture) return 1;
    return 0;
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
      // For fermeture sites, assign same 1R/2F for both periods
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

      const capacites1R = matinCapacites.filter(c => !c.backup_id);
      const capacites2F = matinCapacites.filter(c => c.backup_id);
      
      let selected1R: CreneauCapacite | null = null;
      let selected2F: CreneauCapacite | null = null;
      let selected1R_am: CreneauCapacite | null = null;
      let selected2F_am: CreneauCapacite | null = null;

      // Find 1R available both matin and apres-midi
      for (const r1 of capacites1R) {
        const personId = r1.secretaire_id;
        const amMatch = apresMidiCapacites.find(c => 
          c.secretaire_id === personId && !c.backup_id && !usedCapaciteIds.has(c.id)
        );
        if (amMatch) {
          selected1R = r1;
          selected1R_am = amMatch;
          break;
        }
      }

      // Find 2F available both matin and apres-midi
      for (const f2 of capacites2F) {
        const personId = f2.backup_id;
        const amMatch = apresMidiCapacites.find(c => 
          c.backup_id === personId && !!c.backup_id && !usedCapaciteIds.has(c.id)
        );
        if (amMatch) {
          selected2F = f2;
          selected2F_am = amMatch;
          break;
        }
      }

      // Assign matin
      const matinAssigned: CreneauCapacite[] = [];
      if (selected1R) {
        matinAssigned.push(selected1R);
        usedCapaciteIds.add(selected1R.id);
      }
      if (selected2F) {
        matinAssigned.push(selected2F);
        usedCapaciteIds.add(selected2F.id);
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
      if (selected1R_am) {
        apresMidiAssigned.push(selected1R_am);
        usedCapaciteIds.add(selected1R_am.id);
      }
      if (selected2F_am) {
        apresMidiAssigned.push(selected2F_am);
        usedCapaciteIds.add(selected2F_am.id);
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
      assignments.push(createAssignment(matin, matinAssigned, selected1R, selected2F));
      assignments.push(createAssignment(apresMidi, apresMidiAssigned, selected1R_am, selected2F_am));
      
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

        assignments.push(createAssignment(besoin, assignedCapacites, null, null));
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
  selected1R: CreneauCapacite | null,
  selected2F: CreneauCapacite | null
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
    medecins: [besoin.medecin_nom],
    secretaires: assignedCapacites.map(c => {
      const personId = c.secretaire_id || c.backup_id;
      const is1R = besoin.site_fermeture && selected1R && (selected1R.secretaire_id === personId || selected1R.backup_id === personId);
      const is2F = besoin.site_fermeture && selected2F && (selected2F.secretaire_id === personId || selected2F.backup_id === personId);
      
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
