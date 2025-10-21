import { Stethoscope, Users, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PersonnePresence {
  id: string;
  nom: string;
  prenom?: string;
  matin: boolean;
  apres_midi: boolean;
  validated?: boolean;
  is_1r?: boolean;
  is_2f?: boolean;
  is_3f?: boolean;
}

interface DayData {
  date: string;
  medecins: PersonnePresence[];
  secretaires: PersonnePresence[];
  besoin_secretaires_matin: number;
  besoin_secretaires_apres_midi: number;
  status_matin: 'satisfait' | 'partiel' | 'non_satisfait';
  status_apres_midi: 'satisfait' | 'partiel' | 'non_satisfait';
}

interface DayCellProps {
  date: Date;
  data: DayData | null;
  onOpenDetail?: (date: Date, data: DayData) => void;
  onSecretaireClick?: (secretaireId: string, secretaireNom: string, secretairePrenom: string) => void;
  onMedecinClick?: (medecinId: string, medecinNom: string, medecinPrenom: string) => void;
}

export const DayCell = ({ date, data, onOpenDetail, onSecretaireClick, onMedecinClick }: DayCellProps) => {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (data && onOpenDetail) {
      onOpenDetail(date, data);
    }
  };

  const handleSecretaireClick = (e: React.MouseEvent, secretaire: PersonnePresence) => {
    e.stopPropagation();
    if (onSecretaireClick) {
      onSecretaireClick(secretaire.id, secretaire.nom, secretaire.prenom || '');
    }
  };

  const handleMedecinClick = (e: React.MouseEvent, medecin: PersonnePresence) => {
    e.stopPropagation();
    if (onMedecinClick) {
      onMedecinClick(medecin.id, medecin.nom, medecin.prenom || '');
    }
  };

  // Sort secretaires: journee > matin > apres_midi, then alphabetically
  const sortSecretaires = (secretaires: PersonnePresence[]) => {
    return [...secretaires].sort((a, b) => {
      // Priority: journee (3) > matin (2) > apres_midi (1)
      const getPriority = (s: PersonnePresence) => {
        if (s.matin && s.apres_midi) return 3; // vert
        if (s.matin) return 2; // bleu
        return 1; // jaune
      };
      const priorityDiff = getPriority(b) - getPriority(a);
      if (priorityDiff !== 0) return priorityDiff;
      // Same priority, sort alphabetically
      return a.nom.localeCompare(b.nom);
    });
  };

  if (!data || (data.medecins.length === 0 && data.secretaires.length === 0)) {
    return (
      <div className="min-h-[140px] rounded-lg border border-border/30 bg-muted/20 p-3">
        <p className="text-xs text-muted-foreground text-center">-</p>
      </div>
    );
  }

  const getDotColor = (matin: boolean, apres_midi: boolean) => {
    if (matin && apres_midi) {
      return 'bg-green-500';
    } else if (matin) {
      return 'bg-blue-500';
    } else {
      return 'bg-yellow-500';
    }
  };

  const allValidated = data.secretaires.every(s => s.validated);
  const manquantMatin = Math.max(0, Math.ceil(data.besoin_secretaires_matin) - data.secretaires.filter(s => s.matin).length);
  const manquantAM = Math.max(0, Math.ceil(data.besoin_secretaires_apres_midi) - data.secretaires.filter(s => s.apres_midi).length);
  const totalManquant = manquantMatin + manquantAM;

  const sortedSecretaires = sortSecretaires(data.secretaires);

  return (
    <div
      className={cn(
        "min-h-[140px] rounded-xl border-2 p-3 transition-all duration-300",
        "hover:shadow-lg hover:scale-[1.02]",
        "bg-card/50 backdrop-blur-sm border-border/40"
      )}
    >
      {/* Header with validation */}
      <div className="flex items-center justify-end mb-2">
        {allValidated && data.secretaires.length > 0 && (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
        )}
      </div>

      {/* Médecins Section */}
      {data.medecins.length > 0 && (
        <div className="mb-3 pb-3 border-b border-border/30">
          <div className="flex items-center gap-1.5 mb-2">
            <Stethoscope className="h-3.5 w-3.5 text-primary" />
            <span className="text-[10px] font-semibold text-muted-foreground uppercase">
              Médecins
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {data.medecins.map((m) => {
              const nomComplet = m.prenom ? `${m.prenom} ${m.nom}` : m.nom;
              return (
                <span
                  key={m.id}
                  onClick={(e) => handleMedecinClick(e, m)}
                  className="text-[10px] font-medium px-2 py-1 rounded-md transition-all truncate max-w-full bg-muted/50 border border-border/30 flex items-center gap-1.5 hover:bg-primary/10 cursor-pointer"
                  title={nomComplet}
                >
                  <span className={cn("w-2 h-2 rounded-full flex-shrink-0", getDotColor(m.matin, m.apres_midi))} />
                  <span className="truncate">{m.nom}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Secrétaires Section */}
      <div onClick={handleClick} className="cursor-pointer">
        <div className="flex items-center gap-1.5 mb-2">
          <Users className="h-3.5 w-3.5 text-primary" />
          <span className="text-[10px] font-semibold text-muted-foreground uppercase">
            Secrétaires
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {sortedSecretaires.map((s) => {
            const nomComplet = s.prenom ? `${s.prenom} ${s.nom}` : s.nom;
            return (
              <span
                key={s.id}
                onClick={(e) => handleSecretaireClick(e, s)}
                className="text-[10px] font-medium px-2 py-1 rounded-md transition-all inline-flex items-center gap-1.5 truncate max-w-full bg-muted/50 border border-border/30 hover:bg-primary/10 cursor-pointer"
                title={nomComplet}
              >
                <span className={cn("w-2 h-2 rounded-full flex-shrink-0", getDotColor(s.matin, s.apres_midi))} />
                <span className="truncate">{s.nom}</span>
                {s.is_1r && <span className="text-[8px] font-bold flex-shrink-0">(1R)</span>}
                {s.is_2f && <span className="text-[8px] font-bold flex-shrink-0">(2F)</span>}
                {s.is_3f && <span className="text-[8px] font-bold flex-shrink-0">(3F)</span>}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
};
