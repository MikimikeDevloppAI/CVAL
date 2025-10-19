import { SecretaireCard } from './SecretaireCard';
import type { Secretaire } from './useSecretaires';

interface SecretairesListProps {
  secretaires: Secretaire[];
  searchTerm: string;
  showInactive: boolean;
  onEdit: (secretaire: Secretaire) => void;
  onToggleStatus: (secretaireId: string, currentStatus: boolean, skipConfirmation?: boolean) => void;
  onOpenCalendar: (secretaire: { id: string; nom: string }) => void;
  onSuccess: () => void;
  canManage: boolean;
}

export function SecretairesList({
  secretaires,
  searchTerm,
  showInactive,
  onEdit,
  onToggleStatus,
  onOpenCalendar,
  onSuccess,
  canManage
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
      <div className="text-center py-12">
        <p className="text-muted-foreground">
          {searchTerm 
            ? "Aucune secrétaire ne correspond à votre recherche"
            : showInactive 
              ? "Aucune secrétaire inactive"
              : "Aucune secrétaire active"
          }
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {filteredSecretaires.map((secretaire, index) => (
        <SecretaireCard
          key={secretaire.id}
          secretaire={secretaire}
          index={index}
          onEdit={onEdit}
          onToggleStatus={onToggleStatus}
          onOpenCalendar={onOpenCalendar}
          onSuccess={onSuccess}
          canManage={canManage}
        />
      ))}
    </div>
  );
}
