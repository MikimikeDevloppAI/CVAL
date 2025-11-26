import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Check, AlertCircle, ArrowRight } from 'lucide-react';
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

  const handleSelectAllForDate = (date: string) => {
    const dayResult = result?.results.find(r => r.date === date);
    if (!dayResult) return;

    const dateChangeIds = dayResult.individual_changes
      .filter((change) => change.after)
      .map(change => `${change.date}_${change.secretaire_id}_${change.periode}`);

    const allSelected = dateChangeIds.every(id => selectedChanges.has(id));
    const newSelected = new Set(selectedChanges);

    if (allSelected) {
      dateChangeIds.forEach(id => newSelected.delete(id));
    } else {
      dateChangeIds.forEach(id => newSelected.add(id));
    }

    setSelectedChanges(newSelected);
  };

  const handleSelectAll = () => {
    if (!result) return;
    
    const allChangeIds = result.results.flatMap(dayResult =>
      (dayResult.individual_changes || [])
        .filter((change) => change.after)
        .map(change => `${change.date}_${change.secretaire_id}_${change.periode}`)
    );

    if (selectedChanges.size === allChangeIds.length) {
      setSelectedChanges(new Set());
    } else {
      setSelectedChanges(new Set(allChangeIds));
    }
  };

  const handleApply = async () => {
    console.log('handleApply called, selectedChanges:', selectedChanges.size);
    
    if (selectedChanges.size === 0) {
      toast.error('Veuillez sélectionner au moins un changement');
      return;
    }

    setApplying(true);

    try {
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

      console.log('Processing changes for', changesByDate.size, 'dates');

      for (const [date, secretariesMap] of changesByDate) {
        for (const [secretaire_id, periodesMap] of secretariesMap) {
          for (const [periode, change] of periodesMap) {
            if (change.after) {
              console.log('Updating assignment:', { date, secretaire_id, periode, after: change.after });
              
              const { error: updateError } = await supabase
                .from('capacite_effective')
                .update({
                  site_id: change.after.site_id,
                  besoin_operation_id: change.after.besoin_operation_id || null,
                  is_1r: change.after.is_1r,
                  is_2f: change.after.is_2f,
                  is_3f: change.after.is_3f,
                })
                .eq('date', date)
                .eq('secretaire_id', secretaire_id)
                .eq('demi_journee', periode as 'matin' | 'apres_midi')
                .eq('actif', true);

              if (updateError) {
                console.error('Update error:', updateError);
                throw updateError;
              }
            }
          }
        }
      }

      console.log('Refreshing besoins view...');
      await supabase.functions.invoke('refresh-besoins-view');

      toast.success(`${selectedChanges.size} changement(s) appliqué(s)`);
      
      if (onRefresh) {
        onRefresh();
      }
      
      onOpenChange(false);
      setSelectedChanges(new Set());
    } catch (error: any) {
      console.error('Error applying changes:', error);
      toast.error(`Erreur: ${error.message || "Impossible d'appliquer les changements"}`);
    } finally {
      setApplying(false);
    }
  };

  const formatAssignment = (assignment: IndividualChange['before'] | IndividualChange['after']) => {
    if (!assignment) return '-';
    
    const badges = [];
    if (assignment.is_1r) badges.push('1R');
    if (assignment.is_2f) badges.push('2F');
    if (assignment.is_3f) badges.push('3F');
    
    const location = assignment.type === 'site' 
      ? assignment.site_nom 
      : assignment.besoin_operation_nom;
    
    return badges.length > 0 
      ? `${location} [${badges.join(', ')}]`
      : location;
  };

  const getDateSelectedCount = (date: string) => {
    const dayResult = result?.results.find(r => r.date === date);
    if (!dayResult) return 0;

    const dateChangeIds = dayResult.individual_changes
      .filter((change) => change.after)
      .map(change => `${change.date}_${change.secretaire_id}_${change.periode}`);

    return dateChangeIds.filter(id => selectedChanges.has(id)).length;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>Optimisation proposée</span>
            {result && (
              <Badge variant="outline" className="ml-2">
                 {result.results.reduce((sum, r) => sum + ((r.individual_changes || []).filter(c => c.after).length), 0)} changement(s) sur {result.results.length} jour(s)
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="ml-3 text-sm text-muted-foreground">Analyse en cours...</span>
            </div>
          ) : result && result.results.length > 0 ? (
            <div className="space-y-6">
              {/* Summary */}
              <Alert className="flex items-center gap-3 [&>svg]:!relative [&>svg]:!top-auto [&>svg]:!left-auto [&>svg+div]:!translate-y-0 [&>svg+div]:!pl-0">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <AlertDescription className="flex-1 flex items-center justify-between gap-4">
                  <div>
                    Amélioration totale : <strong className={result.totalImprovements > 0 ? 'text-green-600' : 'text-red-600'}>
                      {result.totalImprovements > 0 ? '+' : ''}{result.totalImprovements}
                    </strong> besoin(s) satisfait(s)
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={handleSelectAll}
                    className="shrink-0"
                  >
                     {selectedChanges.size === result.results.reduce((sum, r) => sum + ((r.individual_changes || []).filter(c => c.after).length), 0)
                      ? 'Tout désélectionner'
                      : 'Tout sélectionner'}
                  </Button>
                </AlertDescription>
              </Alert>

              {/* Changes by date */}
              {result.results.map((dayResult) => {
                const selectedCount = getDateSelectedCount(dayResult.date);
                 const totalCount = (dayResult.individual_changes || []).filter(c => c.after).length;
                
                return (
                  <div key={dayResult.date} className="border rounded-lg overflow-hidden">
                    <div className="bg-muted/30 p-4 flex items-center justify-between border-b">
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={selectedCount === totalCount && totalCount > 0}
                          onCheckedChange={() => handleSelectAllForDate(dayResult.date)}
                        />
                        <div>
                          <h4 className="font-semibold">
                            {format(new Date(dayResult.date), 'EEEE dd MMMM yyyy', { locale: fr })}
                          </h4>
                          <p className="text-sm text-muted-foreground">
                            {dayResult.before.total_unmet} → {dayResult.after.total_unmet} besoins non satisfaits
                            <Badge 
                              variant="outline" 
                              className={`ml-2 ${dayResult.improvement.unmet_diff > 0 ? 'bg-green-50 text-green-700 border-green-200' : dayResult.improvement.unmet_diff < 0 ? 'bg-red-50 text-red-700 border-red-200' : 'bg-blue-50 text-blue-700 border-blue-200'}`}
                            >
                              {dayResult.improvement.unmet_diff > 0 ? '+' : ''}{dayResult.improvement.unmet_diff}
                            </Badge>
                          </p>
                        </div>
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {selectedCount}/{totalCount} sélectionné(s)
                      </span>
                    </div>

                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12"></TableHead>
                          <TableHead>Secrétaire</TableHead>
                          <TableHead>Période</TableHead>
                          <TableHead>Avant</TableHead>
                          <TableHead className="w-12"></TableHead>
                          <TableHead>Après</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(dayResult.individual_changes || [])
                          .filter((change) => change.after)
                          .map((change) => {
                            const changeId = `${change.date}_${change.secretaire_id}_${change.periode}`;
                            return (
                              <TableRow key={changeId}>
                                <TableCell>
                                  <Checkbox
                                    checked={selectedChanges.has(changeId)}
                                    onCheckedChange={() => handleToggleChange(changeId)}
                                  />
                                </TableCell>
                                <TableCell className="font-medium">{change.secretaire_nom}</TableCell>
                                <TableCell>
                                  <Badge variant="outline" className="text-xs">
                                    {change.periode === 'matin' ? 'Matin' : 'Après-midi'}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-muted-foreground">
                                  {formatAssignment(change.before)}
                                </TableCell>
                                <TableCell className="text-center">
                                  <ArrowRight className="h-4 w-4 text-primary mx-auto" />
                                </TableCell>
                                <TableCell className="font-medium">
                                  {change.after && (
                                    <span className="text-green-700">
                                      {formatAssignment(change.after)}
                                    </span>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                      </TableBody>
                    </Table>
                  </div>
                );
              })}
            </div>
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
