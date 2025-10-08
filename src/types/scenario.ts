export interface FictionalDoctor {
  id: string; // Generated locally
  name: string;
  specialite_id: string;
  horaires: Array<{
    jour_semaine: number; // 1-7
    demi_journee?: 'matin' | 'apres_midi'; // Optional = both
    heure_debut: string;
    heure_fin: string;
  }>;
  besoin_secretaires: number; // Default 1.2
}

export interface FictionalSecretary {
  id: string; // Generated locally
  name: string;
  specialites: string[]; // Array of specialite_id
  horaires: Array<{
    jour_semaine: number; // 1-7
    heure_debut: string;
    heure_fin: string;
  }>;
}

export interface WhatIfScenario {
  fictionalDoctors: FictionalDoctor[];
  fictionalSecretaries: FictionalSecretary[];
}

export interface WhatIfOptimizationRequest {
  scenario: WhatIfScenario;
}
