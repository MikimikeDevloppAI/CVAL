export interface SiteNeed {
  site_id: string;
  date: string;
  periode: 'matin' | 'apres_midi';
  nombre_suggere: number;
  nombre_max: number; // Hard constraint
  medecins_ids: string[];
  type: 'site' | 'bloc_operatoire';
  bloc_operation_id?: string;
  besoin_operation_id?: string;
  type_intervention_id?: string; // Pour exceptions (Gastro)
  salle_assignee?: string; // 🆕 Salle d'opération assignée
  needs_closing?: boolean; // true si site de fermeture avec médecins matin+AM
  needs_3f?: boolean; // true si Paul Jacquier jeudi+vendredi
}

export interface Secretaire {
  id: string;
  name: string;
  first_name: string;
  actif: boolean;
  prefered_admin: boolean;
  nombre_demi_journees_admin?: number;
  horaire_flexible: boolean;
  pourcentage_temps: number;
}

export interface Medecin {
  id: string;
  name: string;
  first_name: string;
  besoin_secretaires: number;
  specialite_id: string;
  actif: boolean;
}

export interface Site {
  id: string;
  nom: string;
  fermeture: boolean;
  actif: boolean;
}

export interface BesoinEffectif {
  id: string;
  site_id: string;
  date: string;
  demi_journee: 'matin' | 'apres_midi';
  type: 'medecin' | 'operation';
  medecin_id?: string;
  actif: boolean;
}

export interface CapaciteEffective {
  id: string;
  secretaire_id?: string;
  date: string;
  demi_journee: 'matin' | 'apres_midi';
  site_id: string;
  planning_genere_bloc_operatoire_id?: string;
  besoin_operation_id?: string;
  is_1r: boolean;
  is_2f: boolean;
  is_3f: boolean;
  actif: boolean;
}

export interface PlanningBlocOp {
  id: string;
  date: string;
  periode: 'matin' | 'apres_midi';
  type_intervention_id: string;
  medecin_id?: string;
  salle_assignee?: string;
  validated: boolean;
}

export interface TypeInterventionBesoin {
  id: string;
  type_intervention_id: string;
  besoin_operation_id: string;
  nombre_requis: number;
  actif: boolean;
}

export interface SecretaireBesoin {
  secretaire_id: string;
  besoin_operation_id: string;
  preference: 1 | 2 | 3;
}

export interface SecretaireMedecin {
  secretaire_id: string;
  medecin_id: string;
  priorite: '1' | '2';
}

export interface SecretaireSite {
  secretaire_id: string;
  site_id: string;
  priorite: '1' | '2' | '3' | '4';
}

export interface AssignmentSummary {
  secretaire_id: string;
  site_id: string;
  date: string;
  periode: 'matin' | 'apres_midi';
  is_admin: boolean;
  is_bloc: boolean;
  site_priorite: 1 | 2 | 3 | 4 | null;
  is_1r: boolean;
  is_2f: boolean;
  is_3f: boolean;
}

export interface TodayAssignment {
  secretaire_id: string;
  matin?: {
    site_id: string;
    is_bloc: boolean;
  };
  apres_midi?: {
    site_id: string;
    is_bloc: boolean;
  };
}

export interface DynamicContext {
  week_assignments: AssignmentSummary[];
  today_assignments: Map<string, TodayAssignment>;
  admin_counters: Map<string, number>; // secretaire_id -> nombre demi-journées admin
  p2p3_counters: Map<string, Map<string, Set<string>>>; // secretaire_id -> (site_id -> Set<date>)
  closing_1r_counters: Map<string, number>; // secretaire_id -> nombre de fois 1R cette semaine
  closing_2f3f_counters: Map<string, number>; // secretaire_id -> nombre de fois 2F ou 3F cette semaine
  sites_needing_3f: Map<string, Set<string>>; // date -> Set<site_id> nécessitant 3F
  penalty_multipliers_1r2f?: Map<string, number>; // 🆕 Pour 1R/2F
  penalty_multipliers_esplanade?: Map<string, number>; // 🆕 Pour Esplanade P2/P3/P4
}

export interface PreferencesData {
  besoins: SecretaireBesoin[];
  medecins: SecretaireMedecin[];
  sites: SecretaireSite[];
}

export interface WeekData {
  secretaires: Secretaire[];
  medecins: Medecin[];
  medecins_map: Map<string, Medecin>;
  sites: Site[];
  besoins_operations: any[];
  secretaires_besoins: SecretaireBesoin[];
  secretaires_medecins: SecretaireMedecin[];
  secretaires_sites: SecretaireSite[];
  capacites_effective: CapaciteEffective[];
  besoins_effectifs: BesoinEffectif[];
  planning_bloc: PlanningBlocOp[];
  types_intervention_besoins: TypeInterventionBesoin[];
  admin_needs: SiteNeed[];
}

export const SCORE_WEIGHTS = {
  BESOIN_OP_PREF_1: 6000,
  BESOIN_OP_PREF_2: 5500,
  BESOIN_OP_PREF_3: 5250,
  MEDECIN_PREF_1: 3400,
  MEDECIN_PREF_2: 3240,
  SITE_PREF_1: 2200,
  SITE_PREF_2: 2190,
  SITE_PREF_3: 2180,
  SITE_PREF_4: 2170,
};

export const PENALTIES = {
  CHANGEMENT_SITE: -40,
  CHANGEMENT_SITE_HIGH_PENALTY: -60,
  ADMIN_FIRST: 10,
  SITE_PREF_234_OVERLOAD: -300,
  BLOC_EXCLUSION: -10000,
};

export const ADMIN_SITE_ID = '00000000-0000-0000-0000-000000000001';

export const HIGH_PENALTY_SITES = [
  '043899a1-a232-4c4b-9d7d-0eb44dad00ad', // Centre Esplanade
  '7723c334-d06c-413d-96f0-be281d76520d'  // Vieille ville
];

export const FORBIDDEN_SITES = [
  '7723c334-d06c-413d-96f0-be281d76520d',
  '043899a1-a232-4c4b-9d7d-0eb44dad00ad'
];

// Exception pour Gastroentérologie
export const GASTRO_TYPE_INTERVENTION_ID = '32da56a9-d58c-4e3f-94bb-2aa30e7f861c';
export const VIEILLE_VILLE_SITE_ID = '7723c334-d06c-413d-96f0-be281d76520d';

// Site spécifique pour pénalité P2/P3 par jour
export const ESPLANADE_OPHTALMOLOGIE_SITE_ID = '043899a1-a232-4c4b-9d7d-0eb44dad00ad';

// Salles d'opération
export const SALLE_ROUGE_ID = 'ae6dc538-e24c-4f53-b6f5-689a97ac4292';
export const SALLE_VERTE_ID = 'b8279252-aa3a-436d-b184-54da0de62f49';
export const SALLE_JAUNE_ID = '8965e942-0c6b-4261-a976-2bdf6cd13a00';
export const SALLE_GASTRO_ID = 'f3b11ee0-4463-4273-afcd-30148424077c';

export const SALLES_STANDARD = [SALLE_ROUGE_ID, SALLE_VERTE_ID, SALLE_JAUNE_ID];

// Bonus pour même site matin + après-midi
export const SAME_SITE_BONUS = 20;

// Pénalités pour fermetures (calibrées pour favoriser rotation)
export const CLOSING_PENALTIES = {
  TWO_2F3F_TIMES: -250, // Pénalité dès la 2e fois 2F/3F dans la semaine (count2F3F >= 1)
  THREE_CLOSING_ROLES: -250, // Pénalité dès le 3e rôle de fermeture total (totalClosing >= 2)
  FOUR_OR_MORE_CLOSING: -200, // Pénalité supplémentaire cumulée si 4+ et 5+ rôles
  FLORENCE_BRON_TUESDAY_2F: -500, // Très forte pénalité pour Florence Bron 2F le mardi
};

// 🆕 Nouvelles constantes pour pénalités closing V3 (PAR JOUR)
export const CLOSING_PENALTIES_V3 = {
  // Score = 10 × jours_1r + 12 × jours_2f3f
  closing_role_1r_weight: 10,
  closing_role_2f_weight: 12,
  
  // Paliers (seul le plus haut s'applique)
  closing_role_threshold_1: 22,
  closing_role_threshold_2: 29,
  closing_role_threshold_3: 31,
  closing_role_threshold_4: 35,
  
  closing_role_penalty_1: 200,
  closing_role_penalty_2: 500,
  closing_role_penalty_3: 1100,
  closing_role_penalty_4: 10000,
  
  // Pénalités historiques additionnelles
  closing_history_threshold: 44,
  closing_history_penalty: 300,
  porrentruy_history_threshold: 2,
  porrentruy_history_penalty: 300
};

// 🆕 Pénalités progressives Porrentruy/Esplanade (PAR JOUR) - max < 2170 pour laisser place au préférences
export const SITE_OVERLOAD_PENALTIES_V3 = {
  site_p234_day_2: 150,   // 2ème jour aux sites éloignés
  site_p234_day_3: 1000,  // 3ème jour aux sites éloignés
  site_p234_day_4: 1500,  // 4ème jour aux sites éloignés
  site_p234_day_5: 2000   // 5ème jour aux sites éloignés (max théorique)
};

// ID Florence Bron (à charger depuis la DB)
export const FLORENCE_BRON_ID = '1e5339aa-5e82-4295-b918-e15a580b3396';

// ID Paul Jacquier (pour détection 3F)
export const PAUL_JACQUIER_ID = '121dc7d9-99dc-46bd-9b6c-d240ac6dc6c8';

// Sites Porrentruy pour comptage des jours
export const PORRENTRUY_SITES = [
  '4a06ca9e-43ed-43f6-a42f-e9b0f95df4d0', // À vérifier avec IDs réels
  // Ajouter d'autres sites Porrentruy si nécessaire
];

// 🆕 Pénalité combinée closing + Porrentruy
export const CLOSING_PORRENTRUY_COMBO_PENALTY = -500;
export const CLOSING_PORRENTRUY_THRESHOLD = {
  closing_score_min: 22,  // Score closing doit être > 22
  porrentruy_days_min: 1   // Jours Porrentruy doit être > 1
};

// 🆕 IDs spéciaux pour bonus médecin
export const DR_FDA323F4_ID = "fda323f4-3efd-4c78-8b63-7d660fcd7eea";
export const SARA_BORTOLON_ID = "68e74e31-12a7-4fd3-836d-41e8abf57792";
export const MIRLINDA_HASANI_ID = "324639fa-2e3d-4903-a143-323a17b0d988";
export const SPECIAL_DOCTOR_SECRETARY_BONUS = 3000;

// 🆕 Nouveau type pour contexte global semaine
export interface WeekContext {
  dates: string[];
  needs_by_date: Map<string, SiteNeed[]>;
  capacities_by_date: Map<string, CapaciteEffective[]>;
  closing_sites_by_date: Map<string, Set<string>>;
  sites_needing_3f: Map<string, Set<string>>;
}
