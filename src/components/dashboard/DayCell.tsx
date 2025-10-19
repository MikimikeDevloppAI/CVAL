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
      <div className="min-h-[100px] rounded-lg border border-border/30 bg-muted/20 p-2">
        <p className="text-xs text-muted-foreground text-center">-</p>
      </div>
    );
  }

  const statusColors = {
    satisfait: 'border-green-500/50 bg-green-500/5',
    partiel: 'border-orange-500/50 bg-orange-500/5',
    non_satisfait: 'border-red-500/50 bg-red-500/5'
  };

  const statusDotColors = {
    satisfait: 'bg-green-500',
    partiel: 'bg-orange-500',
    non_satisfait: 'bg-red-500'
  };

  const allValidated = data.secretaires.every(s => s.validated);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              "min-h-[100px] rounded-lg border p-2 transition-all duration-200",
              "hover:shadow-md hover:scale-105 cursor-pointer",
              statusColors[data.status]
            )}
          >
            {/* Period Badge */}
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-medium text-muted-foreground uppercase">
                {periode === 'matin' ? 'M' : 'AM'}
              </span>
              <div className="flex items-center gap-1">
                {/* Status Dot */}
                <div
                  className={cn(
                    "w-2 h-2 rounded-full",
                    statusDotColors[data.status]
                  )}
                />
                {/* Validation Check */}
                {allValidated && data.secretaires.length > 0 && (
                  <CheckCircle2 className="h-3 w-3 text-green-600" />
                )}
              </div>
            </div>

            {/* Medecins */}
            {data.medecins.length > 0 && (
              <div className="mb-2">
                <div className="flex items-center gap-1 mb-1">
                  <Stethoscope className="h-3 w-3 text-blue-600" />
                  <span className="text-[10px] font-medium text-muted-foreground">
                    {data.medecins.length}
                  </span>
                </div>
              </div>
            )}

            {/* Secretaires */}
            {data.secretaires.length > 0 && (
              <div>
                <div className="flex items-center gap-1 mb-1">
                  <Users className="h-3 w-3 text-green-600" />
                  <span className="text-[10px] font-medium text-muted-foreground">
                    {data.secretaires.length}/{Math.ceil(data.besoin_secretaires)}
                  </span>
                </div>
                {/* Responsibilities Badges */}
                <div className="flex flex-wrap gap-1">
                  {data.secretaires.some(s => s.is_1r) && (
                    <span className="text-[8px] px-1 py-0.5 rounded bg-blue-500/20 text-blue-700 font-medium">
                      1R
                    </span>
                  )}
                  {data.secretaires.some(s => s.is_2f) && (
                    <span className="text-[8px] px-1 py-0.5 rounded bg-purple-500/20 text-purple-700 font-medium">
                      2F
                    </span>
                  )}
                </div>
              </div>
            )}
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
                      {s.is_1r && <span className="text-[10px] text-blue-600">(1R)</span>}
                      {s.is_2f && <span className="text-[10px] text-purple-600">(2F)</span>}
                      {s.validated && <CheckCircle2 className="h-3 w-3 text-green-600 ml-1" />}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="pt-2 border-t border-border/50">
              <p className={cn(
                "text-xs font-medium",
                data.status === 'satisfait' && "text-green-600",
                data.status === 'partiel' && "text-orange-600",
                data.status === 'non_satisfait' && "text-red-600"
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
