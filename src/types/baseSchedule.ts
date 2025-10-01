export type DemiJournee = 'matin' | 'apres_midi';

export interface HoraireBaseBesoin {
  jour_semaine: number; // 1-7 (Lundi-Dimanche)
  demi_journee: DemiJournee;
  specialite_id: string;
  specialite_nom: string;
}

export interface HoraireBaseCapacite {
  jour_semaine: number; // 1-7 (Lundi-Dimanche)
  demi_journee: DemiJournee;
  specialite_id: string;
  nombre_secretaires: number;
}

export interface OptimizationDetailJour {
  jour_semaine: number;
  jour_nom: string;
  matin: {
    besoins: number;
    capacites: number;
    score: number;
    pourcentage: number;
  };
  apres_midi: {
    besoins: number;
    capacites: number;
    score: number;
    pourcentage: number;
  };
}

export interface OptimizationScoreParSpecialite {
  specialite_id: string;
  specialite_nom: string;
  score_global: number;
  pourcentage_global: number;
  details_jours: OptimizationDetailJour[];
}

export interface BaseScheduleOptimizationResult {
  scores_par_specialite: OptimizationScoreParSpecialite[];
  score_total: number;
}
