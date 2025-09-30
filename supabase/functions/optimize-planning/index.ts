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
  specialite_id: string;
  nombre_secretaires_requis: number;
  type: 'medecin' | 'bloc_operatoire';
  site_fermeture: boolean;
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
      .select('*, sites!inner(nom, fermeture)')
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

    if (heureDebut < MATIN_END && heureFin > MATIN_START) {
      creneaux.push({
        id: `${besoin.id}-matin`,
        date: besoin.date,
        periode: 'matin',
        site_id: besoin.site_id,
        site_nom: besoin.sites.nom,
        specialite_id: besoin.specialite_id,
        nombre_secretaires_requis: besoin.nombre_secretaires_requis,
        type: besoin.type,
        site_fermeture: besoin.sites.fermeture || false,
      });
    }

    if (heureDebut < APRES_MIDI_END && heureFin > APRES_MIDI_START) {
      creneaux.push({
        id: `${besoin.id}-apres_midi`,
        date: besoin.date,
        periode: 'apres_midi',
        site_id: besoin.site_id,
        site_nom: besoin.sites.nom,
        specialite_id: besoin.specialite_id,
        nombre_secretaires_requis: besoin.nombre_secretaires_requis,
        type: besoin.type,
        site_fermeture: besoin.sites.fermeture || false,
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
  const usedCapacites = new Set<string>();

  // Sort by priority
  const sortedBesoins = [...besoins].sort((a, b) => {
    if (a.type === 'bloc_operatoire' && b.type !== 'bloc_operatoire') return -1;
    if (a.type !== 'bloc_operatoire' && b.type === 'bloc_operatoire') return 1;
    if (a.site_fermeture && !b.site_fermeture) return -1;
    if (!a.site_fermeture && b.site_fermeture) return 1;
    return 0;
  });

  for (const besoin of sortedBesoins) {
    const matchingCapacites = capacites.filter(cap =>
      !usedCapacites.has(cap.id) &&
      cap.date === besoin.date &&
      cap.periode === besoin.periode &&
      cap.specialites.includes(besoin.specialite_id)
    );

    const nombreRequis = Math.ceil(besoin.nombre_secretaires_requis);
    const assignedCapacites: CreneauCapacite[] = [];

    if (besoin.site_fermeture) {
      const capacites1R = matchingCapacites.filter(c => !c.backup_id);
      const capacites2F = matchingCapacites.filter(c => c.backup_id);

      if (capacites1R.length > 0 && capacites2F.length > 0) {
        assignedCapacites.push(capacites1R[0], capacites2F[0]);
        usedCapacites.add(capacites1R[0].id);
        usedCapacites.add(capacites2F[0].id);

        const remaining = nombreRequis - 2;
        for (let i = 0; i < remaining; i++) {
          const nextCap = matchingCapacites.find(c => !usedCapacites.has(c.id));
          if (nextCap) {
            assignedCapacites.push(nextCap);
            usedCapacites.add(nextCap.id);
          }
        }
      }
    } else {
      for (let i = 0; i < nombreRequis && i < matchingCapacites.length; i++) {
        if (!usedCapacites.has(matchingCapacites[i].id)) {
          assignedCapacites.push(matchingCapacites[i]);
          usedCapacites.add(matchingCapacites[i].id);
        }
      }
    }

    const nombreAssigne = assignedCapacites.length;
    let status: 'satisfait' | 'arrondi_inferieur' | 'non_satisfait';
    if (nombreAssigne >= nombreRequis) {
      status = 'satisfait';
    } else if (nombreAssigne >= Math.floor(besoin.nombre_secretaires_requis)) {
      status = 'arrondi_inferieur';
    } else {
      status = 'non_satisfait';
    }

    assignments.push({
      creneau_besoin_id: besoin.id,
      date: besoin.date,
      periode: besoin.periode,
      site_id: besoin.site_id,
      site_nom: besoin.site_nom,
      secretaires: assignedCapacites.map(c => ({
        id: c.secretaire_id || c.backup_id || '',
        nom: c.nom_complet,
        is_backup: !!c.backup_id,
      })),
      nombre_requis: nombreRequis,
      nombre_assigne: nombreAssigne,
      status,
      has_1r: assignedCapacites.some(c => !c.backup_id),
      has_2f: assignedCapacites.some(c => c.backup_id),
    });
  }

  const scoreBase = assignments.reduce((sum, a) => 
    sum + Math.min(a.nombre_assigne, a.nombre_requis) / a.nombre_requis, 0
  );

  return {
    assignments,
    score_base: scoreBase,
    penalites: { changement_site: 0, multiple_fermetures: 0, centre_esplanade_depassement: 0 },
    score_total: scoreBase,
  };
}
