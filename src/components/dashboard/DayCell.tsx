import { Stethoscope, Users, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface DayData {
  date: string;
  periode: 'matin' | 'apres_midi';
  medecins: { id: string; nom: string }[];
  secretaires: { 
    id: string; 
    nom: string; 
    validated: boolean;
    is_1r?: boolean;
    is_2f?: boolean;
  }[];
  besoin_secretaires: number;
  status: 'satisfait' | 'partiel' | 'non_satisfait';
}

interface DayCellProps {
  date: Date;
  periode: 'matin' | 'apres_midi';
  data: DayData | null;
}

export const DayCell = ({ date, periode, data }: DayCellProps) => {
  if (!data || (data.medecins.length === 0 && data.secretaires.length === 0)) {
    return (
      <div className="min-h-[120px] rounded-lg border border-border/30 bg-muted/20 p-2">
        <p className="text-xs text-muted-foreground text-center">-</p>
      </div>
    );
  }

  const periodeColors = {
    matin: 'from-amber-500/10 to-yellow-500/10 border-amber-500/30',
    apres_midi: 'from-blue-500/10 to-indigo-500/10 border-blue-500/30'
  };

  const periodeAccents = {
    matin: 'bg-amber-500/20 text-amber-700',
    apres_midi: 'bg-blue-500/20 text-blue-700'
  };

  const statusColors = {
    satisfait: 'border-emerald-500/40',
    partiel: 'border-orange-500/40',
    non_satisfait: 'border-red-500/40'
  };

  const allValidated = data.secretaires.every(s => s.validated);
  const manquant = Math.ceil(data.besoin_secretaires) - data.secretaires.length;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              "min-h-[120px] rounded-xl border-2 p-3 transition-all duration-300",
              "hover:shadow-lg hover:scale-[1.02] cursor-pointer",
              "bg-gradient-to-br backdrop-blur-sm",
              periodeColors[periode],
              statusColors[data.status]
            )}
          >
            {/* Header with Period Badge */}
            <div className="flex items-center justify-between mb-3">
              <span className={cn(
                "text-[10px] font-bold px-2 py-0.5 rounded-full",
                periodeAccents[periode]
              )}>
                {periode === 'matin' ? 'Matin' : 'Après-midi'}
              </span>
              <div className="flex items-center gap-1">
                {allValidated && data.secretaires.length > 0 && (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                )}
              </div>
            </div>

            {/* Médecins Section */}
            {data.medecins.length > 0 && (
              <div className="mb-2 pb-2 border-b border-border/30">
                <div className="flex items-center gap-1.5 mb-1">
                  <Stethoscope className="h-3.5 w-3.5 text-primary" />
                  <span className="text-[11px] font-semibold text-foreground">
                    {data.medecins.length} Médecin{data.medecins.length > 1 ? 's' : ''}
                  </span>
                </div>
                <div className="space-y-0.5">
                  {data.medecins.slice(0, 2).map((m) => (
                    <p key={m.id} className="text-[10px] text-muted-foreground truncate pl-5">
                      {m.nom}
                    </p>
                  ))}
                  {data.medecins.length > 2 && (
                    <p className="text-[10px] text-muted-foreground pl-5">
                      +{data.medecins.length - 2} autre{data.medecins.length - 2 > 1 ? 's' : ''}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Secrétaires Section */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5 text-primary" />
                  <span className="text-[11px] font-semibold text-foreground">
                    {data.secretaires.length}/{Math.ceil(data.besoin_secretaires)}
                  </span>
                </div>
                {/* Responsibilities Badges */}
                <div className="flex gap-1">
                  {data.secretaires.some(s => s.is_1r) && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/20 text-primary font-bold">
                      1R
                    </span>
                  )}
                  {data.secretaires.some(s => s.is_2f) && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-secondary/20 text-secondary-foreground font-bold">
                      2F
                    </span>
                  )}
                </div>
              </div>
              <div className="space-y-0.5">
                {data.secretaires.slice(0, 2).map((s) => (
                  <p key={s.id} className="text-[10px] text-muted-foreground truncate pl-5">
                    {s.nom}
                  </p>
                ))}
                {data.secretaires.length > 2 && (
                  <p className="text-[10px] text-muted-foreground pl-5">
                    +{data.secretaires.length - 2} autre{data.secretaires.length - 2 > 1 ? 's' : ''}
                  </p>
                )}
              </div>
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <div className="space-y-2">
            <p className="font-semibold text-sm">
              {periode === 'matin' ? 'Matin' : 'Après-midi'}
            </p>
            
            {data.medecins.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  Médecins ({data.medecins.length})
                </p>
                <ul className="text-xs space-y-0.5">
                  {data.medecins.map(m => (
                    <li key={m.id}>• {m.nom}</li>
                  ))}
                </ul>
              </div>
            )}

            {data.secretaires.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  Secrétaires ({data.secretaires.length}/{Math.ceil(data.besoin_secretaires)})
                </p>
                <ul className="text-xs space-y-0.5">
                  {data.secretaires.map(s => (
                    <li key={s.id} className="flex items-center gap-1">
                      • {s.nom}
                      {s.is_1r && <span className="text-[10px] text-cyan-600">(1R)</span>}
                      {s.is_2f && <span className="text-[10px] text-teal-600">(2F)</span>}
                      {s.validated && <CheckCircle2 className="h-3 w-3 text-emerald-600 ml-1" />}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="pt-2 border-t border-border/50">
              <p className={cn(
                "text-xs font-medium",
                data.status === 'satisfait' && "text-emerald-600",
                data.status === 'partiel' && "text-cyan-600",
                data.status === 'non_satisfait' && "text-teal-600"
              )}>
                {data.status === 'satisfait' && '✓ Besoin satisfait'}
                {data.status === 'partiel' && '⚠ Partiellement satisfait'}
                {data.status === 'non_satisfait' && '✗ Besoin non satisfait'}
              </p>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
