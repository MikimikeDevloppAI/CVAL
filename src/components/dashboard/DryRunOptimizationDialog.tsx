import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, XCircle, ArrowRight, Building2, Scissors } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface Assignment {
  date: string;
  site_id: string;
  site_nom: string;
  periode: string;
  type: string;
  bloc_operation_id?: string;
  besoin_operation_id?: string;
  secretaires: Array<{
    id: string;
    nom: string;
    is_backup: boolean;
  }>;
  nombre_requis: number;
  nombre_assigne: number;
  status: string;
}

interface DryRunResult {
  success: boolean;
  message: string;
  before: {
    total_unmet: number;
    assignments_count: number;
    assignments: Assignment[];
  };
  after: {
    total_unmet: number;
    assignments_count: number;
    assignments: Assignment[];
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
  const formattedDate = date ? format(new Date(date), 'EEEE dd MMMM yyyy', { locale: fr }) : 'Date non spécifiée';
  
  // Group assignments by site and period for comparison
  const getGroupedAssignments = (assignments: Assignment[]) => {
    const grouped: Record<string, { matin?: Assignment; apres_midi?: Assignment }> = {};
    
    for (const assignment of assignments) {
      const key = `${assignment.site_id}_${assignment.type}_${assignment.bloc_operation_id || ''}_${assignment.besoin_operation_id || ''}`;
      if (!grouped[key]) {
        grouped[key] = {};
      }
      grouped[key][assignment.periode as 'matin' | 'apres_midi'] = assignment;
    }
    
    return grouped;
  };

  const hasChanges = (before: Assignment | undefined, after: Assignment | undefined) => {
    if (!before || !after) return true;
    const beforeIds = new Set(before.secretaires.map(s => s.id));
    const afterIds = new Set(after.secretaires.map(s => s.id));
    
    if (beforeIds.size !== afterIds.size) return true;
    for (const id of beforeIds) {
      if (!afterIds.has(id)) return true;
    }
    return false;
  };

  const getStatusBadge = (assignment: Assignment | undefined) => {
    if (!assignment) return null;
    
    if (assignment.status === 'satisfait') {
      return <Badge variant="default" className="text-xs">Satisfait</Badge>;
    } else if (assignment.status === 'partiel') {
      return <Badge variant="secondary" className="text-xs">Partiel</Badge>;
    } else {
      return <Badge variant="destructive" className="text-xs">Non satisfait</Badge>;
    }
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>Simulation d'optimisation</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-base font-normal">{formattedDate}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {isLoading ? (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="ml-3 text-sm text-muted-foreground">Analyse en cours...</span>
            </div>
          ) : result ? (
            <>
              {/* Summary Stats */}
              <div className="grid grid-cols-3 gap-4">
                <div className="p-4 rounded-lg border bg-card">
                  <div className="text-sm text-muted-foreground mb-1">Besoins non satisfaits</div>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-bold">{result.before.total_unmet}</span>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    <span className={`text-2xl font-bold ${
                      result.after.total_unmet < result.before.total_unmet ? 'text-green-500' :
                      result.after.total_unmet > result.before.total_unmet ? 'text-destructive' :
                      'text-muted-foreground'
                    }`}>
                      {result.after.total_unmet}
                    </span>
                  </div>
                </div>

                <div className="p-4 rounded-lg border bg-card">
                  <div className="text-sm text-muted-foreground mb-1">Total assignations</div>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-bold">{result.before.assignments_count}</span>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    <span className="text-2xl font-bold">{result.after.assignments_count}</span>
                  </div>
                </div>

                <div className="p-4 rounded-lg border bg-card">
                  <div className="text-sm text-muted-foreground mb-1">Score d'optimisation</div>
                  <div className="text-2xl font-bold">{Math.round(result.improvement.score_improvement)}</div>
                </div>
              </div>

              {/* Status Message */}
              <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
                {result.improvement.unmet_diff < 0 ? (
                  <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
                ) : result.improvement.unmet_diff === 0 ? (
                  <CheckCircle2 className="h-5 w-5 text-blue-500 shrink-0" />
                ) : (
                  <XCircle className="h-5 w-5 text-destructive shrink-0" />
                )}
                <span className="font-medium">{result.message}</span>
              </div>

              {/* Detailed Comparison by Site/Bloc */}
              {result.before.assignments && result.after.assignments && (
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold">Comparaison détaillée par site et bloc</h3>
                  
                  {(() => {
                    const beforeGrouped = getGroupedAssignments(result.before.assignments);
                    const afterGrouped = getGroupedAssignments(result.after.assignments);
                    const allKeys = new Set([...Object.keys(beforeGrouped), ...Object.keys(afterGrouped)]);
                    
                    return Array.from(allKeys).map(key => {
                      const before = beforeGrouped[key];
                      const after = afterGrouped[key];
                      const assignment = before?.matin || before?.apres_midi || after?.matin || after?.apres_midi;
                      
                      if (!assignment) return null;

                      const hasMatinChanges = hasChanges(before?.matin, after?.matin);
                      const hasAmChanges = hasChanges(before?.apres_midi, after?.apres_midi);
                      const hasAnyChanges = hasMatinChanges || hasAmChanges;

                      return (
                        <div 
                          key={key}
                          className={`p-4 rounded-lg border transition-colors ${
                            hasAnyChanges ? 'bg-primary/5 border-primary/30' : 'bg-card'
                          }`}
                        >
                          {/* Site/Bloc Header */}
                          <div className="flex items-center gap-2 mb-3">
                            {assignment.type === 'bloc_operatoire' ? (
                              <Scissors className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <Building2 className="h-4 w-4 text-muted-foreground" />
                            )}
                            <span className="font-semibold">{assignment.site_nom}</span>
                            {assignment.type === 'bloc_operatoire' && (
                              <Badge variant="outline" className="text-xs">Bloc</Badge>
                            )}
                          </div>

                          {/* Matin Comparison */}
                          <div className={`grid grid-cols-2 gap-4 mb-2 pb-2 ${hasAmChanges ? 'border-b' : ''}`}>
                            <div>
                              <div className="text-xs text-muted-foreground mb-1 flex items-center justify-between">
                                <span>Matin - Avant</span>
                                {getStatusBadge(before?.matin)}
                              </div>
                              <div className="space-y-1">
                                {before?.matin?.secretaires.length ? (
                                  before.matin.secretaires.map((s, idx) => (
                                    <div key={idx} className={`text-sm px-2 py-1 rounded ${
                                      hasMatinChanges && !after?.matin?.secretaires.find(a => a.id === s.id)
                                        ? 'bg-destructive/10 text-destructive line-through'
                                        : 'bg-muted/50'
                                    }`}>
                                      {s.nom}
                                    </div>
                                  ))
                                ) : (
                                  <div className="text-sm text-muted-foreground italic">Aucune assignation</div>
                                )}
                              </div>
                            </div>

                            <div>
                              <div className="text-xs text-muted-foreground mb-1 flex items-center justify-between">
                                <span>Matin - Après</span>
                                {getStatusBadge(after?.matin)}
                              </div>
                              <div className="space-y-1">
                                {after?.matin?.secretaires.length ? (
                                  after.matin.secretaires.map((s, idx) => {
                                    const isNew = !before?.matin?.secretaires.find(b => b.id === s.id);
                                    return (
                                      <div key={idx} className={`text-sm px-2 py-1 rounded ${
                                        isNew ? 'bg-green-500/10 text-green-700 font-medium' : 'bg-muted/50'
                                      }`}>
                                        {s.nom}
                                        {isNew && <span className="ml-2 text-xs">✨ Nouveau</span>}
                                      </div>
                                    );
                                  })
                                ) : (
                                  <div className="text-sm text-muted-foreground italic">Aucune assignation</div>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Après-midi Comparison */}
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <div className="text-xs text-muted-foreground mb-1 flex items-center justify-between">
                                <span>Après-midi - Avant</span>
                                {getStatusBadge(before?.apres_midi)}
                              </div>
                              <div className="space-y-1">
                                {before?.apres_midi?.secretaires.length ? (
                                  before.apres_midi.secretaires.map((s, idx) => (
                                    <div key={idx} className={`text-sm px-2 py-1 rounded ${
                                      hasAmChanges && !after?.apres_midi?.secretaires.find(a => a.id === s.id)
                                        ? 'bg-destructive/10 text-destructive line-through'
                                        : 'bg-muted/50'
                                    }`}>
                                      {s.nom}
                                    </div>
                                  ))
                                ) : (
                                  <div className="text-sm text-muted-foreground italic">Aucune assignation</div>
                                )}
                              </div>
                            </div>

                            <div>
                              <div className="text-xs text-muted-foreground mb-1 flex items-center justify-between">
                                <span>Après-midi - Après</span>
                                {getStatusBadge(after?.apres_midi)}
                              </div>
                              <div className="space-y-1">
                                {after?.apres_midi?.secretaires.length ? (
                                  after.apres_midi.secretaires.map((s, idx) => {
                                    const isNew = !before?.apres_midi?.secretaires.find(b => b.id === s.id);
                                    return (
                                      <div key={idx} className={`text-sm px-2 py-1 rounded ${
                                        isNew ? 'bg-green-500/10 text-green-700 font-medium' : 'bg-muted/50'
                                      }`}>
                                        {s.nom}
                                        {isNew && <span className="ml-2 text-xs">✨ Nouveau</span>}
                                      </div>
                                    );
                                  })
                                ) : (
                                  <div className="text-sm text-muted-foreground italic">Aucune assignation</div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              )}

              {/* Apply button */}
              {onApply && result.improvement.unmet_diff <= 0 && (
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
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
};
