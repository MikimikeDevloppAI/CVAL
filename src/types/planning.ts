export type Periode = 'matin' | 'apres_midi';

export interface CreneauBesoin {
  id: string;
  date: string;
  periode: Periode;
  site_id: string;
  site_nom: string;
  specialite_id: string;
  nombre_secretaires_requis: number;
  type: 'medecin' | 'bloc_operatoire';
  medecin_id?: string;
  medecin_nom?: string;
  bloc_operatoire_besoin_id?: string;
  site_fermeture: boolean;
}

export interface CreneauCapacite {
  id: string;
  date: string;
  periode: Periode;
  secretaire_id?: string;
  backup_id?: string;
  nom_complet: string;
  specialites: string[];
  prefere_port_en_truie: boolean;
}

export interface AssignmentResult {
  creneau_besoin_id: string;
  date: string;
  periode: Periode;
  site_id: string;
  site_nom: string;
  site_fermeture: boolean;
  medecins: string[];
  secretaires: {
    id: string;
    nom: string;
    is_backup: boolean;
    is_1r?: boolean;
    is_2f?: boolean;
  }[];
  nombre_requis: number;
  nombre_assigne: number;
  status: 'satisfait' | 'arrondi_inferieur' | 'non_satisfait';
}

export interface OptimizationResult {
  assignments: AssignmentResult[];
  score_base: number;
  penalites: {
    changement_site: number;
    multiple_fermetures: number;
    centre_esplanade_depassement: number;
  };
  score_total: number;
}
