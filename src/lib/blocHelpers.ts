/**
 * Vérifie si une secrétaire peut effectuer un rôle spécifique dans le bloc opératoire
 * basé sur ses compétences via la table secretaires_besoins_operations
 */
export function canPerformBlocRole(
  secretaire: {
    id: string;
    besoins_operations?: Array<{
      besoins_operations: { code: string };
    }>;
  },
  typeBesoin: string | null
): boolean {
  if (!typeBesoin || !secretaire.besoins_operations) return false;

  const besoinsCodes = secretaire.besoins_operations.map(b => b.besoins_operations.code);

  switch (typeBesoin) {
    case 'instrumentiste':
      return besoinsCodes.includes('instrumentiste');
    case 'aide_salle':
      return besoinsCodes.includes('aide_salle');
    case 'instrumentiste_aide_salle':
      return besoinsCodes.includes('instrumentiste') || besoinsCodes.includes('aide_salle') || besoinsCodes.includes('instrumentiste_aide_salle');
    case 'anesthesiste':
      return besoinsCodes.includes('anesthesiste');
    case 'accueil_dermato':
      return besoinsCodes.includes('accueil_dermato');
    case 'accueil_ophtalmo':
      return besoinsCodes.includes('accueil_ophtalmo');
    case 'accueil':
      return besoinsCodes.includes('accueil') || besoinsCodes.includes('accueil_dermato') || besoinsCodes.includes('accueil_ophtalmo');
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
