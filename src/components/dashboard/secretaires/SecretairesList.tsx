import { SecretaireCard } from './SecretaireCard';
import type { Secretaire } from './useSecretaires';

interface SecretairesListProps {
  secretaires: Secretaire[];
  searchTerm: string;
  showInactive: boolean;
  onOpenDetail: (secretaire: Secretaire) => void;
  onOpenCalendar: (secretaire: { id: string; nom: string }) => void;
}

export function SecretairesList({
  secretaires,
  searchTerm,
  showInactive,
  onOpenDetail,
  onOpenCalendar
}: SecretairesListProps) {
  const filteredSecretaires = secretaires
    .filter(secretaire => {
      const prenom = secretaire.first_name || '';
      const nom = secretaire.name || '';
      const email = secretaire.email || '';
      const telephone = secretaire.phone_number || '';

      const matchesSearch = prenom.toLowerCase().includes(searchTerm.toLowerCase()) ||
        nom.toLowerCase().includes(searchTerm.toLowerCase()) ||
        email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        telephone.toLowerCase().includes(searchTerm.toLowerCase()) ||
        secretaire.id.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesStatus = showInactive ? secretaire.actif === false : secretaire.actif !== false;

      return matchesSearch && matchesStatus;
    })
    .sort((a, b) => {
      const prenomA = (a.first_name || '').toLowerCase();
      const prenomB = (b.first_name || '').toLowerCase();
      return prenomA.localeCompare(prenomB);
    });

  if (filteredSecretaires.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-teal-500/10 to-emerald-500/10 flex items-center justify-center mb-5">
          <svg className="w-10 h-10 text-teal-600/60 dark:text-teal-400/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-foreground mb-2">Aucun assistant trouvé</h3>
        <p className="text-sm text-muted-foreground max-w-md">
          {searchTerm
            ? 'Essayez de modifier vos critères de recherche'
            : showInactive
              ? 'Aucun assistant médical inactif'
              : 'Commencez par ajouter un assistant'}
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 animate-fade-in">
      {filteredSecretaires.map((secretaire, index) => (
        <SecretaireCard
          key={secretaire.id}
          secretaire={secretaire}
          index={index}
          onOpenDetail={onOpenDetail}
          onOpenCalendar={onOpenCalendar}
        />
      ))}
    </div>
  );
}
