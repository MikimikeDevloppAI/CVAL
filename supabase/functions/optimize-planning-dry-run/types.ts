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
  site_nom?: string;
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
  BESOIN_OP_PREF_1: 5000,
  BESOIN_OP_PREF_2: 4500,
  BESOIN_OP_PREF_3: 4250,
  MEDECIN_PREF_1: 1400,
  MEDECIN_PREF_2: 1240,
  SITE_PREF_1: 1200,
  SITE_PREF_2: 1190,
  SITE_PREF_3: 1180,
  SITE_PREF_4: 1170,
};

export const PENALTIES = {
  CHANGEMENT_SITE: -40,
  CHANGEMENT_SITE_HIGH_PENALTY: -60,
  ADMIN_FIRST: 10,
  SITE_PREF_234_OVERLOAD: -150,
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

export interface CurrentState {
  secretaire_id: string;
  matin_site_id: string | null;
  matin_besoin_op_id: string | null;
  matin_bloc_op_id: string | null;
  am_site_id: string | null;
  am_besoin_op_id: string | null;
  am_bloc_op_id: string | null;
}
