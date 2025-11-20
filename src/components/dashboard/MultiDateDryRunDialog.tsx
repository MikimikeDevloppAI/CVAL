import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Check, X, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

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
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);

  const handleToggleDate = (date: string) => {
    const newSelected = new Set(selectedDates);
    if (newSelected.has(date)) {
      newSelected.delete(date);
    } else {
      newSelected.add(date);
    }
    setSelectedDates(newSelected);
  };

  const handleSelectAll = () => {
    if (!result) return;
    
    if (selectedDates.size === result.results.length) {
      setSelectedDates(new Set());
    } else {
      setSelectedDates(new Set(result.results.map(r => r.date)));
    }
  };

  const handleApply = async () => {
    if (selectedDates.size === 0) {
      toast.error('Veuillez sélectionner au moins une date');
      return;
    }

    setApplying(true);

    try {
      // Apply changes for each selected date
      for (const date of Array.from(selectedDates)) {
        // Fetch dry run data for this date
        const { data: dryRunData, error: fetchError } = await supabase
          .from('capacite_effective_dry_run')
          .select('*')
          .eq('date', date);

        if (fetchError) throw fetchError;

        if (dryRunData && dryRunData.length > 0) {
          // Delete existing capacities for this date
          const { error: deleteError } = await supabase
            .from('capacite_effective')
            .delete()
            .eq('date', date);

          if (deleteError) throw deleteError;

          // Insert new capacities from dry run
          const newCapacities = dryRunData.map(dr => ({
            secretaire_id: dr.secretaire_id,
            site_id: dr.site_id,
            date: dr.date,
            demi_journee: dr.demi_journee,
            besoin_operation_id: dr.besoin_operation_id,
            planning_genere_bloc_operatoire_id: dr.planning_genere_bloc_operatoire_id,
            is_1r: dr.is_1r,
            is_2f: dr.is_2f,
            is_3f: dr.is_3f,
            actif: dr.actif
          }));

          const { error: insertError } = await supabase
            .from('capacite_effective')
            .insert(newCapacities);

          if (insertError) throw insertError;

          // Delete dry run data for this date
          const { error: deleteDryRunError } = await supabase
            .from('capacite_effective_dry_run')
            .delete()
            .eq('date', date);

          if (deleteDryRunError) throw deleteDryRunError;
        }
      }

      // Refresh materialized views
      await supabase.functions.invoke('refresh-besoins-view');

      toast.success(`Optimisations appliquées pour ${selectedDates.size} date(s)`);
      
      if (onRefresh) {
        onRefresh();
      }
      
      onOpenChange(false);
      setSelectedDates(new Set());
    } catch (error) {
      console.error('Error applying changes:', error);
      toast.error("Erreur lors de l'application des changements");
    } finally {
      setApplying(false);
    }
  };

  const getStatusBadge = (improvement: number) => {
    if (improvement > 0) {
      return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">+{improvement} amélioration(s)</Badge>;
    } else if (improvement === 0) {
      return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">Identique</Badge>;
    } else {
      return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">{improvement} dégradation(s)</Badge>;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>Résultats de simulation multi-dates</span>
            {result && (
              <Badge variant="outline" className="ml-2">
                {result.results.length} date(s)
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
                      Total des améliorations : <strong>{result.totalImprovements}</strong> besoins satisfaits supplémentaires
                    </span>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={handleSelectAll}
                    >
                      {selectedDates.size === result.results.length ? 'Tout désélectionner' : 'Tout sélectionner'}
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>

              {/* Results by date */}
              <div className="space-y-3">
                {result.results.map((dayResult) => (
                  <Card key={dayResult.date} className="p-4">
                    <div className="flex items-start gap-4">
                      <Checkbox
                        checked={selectedDates.has(dayResult.date)}
                        onCheckedChange={() => handleToggleDate(dayResult.date)}
                        className="mt-1"
                      />
                      
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="font-medium">
                            {format(new Date(dayResult.date), 'EEEE dd MMMM yyyy', { locale: fr })}
                          </h4>
                          {getStatusBadge(dayResult.improvement.unmet_diff)}
                        </div>

                        <div className="grid grid-cols-3 gap-4 text-sm">
                          <div>
                            <div className="text-muted-foreground">Avant</div>
                            <div className="font-medium">
                              {dayResult.before.total_unmet} besoin(s) non satisfait(s)
                            </div>
                          </div>
                          
                          <div>
                            <div className="text-muted-foreground">Après</div>
                            <div className="font-medium text-green-700">
                              {dayResult.after.total_unmet} besoin(s) non satisfait(s)
                            </div>
                          </div>
                          
                          <div>
                            <div className="text-muted-foreground">Changements</div>
                            <div className="font-medium">
                              {dayResult.improvement.assignment_changes} affectation(s)
                            </div>
                          </div>
                        </div>

                        {dayResult.improvement.score_improvement !== 0 && (
                          <div className="mt-2 text-xs text-muted-foreground">
                            Score : {dayResult.improvement.score_improvement > 0 ? '+' : ''}{dayResult.improvement.score_improvement}
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </>
          ) : (
            <div className="text-center p-8 text-muted-foreground">
              Aucun résultat disponible
            </div>
          )}
        </div>

        <DialogFooter className="border-t pt-4">
          <div className="flex items-center justify-between w-full">
            <div className="text-sm text-muted-foreground">
              {selectedDates.size} date(s) sélectionnée(s)
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Annuler
              </Button>
              <Button 
                onClick={handleApply}
                disabled={selectedDates.size === 0 || applying}
              >
                {applying ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Application...
                  </>
                ) : (
                  <>
                    <Check className="mr-2 h-4 w-4" />
                    Appliquer ({selectedDates.size})
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
