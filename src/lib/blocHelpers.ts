/**
 * Vérifie si une secrétaire peut effectuer un rôle spécifique dans le bloc opératoire
 * basé sur ses compétences déclarées dans la table secretaires
 */
export function canPerformBlocRole(
  secretaire: {
    instrumentaliste?: boolean;
    aide_de_salle?: boolean;
    anesthesiste?: boolean;
    bloc_dermato_accueil?: boolean;
    bloc_ophtalmo_accueil?: boolean;
  },
  typeBesoin: string | null
): boolean {
  if (!typeBesoin) return false;

  switch (typeBesoin) {
    case 'instrumentiste':
      return secretaire.instrumentaliste === true;
    case 'aide_salle':
      return secretaire.aide_de_salle === true;
    case 'instrumentiste_aide_salle':
      return secretaire.instrumentaliste === true || secretaire.aide_de_salle === true;
    case 'anesthesiste':
      return secretaire.anesthesiste === true;
    case 'accueil_dermato':
      return secretaire.bloc_dermato_accueil === true;
    case 'accueil_ophtalmo':
      return secretaire.bloc_ophtalmo_accueil === true;
    case 'accueil':
      return secretaire.bloc_dermato_accueil === true || secretaire.bloc_ophtalmo_accueil === true;
    default:
      return false;
  }
}

/**
 * Retourne le label français pour un type de besoin bloc
 */
export function getTypeBesoinLabel(typeBesoin: string | null): string {
  if (!typeBesoin) return 'Non spécifié';
  
  const labels: Record<string, string> = {
    instrumentiste: 'Instrumentiste',
    aide_salle: 'Aide de salle',
    instrumentiste_aide_salle: 'Instrumentiste / Aide de salle',
    anesthesiste: 'Anesthésiste',
    accueil_dermato: 'Accueil Dermatologie',
    accueil_ophtalmo: 'Accueil Ophtalmologie',
    accueil: 'Accueil',
  };
  
  return labels[typeBesoin] || typeBesoin;
}
