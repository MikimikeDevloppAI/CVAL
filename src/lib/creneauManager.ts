import { CreneauBesoin, CreneauCapacite, Periode } from '@/types/planning';

const MATIN_START = '07:30:00';
const MATIN_END = '12:00:00';
const APRES_MIDI_START = '13:00:00';
const APRES_MIDI_END = '17:00:00';

function timeInRange(time: string, start: string, end: string): boolean {
  return time >= start && time < end;
}

function hasOverlap(start1: string, end1: string, start2: string, end2: string): boolean {
  return start1 < end2 && end1 > start2;
}

export function splitBesoinsEnCreneaux(
  besoins: any[],
  sites: Map<string, any>
): CreneauBesoin[] {
  const creneaux: CreneauBesoin[] = [];

  for (const besoin of besoins) {
    const site = sites.get(besoin.site_id);
    if (!site) continue;

    const heureDebut = besoin.heure_debut;
    const heureFin = besoin.heure_fin;

    // Check overlap with morning slot
    if (hasOverlap(heureDebut, heureFin, MATIN_START, MATIN_END)) {
      creneaux.push({
        id: `${besoin.id}-matin`,
        date: besoin.date,
        periode: 'matin',
        site_id: besoin.site_id,
        site_nom: site.nom,
        specialite_id: besoin.specialite_id || '',
        type: besoin.type,
        medecin_ids: besoin.medecin_id ? [besoin.medecin_id] : [],
        medecin_noms: [],
        bloc_operatoire_besoin_id: besoin.bloc_operatoire_besoin_id,
        site_fermeture: site.fermeture || false,
      });
    }

    // Check overlap with afternoon slot
    if (hasOverlap(heureDebut, heureFin, APRES_MIDI_START, APRES_MIDI_END)) {
      creneaux.push({
        id: `${besoin.id}-apres_midi`,
        date: besoin.date,
        periode: 'apres_midi',
        site_id: besoin.site_id,
        site_nom: site.nom,
        specialite_id: besoin.specialite_id || '',
        type: besoin.type,
        medecin_ids: besoin.medecin_id ? [besoin.medecin_id] : [],
        medecin_noms: [],
        bloc_operatoire_besoin_id: besoin.bloc_operatoire_besoin_id,
        site_fermeture: site.fermeture || false,
      });
    }
  }

  return creneaux;
}

export function splitCapacitesEnCreneaux(
  capacites: any[],
  secretaires: Map<string, any>,
  backup: Map<string, any>
): CreneauCapacite[] {
  const creneaux: CreneauCapacite[] = [];

  for (const capacite of capacites) {
    const heureDebut = capacite.heure_debut;
    const heureFin = capacite.heure_fin;

    const isBackup = !!capacite.backup_id;
    const personne = isBackup 
      ? backup.get(capacite.backup_id)
      : secretaires.get(capacite.secretaire_id);

    if (!personne) continue;

    const nomComplet = `${personne.first_name || ''} ${personne.name || ''}`.trim();

    // Check overlap with morning slot
    if (hasOverlap(heureDebut, heureFin, MATIN_START, MATIN_END)) {
      creneaux.push({
        id: `${capacite.id}-matin`,
        date: capacite.date,
        periode: 'matin',
        secretaire_id: capacite.secretaire_id,
        backup_id: capacite.backup_id,
        nom_complet: nomComplet,
        specialites: capacite.specialites || [],
        prefere_port_en_truie: personne.prefere_port_en_truie || false,
      });
    }

    // Check overlap with afternoon slot
    if (hasOverlap(heureDebut, heureFin, APRES_MIDI_START, APRES_MIDI_END)) {
      creneaux.push({
        id: `${capacite.id}-apres_midi`,
        date: capacite.date,
        periode: 'apres_midi',
        secretaire_id: capacite.secretaire_id,
        backup_id: capacite.backup_id,
        nom_complet: nomComplet,
        specialites: capacite.specialites || [],
        prefere_port_en_truie: personne.prefere_port_en_truie || false,
      });
    }
  }

  return creneaux;
}
