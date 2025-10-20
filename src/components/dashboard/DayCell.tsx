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
}

export const DayCell = ({ date, data, onOpenDetail }: DayCellProps) => {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (data && onOpenDetail) {
      onOpenDetail(date, data);
    }
  };

  if (!data || (data.medecins.length === 0 && data.secretaires.length === 0)) {
    return (
      <div className="min-h-[140px] rounded-lg border border-border/30 bg-muted/20 p-3">
        <p className="text-xs text-muted-foreground text-center">-</p>
      </div>
    );
  }

  const getPersonneBadgeClass = (matin: boolean, apres_midi: boolean) => {
    if (matin && apres_midi) {
      return 'border-2 border-purple-500/60 bg-purple-500/10 text-purple-700';
    } else if (matin) {
      return 'border-2 border-amber-500/60 bg-amber-500/10 text-amber-700';
    } else {
      return 'border-2 border-blue-500/60 bg-blue-500/10 text-blue-700';
    }
  };

  const allValidated = data.secretaires.every(s => s.validated);
  const manquantMatin = Math.max(0, Math.ceil(data.besoin_secretaires_matin) - data.secretaires.filter(s => s.matin).length);
  const manquantAM = Math.max(0, Math.ceil(data.besoin_secretaires_apres_midi) - data.secretaires.filter(s => s.apres_midi).length);
  const totalManquant = manquantMatin + manquantAM;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            onClick={handleClick}
            className={cn(
              "min-h-[140px] rounded-xl border-2 p-3 transition-all duration-300",
              "hover:shadow-lg hover:scale-[1.02] cursor-pointer",
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
                      className={cn(
                        "text-[10px] font-medium px-2 py-1 rounded-md transition-all truncate max-w-full",
                        getPersonneBadgeClass(m.matin, m.apres_midi)
                      )}
                      title={m.nom}
                    >
                      {m.nom}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Secrétaires Section */}
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Users className="h-3.5 w-3.5 text-primary" />
                <span className="text-[10px] font-semibold text-muted-foreground uppercase">
                  Secrétaires
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {data.secretaires.map((s) => (
                  <span
                    key={s.id}
                    className={cn(
                      "text-[10px] font-medium px-2 py-1 rounded-md transition-all inline-flex items-center gap-1 truncate max-w-full",
                      getPersonneBadgeClass(s.matin, s.apres_midi)
                    )}
                    title={s.nom}
                  >
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
                <div className="w-3 h-3 rounded border-2 border-amber-500 bg-amber-500/20" />
                <span>Matin</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded border-2 border-blue-500 bg-blue-500/20" />
                <span>Après-midi</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded border-2 border-purple-500 bg-purple-500/20" />
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
