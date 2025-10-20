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
}

export interface Secretaire {
  id: string;
  name: string;
  first_name: string;
  actif: boolean;
  prefered_admin: boolean;
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
  priorite: '1' | '2' | '3';
}

export interface AssignmentSummary {
  secretaire_id: string;
  site_id: string;
  date: string;
  periode: 'matin' | 'apres_midi';
  is_admin: boolean;
  is_bloc: boolean;
  site_priorite: 1 | 2 | 3 | null;
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
}

export const SCORE_WEIGHTS = {
  BESOIN_OP_PREF_1: 200,
  BESOIN_OP_PREF_2: 180,
  BESOIN_OP_PREF_3: 160,
  MEDECIN_PREF_1: 160,
  MEDECIN_PREF_2: 140,
  SITE_PREF_1: 120,
  SITE_PREF_2: 100,
  SITE_PREF_3: 80,
};

export const PENALTIES = {
  CHANGEMENT_SITE: -40,
  ADMIN_FIRST: 10,
  SITE_PREF_23_OVERLOAD: -10,
  BLOC_EXCLUSION: -1000,
};

export const ADMIN_SITE_ID = '00000000-0000-0000-0000-000000000001';

export const FORBIDDEN_SITES = [
  '7723c334-d06c-413d-96f0-be281d76520d',
  '043899a1-a232-4c4b-9d7d-0eb44dad00ad'
];
