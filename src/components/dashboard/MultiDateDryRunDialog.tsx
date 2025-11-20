import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Check, X, AlertCircle, ArrowRight } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface IndividualChange {
  date: string;
  secretaire_id: string;
  secretaire_nom: string;
  periode: 'matin' | 'apres_midi';
  before: {
    site_id: string;
    site_nom: string;
    type: string;
    besoin_operation_id?: string;
    besoin_operation_nom?: string;
    is_1r: boolean;
    is_2f: boolean;
    is_3f: boolean;
  } | null;
  after: {
    site_id: string;
    site_nom: string;
    type: string;
    besoin_operation_id?: string;
    besoin_operation_nom?: string;
    is_1r: boolean;
    is_2f: boolean;
    is_3f: boolean;
  } | null;
}

interface SingleDayResult {
  success: boolean;
  message: string;
  date: string;
  before: {
    total_unmet: number;
    assignments_count: number;
  };
  after: {
    total_unmet: number;
    assignments_count: number;
  };
  improvement: {
    unmet_diff: number;
    assignment_changes: number;
    score_improvement: number;
  };
  individual_changes: IndividualChange[];
}

interface MultiDateResult {
  success: boolean;
  dates: string[];
  results: SingleDayResult[];
  totalImprovements: number;
}

interface MultiDateDryRunDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: MultiDateResult | null;
  isLoading: boolean;
  onRefresh?: () => void;
}

export const MultiDateDryRunDialog = ({
  open,
  onOpenChange,
  result,
  isLoading,
  onRefresh
}: MultiDateDryRunDialogProps) => {
  const [selectedChanges, setSelectedChanges] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);

  const handleToggleChange = (changeId: string) => {
    const newSelected = new Set(selectedChanges);
    if (newSelected.has(changeId)) {
      newSelected.delete(changeId);
    } else {
      newSelected.add(changeId);
    }
    setSelectedChanges(newSelected);
  };

  const handleSelectAll = () => {
    if (!result) return;
    
    const allChangeIds = result.results.flatMap(dayResult =>
      dayResult.individual_changes.map(change =>
        `${change.date}_${change.secretaire_id}_${change.periode}`
      )
    );

    if (selectedChanges.size === allChangeIds.length) {
      setSelectedChanges(new Set());
    } else {
      setSelectedChanges(new Set(allChangeIds));
    }
  };

  const handleApply = async () => {
    if (selectedChanges.size === 0) {
      toast.error('Veuillez sélectionner au moins un changement');
      return;
    }

    setApplying(true);

    try {
      // Group selected changes by date and secretary
      const changesByDate = new Map<string, Map<string, Map<string, IndividualChange>>>();
      
      result?.results.forEach(dayResult => {
        dayResult.individual_changes.forEach(change => {
          const changeId = `${change.date}_${change.secretaire_id}_${change.periode}`;
          if (!selectedChanges.has(changeId)) return;

          if (!changesByDate.has(change.date)) {
            changesByDate.set(change.date, new Map());
          }
          const dateMap = changesByDate.get(change.date)!;
          
          if (!dateMap.has(change.secretaire_id)) {
            dateMap.set(change.secretaire_id, new Map());
          }
          const secMap = dateMap.get(change.secretaire_id)!;
          secMap.set(change.periode, change);
        });
      });

      // Apply changes for each date
      for (const [date, secretariesMap] of changesByDate) {
        for (const [secretaire_id, periodesMap] of secretariesMap) {
          for (const [periode, change] of periodesMap) {
            // Delete existing capacity
            await supabase
              .from('capacite_effective')
              .delete()
              .eq('date', date)
              .eq('secretaire_id', secretaire_id)
              .eq('demi_journee', periode as 'matin' | 'apres_midi');

            // Insert new capacity if there's an "after" state
            if (change.after) {
              await supabase
                .from('capacite_effective')
                .insert({
                  secretaire_id: secretaire_id,
                  site_id: change.after.site_id,
                  date: date,
                  demi_journee: periode as 'matin' | 'apres_midi',
                  besoin_operation_id: change.after.besoin_operation_id || null,
                  planning_genere_bloc_operatoire_id: null,
                  is_1r: change.after.is_1r,
                  is_2f: change.after.is_2f,
                  is_3f: change.after.is_3f,
                  actif: true
                });
            }
          }
        }
      }

      // Refresh materialized views
      await supabase.functions.invoke('refresh-besoins-view');

      toast.success(`${selectedChanges.size} changement(s) appliqué(s)`);
      
      if (onRefresh) {
        onRefresh();
      }
      
      onOpenChange(false);
      setSelectedChanges(new Set());
    } catch (error) {
      console.error('Error applying changes:', error);
      toast.error("Erreur lors de l'application des changements");
    } finally {
      setApplying(false);
    }
  };

  const getStatusBadge = (improvement: number) => {
    if (improvement > 0) {
      return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">+{improvement}</Badge>;
    } else if (improvement === 0) {
      return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">≈</Badge>;
    } else {
      return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">{improvement}</Badge>;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>Changements proposés par l'optimisation</span>
            {result && (
              <Badge variant="outline" className="ml-2">
                {result.results.reduce((sum, r) => sum + (r.individual_changes?.length || 0), 0)} changement(s)
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-4">
          {isLoading ? (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="ml-3 text-sm text-muted-foreground">Analyse en cours...</span>
            </div>
          ) : result && result.results.length > 0 ? (
            <>
              {/* Summary */}
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <div className="flex items-center justify-between">
                    <span>
                      Total : <strong>{result.totalImprovements > 0 ? '+' : ''}{result.totalImprovements}</strong> amélioration(s)
                    </span>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={handleSelectAll}
                    >
                      {selectedChanges.size === result.results.reduce((sum, r) => sum + (r.individual_changes?.length || 0), 0)
                        ? 'Tout désélectionner'
                        : 'Tout sélectionner'}
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>

              {/* Changes by date */}
              {result.results.map((dayResult) => (
                <Card key={dayResult.date} className="p-4">
                  <div className="mb-4 pb-3 border-b flex items-center justify-between">
                    <h4 className="font-semibold text-base">
                      {format(new Date(dayResult.date), 'EEEE dd MMMM yyyy', { locale: fr })}
                    </h4>
                    <div className="flex items-center gap-3">
                      {getStatusBadge(dayResult.improvement.unmet_diff)}
                      <span className="text-sm text-muted-foreground">
                        {dayResult.individual_changes?.length || 0} changement(s)
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {(dayResult.individual_changes || []).map((change) => {
                      const changeId = `${change.date}_${change.secretaire_id}_${change.periode}`;
                      return (
                        <div 
                          key={changeId}
                          className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/30 transition-colors"
                        >
                          <Checkbox
                            checked={selectedChanges.has(changeId)}
                            onCheckedChange={() => handleToggleChange(changeId)}
                            className="mt-0.5"
                          />
                          
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium">{change.secretaire_nom}</span>
                              <Badge variant="outline" className="text-xs">
                                {change.periode === 'matin' ? 'Matin' : 'Après-midi'}
                              </Badge>
                            </div>
                            
                            <div className="flex items-center gap-2 text-sm">
                              {change.before && (
                                <div className="flex items-center gap-1 text-muted-foreground">
                                  <span>{change.before.type === 'site' ? change.before.site_nom : change.before.besoin_operation_nom}</span>
                                  {(change.before.is_1r || change.before.is_2f || change.before.is_3f) && (
                                    <span className="text-xs">
                                      [{[change.before.is_1r && '1R', change.before.is_2f && '2F', change.before.is_3f && '3F'].filter(Boolean).join(', ')}]
                                    </span>
                                  )}
                                </div>
                              )}
                              
                              {change.before && change.after && (
                                <ArrowRight className="h-3 w-3 text-primary flex-shrink-0" />
                              )}
                              
                              {change.after && (
                                <div className="flex items-center gap-1 font-medium">
                                  <span>{change.after.type === 'site' ? change.after.site_nom : change.after.besoin_operation_nom}</span>
                                  {(change.after.is_1r || change.after.is_2f || change.after.is_3f) && (
                                    <Badge variant="secondary" className="text-xs h-5">
                                      {[change.after.is_1r && '1R', change.after.is_2f && '2F', change.after.is_3f && '3F'].filter(Boolean).join(', ')}
                                    </Badge>
                                  )}
                                </div>
                              )}
                              
                              {!change.after && change.before && (
                                <span className="text-red-600 font-medium">Retrait</span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              ))}
            </>
          ) : (
            <div className="text-center p-8 text-muted-foreground">
              Aucun changement proposé
            </div>
          )}
        </div>

        <DialogFooter className="border-t pt-4">
          <div className="flex items-center justify-between w-full">
            <div className="text-sm text-muted-foreground">
              {selectedChanges.size} changement(s) sélectionné(s)
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Annuler
              </Button>
              <Button 
                onClick={handleApply}
                disabled={selectedChanges.size === 0 || applying}
              >
                {applying ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Application...
                  </>
                ) : (
                  <>
                    <Check className="mr-2 h-4 w-4" />
                    Appliquer ({selectedChanges.size})
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
