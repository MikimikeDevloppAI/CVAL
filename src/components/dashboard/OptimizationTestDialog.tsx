import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle2, XCircle, AlertCircle, ArrowRight, User } from "lucide-react";

interface TestResult {
  feasible: boolean;
  all_needs_satisfied: boolean;
  before: {
    assignments: Assignment[];
  };
  after: {
    assignments: Assignment[];
  };
  changes: Change[];
  solution_score: number;
}

interface Assignment {
  site_nom: string;
  periode: string;
  type: string;
  secretaires: {
    id: string;
    nom: string;
    is_backup: boolean;
    is_1r: boolean;
    is_2f: boolean;
    is_3f: boolean;
  }[];
  nombre_requis: number;
  nombre_assigne: number;
  status: 'satisfait' | 'partiel' | 'non_satisfait';
}

interface Change {
  site_nom: string;
  periode: string;
  removed: string[];
  added: string[];
  unchanged: string[];
  satisfaction_before: string;
  satisfaction_after: string;
}

interface OptimizationTestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: string;
  result: TestResult | null;
  onApply?: () => void;
  isApplying?: boolean;
}

export function OptimizationTestDialog({
  open,
  onOpenChange,
  date,
  result,
  onApply,
  isApplying = false
}: OptimizationTestDialogProps) {
  if (!result) return null;

  const formatDate = (dateStr: string) => {
    if (!dateStr || dateStr.trim() === '') return 'Date non disponible';
    const parsedDate = new Date(dateStr);
    if (isNaN(parsedDate.getTime())) return 'Date non disponible';
    return parsedDate.toLocaleDateString('fr-FR', { 
      weekday: 'long', 
      day: 'numeric', 
      month: 'long', 
      year: 'numeric' 
    });
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'satisfait':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'partiel':
        return <AlertCircle className="h-4 w-4 text-orange-500" />;
      default:
        return <XCircle className="h-4 w-4 text-red-500" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'satisfait':
        return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">100%</Badge>;
      case 'partiel':
        return <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">Partiel</Badge>;
      default:
        return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">Manquant</Badge>;
    }
  };

  const formatPeriode = (periode: string) => {
    return periode === 'matin' ? 'Matin' : 'Après-midi';
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            {result.all_needs_satisfied ? (
              <>
                <CheckCircle2 className="h-6 w-6 text-green-500" />
                <span>Solution trouvée - {formatDate(date)}</span>
              </>
            ) : (
              <>
                <AlertCircle className="h-6 w-6 text-orange-500" />
                <span>Solution partielle - {formatDate(date)}</span>
              </>
            )}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-6 pr-4">
            {/* Summary */}
            <div className="rounded-lg border border-border bg-muted/30 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-muted-foreground">Résultat</div>
                  <div className="text-lg font-semibold">
                    {result.all_needs_satisfied ? (
                      <span className="text-green-600">Tous les besoins satisfaits ✓</span>
                    ) : (
                      <span className="text-orange-600">
                        {result.after.assignments.filter(a => a.status === 'satisfait').length} / {result.after.assignments.length} besoins satisfaits
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-muted-foreground">Modifications</div>
                  <div className="text-lg font-semibold">{result.changes.length}</div>
                </div>
              </div>
            </div>

            {/* Changes List */}
            {result.changes.length > 0 ? (
              <div className="space-y-4">
                <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
                  Modifications proposées
                </h3>
                {result.changes.map((change, idx) => (
                  <div key={idx} className="rounded-lg border border-border bg-card p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">{change.site_nom}</div>
                        <div className="text-sm text-muted-foreground">{formatPeriode(change.periode)}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        {getStatusBadge(change.satisfaction_before)}
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                        {getStatusBadge(change.satisfaction_after)}
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4 pt-2 border-t">
                      {/* Removed */}
                      {change.removed.length > 0 && (
                        <div className="space-y-1">
                          <div className="text-xs font-medium text-red-600 uppercase tracking-wide">Retirées</div>
                          {change.removed.map((nom, i) => (
                            <div key={i} className="flex items-center gap-1.5 text-sm text-red-700 bg-red-50 rounded px-2 py-1">
                              <User className="h-3 w-3" />
                              <span className="line-through opacity-75">{nom}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Unchanged */}
                      {change.unchanged.length > 0 && (
                        <div className="space-y-1">
                          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Maintenues</div>
                          {change.unchanged.map((nom, i) => (
                            <div key={i} className="flex items-center gap-1.5 text-sm text-muted-foreground bg-muted rounded px-2 py-1">
                              <User className="h-3 w-3" />
                              <span>{nom}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Added */}
                      {change.added.length > 0 && (
                        <div className="space-y-1">
                          <div className="text-xs font-medium text-green-600 uppercase tracking-wide">Ajoutées</div>
                          {change.added.map((nom, i) => (
                            <div key={i} className="flex items-center gap-1.5 text-sm text-green-700 bg-green-50 rounded px-2 py-1 font-medium">
                              <User className="h-3 w-3" />
                              <span>{nom}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-muted/30 p-6 text-center">
                <CheckCircle2 className="h-8 w-8 text-green-500 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  Les assignments actuelles sont déjà optimales
                </p>
              </div>
            )}

            {/* Unchanged assignments */}
            {result.after.assignments.filter(a => {
              const hasChange = result.changes.some(c => 
                c.site_nom === a.site_nom && c.periode === a.periode
              );
              return !hasChange && a.secretaires.length > 0;
            }).length > 0 && (
              <div className="space-y-3">
                <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
                  Sans changement
                </h3>
                <div className="space-y-2">
                  {result.after.assignments
                    .filter(a => {
                      const hasChange = result.changes.some(c => 
                        c.site_nom === a.site_nom && c.periode === a.periode
                      );
                      return !hasChange && a.secretaires.length > 0;
                    })
                    .map((assign, idx) => (
                      <div key={idx} className="rounded border border-border bg-muted/20 p-3">
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <div className="text-sm font-medium">{assign.site_nom}</div>
                            <div className="text-xs text-muted-foreground">{formatPeriode(assign.periode)}</div>
                          </div>
                          {getStatusBadge(assign.status)}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {assign.secretaires.map((sec, i) => (
                            <Badge key={i} variant="secondary" className="text-xs">
                              {sec.nom}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fermer
          </Button>
          {onApply && result.changes.length > 0 && (
            <Button onClick={onApply} disabled={isApplying}>
              {isApplying ? 'Application...' : 'Appliquer cette solution'}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
