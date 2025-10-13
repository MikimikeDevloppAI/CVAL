import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface OptimizationProgressDialogProps {
  open: boolean;
  currentDay: number;
  totalDays: number;
  currentPhase: 'bloc' | 'sites' | 'complete';
  currentDate: string;
  completedDays: Array<{
    date: string;
    blocAssignments: number;
    sitesAssignments: number;
  }>;
  optimizeBloc: boolean;
  optimizeSites: boolean;
}

export function OptimizationProgressDialog({
  open,
  currentDay,
  totalDays,
  currentPhase,
  currentDate,
  completedDays,
  optimizeBloc,
  optimizeSites,
}: OptimizationProgressDialogProps) {
  const progress = totalDays > 0 ? (currentDay / totalDays) * 100 : 0;
  
  const getPhaseLabel = () => {
    if (currentPhase === 'complete') return '✅ Optimisation terminée';
    if (currentPhase === 'bloc' && optimizeBloc) return '🏥 Optimisation du bloc opératoire (salles, personnel médical)';
    if (currentPhase === 'sites' && optimizeSites) return '🏢 Optimisation des sites (secrétaires, tâches administratives)';
    return 'Optimisation en cours...';
  };

  const getCurrentPhaseNumber = () => {
    if (!optimizeBloc || !optimizeSites) return '1/1';
    if (currentPhase === 'bloc') return '1/2';
    if (currentPhase === 'sites') return '2/2';
    return '';
  };

  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return format(date, 'EEEE d MMMM', { locale: fr });
    } catch {
      return dateStr;
    }
  };

  return (
    <Dialog open={open}>
      <DialogContent className="sm:max-w-[600px]" onPointerDownOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="text-xl">Optimisation MILP en cours</DialogTitle>
          <DialogDescription>
            Veuillez patienter pendant que le système optimise le planning...
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Current progress */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-base">
                Jour {currentDay} / {totalDays}
              </span>
              <span className="text-muted-foreground font-semibold">{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>

          {/* Current day being processed */}
          {currentDate && currentPhase !== 'complete' && (
            <div className="rounded-lg border bg-accent/50 p-4">
              <div className="flex items-center gap-3 mb-2">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <span className="font-semibold capitalize">{formatDate(currentDate)}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="font-medium">{getCurrentPhaseNumber()}</span>
                <span>·</span>
                <span>{getPhaseLabel()}</span>
              </div>
            </div>
          )}

          {/* Completed days */}
          {completedDays.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">Jours complétés</h4>
              <div className="space-y-2 max-h-[200px] overflow-y-auto">
                {completedDays.map((day) => (
                  <div
                    key={day.date}
                    className="flex items-center justify-between rounded-lg border bg-background p-3"
                  >
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                      <span className="text-sm font-medium capitalize">
                        {formatDate(day.date)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      {optimizeBloc && (
                        <span>
                          🏥 Bloc: {day.blocAssignments > 0 ? `${day.blocAssignments} assignations` : 'Aucune opération'}
                        </span>
                      )}
                      {optimizeSites && (
                        <span>
                          🏢 Sites: {day.sitesAssignments > 0 ? `${day.sitesAssignments} assignations` : 'Aucune assignation'}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Phase description */}
          <div className="text-xs text-muted-foreground text-center">
            {currentPhase === 'bloc' && optimizeBloc && (
              <p>Assignation des salles et du personnel du bloc opératoire...</p>
            )}
            {currentPhase === 'sites' && optimizeSites && (
              <p>Assignation des secrétaires sur les sites et tâches administratives...</p>
            )}
            {currentPhase === 'complete' && (
              <p className="font-medium text-primary">✅ Optimisation terminée ! Chargement du planning...</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
