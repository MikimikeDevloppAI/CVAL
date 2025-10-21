import { Stethoscope, Users, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface PersonnePresence {
  id: string;
  nom: string;
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
  onSecretaireClick?: (secretaireId: string, secretaireNom: string) => void;
}

export const DayCell = ({ date, data, onOpenDetail, onSecretaireClick }: DayCellProps) => {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (data && onOpenDetail) {
      onOpenDetail(date, data);
    }
  };

  const handleSecretaireClick = (e: React.MouseEvent, secretaire: PersonnePresence) => {
    e.stopPropagation();
    if (onSecretaireClick) {
      onSecretaireClick(secretaire.id, secretaire.nom);
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
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
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
                  {data.medecins.map((m) => (
                    <span
                      key={m.id}
                      className="text-[10px] font-medium px-2 py-1 rounded-md transition-all truncate max-w-full bg-muted/50 border border-border/30 flex items-center gap-1.5"
                      title={m.nom}
                    >
                      <span className={cn("w-2 h-2 rounded-full flex-shrink-0", getDotColor(m.matin, m.apres_midi))} />
                      <span className="truncate">{m.nom}</span>
                    </span>
                  ))}
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
                {sortedSecretaires.map((s) => (
                  <span
                    key={s.id}
                    onClick={(e) => handleSecretaireClick(e, s)}
                    className="text-[10px] font-medium px-2 py-1 rounded-md transition-all inline-flex items-center gap-1.5 truncate max-w-full bg-muted/50 border border-border/30 hover:bg-primary/10 cursor-pointer"
                    title={s.nom}
                  >
                    <span className={cn("w-2 h-2 rounded-full flex-shrink-0", getDotColor(s.matin, s.apres_midi))} />
                    <span className="truncate">{s.nom}</span>
                    {s.is_1r && <span className="text-[8px] font-bold flex-shrink-0">(1R)</span>}
                    {s.is_2f && <span className="text-[8px] font-bold flex-shrink-0">(2F)</span>}
                    {s.is_3f && <span className="text-[8px] font-bold flex-shrink-0">(3F)</span>}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-sm">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-blue-500" />
                <span>Matin</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-yellow-500" />
                <span>Après-midi</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span>Journée</span>
              </div>
            </div>
            
            {data.medecins.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  Médecins ({data.medecins.length})
                </p>
                <ul className="text-xs space-y-0.5">
                  {data.medecins.map(m => (
                    <li key={m.id}>
                      • {m.nom} - {m.matin && m.apres_midi ? 'Journée' : m.matin ? 'Matin' : 'Après-midi'}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {data.secretaires.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  Secrétaires
                </p>
                <ul className="text-xs space-y-0.5">
                  {data.secretaires.map(s => (
                    <li key={s.id} className="flex items-center gap-1">
                      • {s.nom} - {s.matin && s.apres_midi ? 'Journée' : s.matin ? 'Matin' : 'Après-midi'}
                      {s.is_1r && <span className="text-[10px]">(1R)</span>}
                      {s.is_2f && <span className="text-[10px]">(2F)</span>}
                      {s.is_3f && <span className="text-[10px]">(3F)</span>}
                      {s.validated && <CheckCircle2 className="h-3 w-3 text-emerald-600 ml-1" />}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {totalManquant > 0 && (
              <div className="pt-2 border-t border-border/50">
                <p className="text-xs font-medium text-red-600">
                  ⚠ {totalManquant} secrétaire{totalManquant > 1 ? 's' : ''} manquant{totalManquant > 1 ? 's' : ''}
                  {manquantMatin > 0 && ` (Matin: ${manquantMatin})`}
                  {manquantAM > 0 && ` (AM: ${manquantAM})`}
                </p>
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
