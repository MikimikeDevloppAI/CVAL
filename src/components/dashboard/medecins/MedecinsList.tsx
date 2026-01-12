import { MedecinCard } from './MedecinCard';
import { Medecin } from './useMedecins';

interface MedecinsListProps {
  medecins: Medecin[];
  searchTerm: string;
  showInactive: boolean;
  onOpenDetail: (medecin: Medecin) => void;
  onOpenCalendar: (medecin: Medecin) => void;
}

export function MedecinsList({
  medecins,
  searchTerm,
  showInactive,
  onOpenDetail,
  onOpenCalendar
}: MedecinsListProps) {
  const filteredMedecins = medecins
    .filter(medecin => {
      const matchesSearch = medecin.first_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
             medecin.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
             medecin.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
             medecin.specialites?.nom.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesStatus = showInactive ? medecin.actif === false : medecin.actif !== false;

      return matchesSearch && matchesStatus;
    })
    .sort((a, b) => {
      const prenomA = (a.first_name || '').toLowerCase();
      const prenomB = (b.first_name || '').toLowerCase();
      return prenomA.localeCompare(prenomB);
    });

  if (filteredMedecins.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-cyan-500/10 to-teal-500/10 flex items-center justify-center mb-5">
          <svg className="w-10 h-10 text-cyan-600/60 dark:text-cyan-400/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-foreground mb-2">Aucun médecin trouvé</h3>
        <p className="text-sm text-muted-foreground max-w-md">
          {searchTerm ? 'Essayez de modifier vos critères de recherche' : 'Commencez par ajouter un médecin'}
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 animate-fade-in">
      {filteredMedecins.map((medecin, index) => (
        <MedecinCard
          key={medecin.id}
          medecin={medecin}
          index={index}
          onOpenDetail={onOpenDetail}
          onOpenCalendar={onOpenCalendar}
        />
      ))}
    </div>
  );
}
