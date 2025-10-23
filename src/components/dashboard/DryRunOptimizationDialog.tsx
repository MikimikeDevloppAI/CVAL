import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface DryRunResult {
  success: boolean;
  message: string;
  before: {
    total_unmet: number;
    assignments_count: number;
  };
  after: {
    total_unmet: number;
    assignments_count: number;
    assignments: Array<{
      secretaire_id: string;
      secretaire_nom: string;
      site_id: string;
      site_nom: string;
      demi_journee: string;
      is_new: boolean;
    }>;
  };
  improvement: {
    unmet_diff: number;
    assignment_changes: number;
    score_improvement: number;
  };
}

interface DryRunOptimizationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: string;
  result: DryRunResult | null;
  isLoading: boolean;
  onApply?: () => void;
  isApplying?: boolean;
}

export const DryRunOptimizationDialog = ({
  open,
  onOpenChange,
  date,
  result,
  isLoading,
  onApply,
  isApplying
}: DryRunOptimizationDialogProps) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Optimisation Dry Run - {format(new Date(date), 'EEEE dd MMMM yyyy', { locale: fr })}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="ml-3 text-sm text-muted-foreground">Analyse en cours...</span>
            </div>
          ) : result ? (
            <>
              {/* Status */}
              <div className="flex items-center gap-2 p-4 rounded-lg bg-muted/50">
                {result.success ? (
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                ) : (
                  <XCircle className="h-5 w-5 text-destructive" />
                )}
                <span className="font-medium">{result.message}</span>
              </div>

              {result.success && (
                <>
                  {/* Comparison */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 rounded-lg border">
                      <h3 className="text-sm font-semibold mb-2">Avant optimisation</h3>
                      <div className="space-y-1">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Besoins non satisfaits:</span>
                          <Badge variant="destructive">{result.before.total_unmet}</Badge>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Assignations:</span>
                          <span>{result.before.assignments_count}</span>
                        </div>
                      </div>
                    </div>

                    <div className="p-4 rounded-lg border">
                      <h3 className="text-sm font-semibold mb-2">Après optimisation</h3>
                      <div className="space-y-1">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Besoins non satisfaits:</span>
                          <Badge variant={result.after.total_unmet < result.before.total_unmet ? "default" : "destructive"}>
                            {result.after.total_unmet}
                          </Badge>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Assignations:</span>
                          <span>{result.after.assignments_count}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Improvement */}
                  <div className="p-4 rounded-lg bg-primary/10 border border-primary/20">
                    <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                      <AlertCircle className="h-4 w-4" />
                      Amélioration
                    </h3>
                    <div className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Réduction besoins non satisfaits:</span>
                        <Badge variant={result.improvement.unmet_diff < 0 ? "default" : "secondary"}>
                          {result.improvement.unmet_diff > 0 ? '+' : ''}{result.improvement.unmet_diff}
                        </Badge>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Changements d'assignation:</span>
                        <span>{result.improvement.assignment_changes}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Amélioration du score:</span>
                        <Badge variant={result.improvement.score_improvement > 0 ? "default" : "secondary"}>
                          {result.improvement.score_improvement > 0 ? '+' : ''}{result.improvement.score_improvement}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  {/* Assignments */}
                  {result.after.assignments && result.after.assignments.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold">Nouvelles assignations proposées</h3>
                      <div className="max-h-64 overflow-y-auto space-y-2">
                        {result.after.assignments.map((assignment, idx) => (
                          <div
                            key={idx}
                            className={`p-3 rounded-lg border ${
                              assignment.is_new ? 'bg-primary/5 border-primary/20' : 'bg-muted/50'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-sm">{assignment.secretaire_nom}</span>
                                {assignment.is_new && (
                                  <Badge variant="default" className="text-xs">Nouveau</Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <span>{assignment.site_nom}</span>
                                <Badge variant="outline" className="text-xs">
                                  {assignment.demi_journee === 'matin' ? 'Matin' : 'Après-midi'}
                                </Badge>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Apply button */}
                  {onApply && result.improvement.score_improvement > 0 && (
                    <div className="flex justify-end gap-2 pt-4 border-t">
                      <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={isApplying}
                      >
                        Annuler
                      </Button>
                      <Button
                        onClick={onApply}
                        disabled={isApplying}
                        className="gap-2"
                      >
                        {isApplying ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Application...
                          </>
                        ) : (
                          'Appliquer cette optimisation'
                        )}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
};
