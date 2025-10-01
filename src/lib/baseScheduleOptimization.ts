import type { Database } from "@/integrations/supabase/types";
import {
  HoraireBaseBesoin,
  HoraireBaseCapacite,
  OptimizationScoreParSpecialite,
  BaseScheduleOptimizationResult,
  DemiJournee,
  OptimizationDetailJour,
} from "@/types/baseSchedule";

type HoraireBaseMedecin = Database['public']['Tables']['horaires_base_medecins']['Row'];
type HoraireBaseSecretaire = Database['public']['Tables']['horaires_base_secretaires']['Row'];
type Medecin = Database['public']['Tables']['medecins']['Row'];
type Secretaire = Database['public']['Tables']['secretaires']['Row'];
type Backup = Database['public']['Tables']['backup']['Row'];
type Specialite = Database['public']['Tables']['specialites']['Row'];

const JOURS_SEMAINE = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];

function splitHoraireToDemiJournees(heure_debut: string, heure_fin: string): DemiJournee[] {
  const debut = heure_debut.split(':').map(Number);
  const fin = heure_fin.split(':').map(Number);
  const debutMinutes = debut[0] * 60 + debut[1];
  const finMinutes = fin[0] * 60 + fin[1];
  
  const matinDebut = 7 * 60 + 30; // 07:30
  const matinFin = 12 * 60; // 12:00
  const apremDebut = 13 * 60; // 13:00
  const apremFin = 17 * 60; // 17:00
  
  const demiJournees: DemiJournee[] = [];
  
  // Check if overlaps with morning
  if (debutMinutes < matinFin && finMinutes > matinDebut) {
    demiJournees.push('matin');
  }
  
  // Check if overlaps with afternoon
  if (debutMinutes < apremFin && finMinutes > apremDebut) {
    demiJournees.push('apres_midi');
  }
  
  return demiJournees;
}

function calculateDemiJourneeHours(
  heure_debut: string,
  heure_fin: string,
  demiJournee: DemiJournee
): number {
  const debut = heure_debut.split(':').map(Number);
  const fin = heure_fin.split(':').map(Number);
  const debutMinutes = debut[0] * 60 + debut[1];
  const finMinutes = fin[0] * 60 + fin[1];
  
  const matinDebut = 7 * 60 + 30; // 07:30
  const matinFin = 12 * 60; // 12:00
  const apremDebut = 13 * 60; // 13:00
  const apremFin = 17 * 60; // 17:00
  
  let overlapDebut: number;
  let overlapFin: number;
  
  if (demiJournee === 'matin') {
    overlapDebut = Math.max(debutMinutes, matinDebut);
    overlapFin = Math.min(finMinutes, matinFin);
  } else {
    overlapDebut = Math.max(debutMinutes, apremDebut);
    overlapFin = Math.min(finMinutes, apremFin);
  }
  
  if (overlapFin <= overlapDebut) return 0;
  
  const minutes = overlapFin - overlapDebut;
  return minutes / 60; // Convert to hours
}

export function aggregateBesoins(
  horairesMedecins: HoraireBaseMedecin[],
  medecins: Medecin[],
  specialites: Specialite[]
): HoraireBaseBesoin[] {
  const besoinsMap = new Map<string, HoraireBaseBesoin>();
  
  for (const horaire of horairesMedecins) {
    if (!horaire.actif) continue;
    
    const medecin = medecins.find(m => m.id === horaire.medecin_id);
    if (!medecin || !medecin.actif) continue;
    
    const specialite = specialites.find(s => s.id === medecin.specialite_id);
    if (!specialite) continue;
    
    const demiJournees = splitHoraireToDemiJournees(horaire.heure_debut, horaire.heure_fin);
    
    for (const demiJournee of demiJournees) {
      const hours = calculateDemiJourneeHours(horaire.heure_debut, horaire.heure_fin, demiJournee);
      if (hours === 0) continue;
      
      const key = `${medecin.specialite_id}-${horaire.jour_semaine}-${demiJournee}`;
      
      const existing = besoinsMap.get(key);
      if (existing) {
        existing.nombre_secretaires_requis += medecin.besoin_secretaires * (hours / 4.5);
      } else {
        besoinsMap.set(key, {
          jour_semaine: horaire.jour_semaine,
          demi_journee: demiJournee,
          specialite_id: medecin.specialite_id,
          specialite_nom: specialite.nom,
          nombre_secretaires_requis: medecin.besoin_secretaires * (hours / 4.5),
        });
      }
    }
  }
  
  return Array.from(besoinsMap.values());
}

export function aggregateCapacites(
  horairesSecretaires: HoraireBaseSecretaire[],
  secretaires: Secretaire[],
  backups: Backup[]
): HoraireBaseCapacite[] {
  const capacitesMap = new Map<string, HoraireBaseCapacite>();
  
  // Process secretaires
  for (const horaire of horairesSecretaires) {
    if (!horaire.actif) continue;
    
    const secretaire = secretaires.find(s => s.id === horaire.secretaire_id);
    if (!secretaire || !secretaire.actif) continue;
    
    const demiJournees = splitHoraireToDemiJournees(horaire.heure_debut, horaire.heure_fin);
    
    for (const demiJournee of demiJournees) {
      const hours = calculateDemiJourneeHours(horaire.heure_debut, horaire.heure_fin, demiJournee);
      if (hours === 0) continue;
      
      for (const specialiteId of secretaire.specialites) {
        const key = `${specialiteId}-${horaire.jour_semaine}-${demiJournee}`;
        
        const existing = capacitesMap.get(key);
        if (existing) {
          existing.nombre_secretaires += hours / 4.5;
        } else {
          capacitesMap.set(key, {
            jour_semaine: horaire.jour_semaine,
            demi_journee: demiJournee,
            specialite_id: specialiteId,
            nombre_secretaires: hours / 4.5,
          });
        }
      }
    }
  }
  
  // Add backup capacity (assuming they can work any day/half-day if needed)
  for (const backup of backups) {
    if (!backup.actif) continue;
    
    // Assume backups are available all week, both half-days
    for (let jour = 1; jour <= 5; jour++) {
      for (const demiJournee of ['matin', 'apres_midi'] as DemiJournee[]) {
        for (const specialiteId of backup.specialites) {
          const key = `${specialiteId}-${jour}-${demiJournee}`;
          
          const existing = capacitesMap.get(key);
          if (existing) {
            existing.nombre_secretaires += 0.5; // Half a person equivalent per half-day
          } else {
            capacitesMap.set(key, {
              jour_semaine: jour,
              demi_journee: demiJournee,
              specialite_id: specialiteId,
              nombre_secretaires: 0.5,
            });
          }
        }
      }
    }
  }
  
  return Array.from(capacitesMap.values());
}

function calculateScore(besoins: number, capacites: number): number {
  if (besoins === 0) return 0;
  
  const pourcentage = (capacites / besoins) * 100;
  const ecart = 100 - pourcentage;
  
  // Formula: (100 - pourcentage)² × 100
  return Math.pow(ecart, 2) * 100;
}

export function optimizeBaseSchedule(
  besoins: HoraireBaseBesoin[],
  capacites: HoraireBaseCapacite[]
): BaseScheduleOptimizationResult {
  const specialitesSet = new Set(besoins.map(b => b.specialite_id));
  const scores: OptimizationScoreParSpecialite[] = [];
  
  for (const specialiteId of specialitesSet) {
    const specialiteBesoins = besoins.filter(b => b.specialite_id === specialiteId);
    const specialiteCapacites = capacites.filter(c => c.specialite_id === specialiteId);
    const specialiteNom = specialiteBesoins[0]?.specialite_nom || '';
    
    const detailsJours: OptimizationDetailJour[] = [];
    let totalScore = 0;
    let totalBesoins = 0;
    let totalCapacites = 0;
    
    for (let jour = 1; jour <= 5; jour++) {
      const matinBesoin = specialiteBesoins.find(
        b => b.jour_semaine === jour && b.demi_journee === 'matin'
      )?.nombre_secretaires_requis || 0;
      
      const matinCapacite = specialiteCapacites.find(
        c => c.jour_semaine === jour && c.demi_journee === 'matin'
      )?.nombre_secretaires || 0;
      
      const apremBesoin = specialiteBesoins.find(
        b => b.jour_semaine === jour && b.demi_journee === 'apres_midi'
      )?.nombre_secretaires_requis || 0;
      
      const apremCapacite = specialiteCapacites.find(
        c => c.jour_semaine === jour && c.demi_journee === 'apres_midi'
      )?.nombre_secretaires || 0;
      
      const matinScore = calculateScore(matinBesoin, matinCapacite);
      const apremScore = calculateScore(apremBesoin, apremCapacite);
      
      const matinPourcentage = matinBesoin > 0 ? (matinCapacite / matinBesoin) * 100 : 100;
      const apremPourcentage = apremBesoin > 0 ? (apremCapacite / apremBesoin) * 100 : 100;
      
      detailsJours.push({
        jour_semaine: jour,
        jour_nom: JOURS_SEMAINE[jour - 1],
        matin: {
          besoins: Math.round(matinBesoin * 10) / 10,
          capacites: Math.round(matinCapacite * 10) / 10,
          score: Math.round(matinScore),
          pourcentage: Math.round(matinPourcentage),
        },
        apres_midi: {
          besoins: Math.round(apremBesoin * 10) / 10,
          capacites: Math.round(apremCapacite * 10) / 10,
          score: Math.round(apremScore),
          pourcentage: Math.round(apremPourcentage),
        },
      });
      
      totalScore += matinScore + apremScore;
      totalBesoins += matinBesoin + apremBesoin;
      totalCapacites += matinCapacite + apremCapacite;
    }
    
    const scoreGlobal = totalScore / 10; // Average over 10 half-days
    const pourcentageGlobal = totalBesoins > 0 ? (totalCapacites / totalBesoins) * 100 : 100;
    
    scores.push({
      specialite_id: specialiteId,
      specialite_nom: specialiteNom,
      score_global: Math.round(scoreGlobal),
      pourcentage_global: Math.round(pourcentageGlobal),
      details_jours: detailsJours,
    });
  }
  
  const scoreTotal = scores.reduce((sum, s) => sum + s.score_global, 0) / scores.length;
  
  return {
    scores_par_specialite: scores,
    score_total: Math.round(scoreTotal),
  };
}
