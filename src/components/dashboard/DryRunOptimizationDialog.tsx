import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, ArrowRight, User, Sun, Moon } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Change {
  secretaire_id: string;
  secretaire_nom: string;
  date: string;
  demi_journee: 'matin' | 'apres_midi';
  site_avant_id: string | null;
  site_avant_nom: string | null;
  site_apres_id: string | null;
  site_apres_nom: string | null;
  besoin_operation_avant_id: string | null;
  besoin_operation_avant_nom: string | null;
  besoin_operation_apres_id: string | null;
  besoin_operation_apres_nom: string | null;
  type: 'site' | 'bloc_operatoire';
}

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
  const [changes, setChanges] = useState<Change[]>([]);
  const [loadingChanges, setLoadingChanges] = useState(false);

  useEffect(() => {
    if (!open || !result) {
      setChanges([]);
      return;
    }

    const fetchChanges = async () => {
      setLoadingChanges(true);
      try {
        // Fetch dry_run records (only changes)
        const { data: dryRunData, error: dryRunError } = await supabase
          .from('capacite_effective_dry_run')
          .select(`
            *,
            capacite_effective!inner(
              site_id,
              besoin_operation_id,
              planning_genere_bloc_operatoire_id
            ),
            secretaires!inner(nom, prenom)
          `)
          .eq('date', date);

        if (dryRunError) {
          console.error('Error fetching dry_run:', dryRunError);
          throw dryRunError;
        }

        // Fetch site and besoin_operation names
        const siteIds = new Set<string>();
        const besoinOpIds = new Set<string>();

        (dryRunData || []).forEach((record: any) => {
          if (record.capacite_effective.site_id) siteIds.add(record.capacite_effective.site_id);
          if (record.site_id) siteIds.add(record.site_id);
          if (record.capacite_effective.besoin_operation_id) besoinOpIds.add(record.capacite_effective.besoin_operation_id);
          if (record.besoin_operation_id) besoinOpIds.add(record.besoin_operation_id);
        });

        const { data: sitesData } = await supabase
          .from('sites')
          .select('id, nom')
          .in('id', Array.from(siteIds));

        const { data: besoinsData } = await supabase
          .from('besoins_operations')
          .select('id, nom')
          .in('id', Array.from(besoinOpIds));

        const sitesMap = new Map(sitesData?.map(s => [s.id, s.nom]) || []);
        const besoinsMap = new Map(besoinsData?.map(b => [b.id, b.nom]) || []);

        const changesList: Change[] = (dryRunData || []).map((record: any) => {
          const isBloc = record.planning_genere_bloc_operatoire_id !== null;
          
          return {
            secretaire_id: record.secretaire_id,
            secretaire_nom: `${record.secretaires.prenom} ${record.secretaires.nom}`,
            date: record.date,
            demi_journee: record.demi_journee,
            site_avant_id: record.capacite_effective.site_id,
            site_avant_nom: sitesMap.get(record.capacite_effective.site_id) || null,
            site_apres_id: record.site_id,
            site_apres_nom: sitesMap.get(record.site_id) || null,
            besoin_operation_avant_id: record.capacite_effective.besoin_operation_id,
            besoin_operation_avant_nom: besoinsMap.get(record.capacite_effective.besoin_operation_id) || null,
            besoin_operation_apres_id: record.besoin_operation_id,
            besoin_operation_apres_nom: besoinsMap.get(record.besoin_operation_id) || null,
            type: isBloc ? 'bloc_operatoire' : 'site',
          };
        });

        setChanges(changesList);
      } catch (error) {
        console.error('Error fetching changes:', error);
        toast.error('Erreur lors du chargement des changements');
      } finally {
        setLoadingChanges(false);
      }
    };

    fetchChanges();
  }, [open, result, date]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
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
              <div className="grid grid-cols-2 gap-4">
                <Card>
                  <CardContent className="pt-6">
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
                    <div className="text-xs text-muted-foreground mt-1">
                      {result.improvement.unmet_diff < 0 
                        ? `${Math.abs(result.improvement.unmet_diff)} de moins` 
                        : result.improvement.unmet_diff > 0
                        ? `${result.improvement.unmet_diff} de plus`
                        : 'Identique'
                      }
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="pt-6">
                    <div className="text-sm text-muted-foreground mb-1">Score d'optimisation</div>
                    <div className="text-2xl font-bold">{Math.round(result.improvement.score_improvement)}</div>
                  </CardContent>
                </Card>
              </div>

              {/* Status Message */}
              <Alert className={
                result.improvement.unmet_diff < 0 
                  ? "border-green-500 bg-green-50" 
                  : result.improvement.unmet_diff > 0
                  ? "border-red-500 bg-red-50"
                  : "border-blue-500 bg-blue-50"
              }>
                <AlertTitle>
                  {result.improvement.unmet_diff < 0 
                    ? "✅ Amélioration détectée" 
                    : result.improvement.unmet_diff > 0
                    ? "⚠️ Détérioration détectée"
                    : "ℹ️ Aucune amélioration"
                  }
                </AlertTitle>
                <AlertDescription>{result.message}</AlertDescription>
              </Alert>

              {/* Changes List */}
              {loadingChanges ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-4 w-4 animate-spin text-primary mr-2" />
                  <span className="text-sm text-muted-foreground">Chargement des changements...</span>
                </div>
              ) : changes.length > 0 ? (
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold">Changements proposés ({changes.length})</h3>
                  
                  <div className="space-y-3">
                    {changes.map((change, idx) => (
                      <Card key={idx} className="bg-primary/5 border-primary/30">
                        <CardContent className="pt-4">
                          <div className="flex items-start justify-between">
                            <div className="space-y-2">
                              <div className="font-semibold flex items-center gap-2">
                                <User className="h-4 w-4" />
                                {change.secretaire_nom}
                              </div>
                              <div className="text-sm text-muted-foreground flex items-center gap-2">
                                {change.demi_journee === 'matin' ? (
                                  <Sun className="h-4 w-4" />
                                ) : (
                                  <Moon className="h-4 w-4" />
                                )}
                                {change.demi_journee === 'matin' ? 'Matin' : 'Après-midi'}
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-3">
                              <div className="text-sm text-right">
                                <div className="text-xs text-muted-foreground mb-1">Avant</div>
                                <div className="font-medium">
                                  {change.type === 'site' ? (
                                    change.site_avant_nom || 'Non assigné'
                                  ) : (
                                    change.besoin_operation_avant_nom || 'Non assigné'
                                  )}
                                </div>
                              </div>
                              <ArrowRight className="h-4 w-4 text-primary" />
                              <div className="text-sm text-right">
                                <div className="text-xs text-muted-foreground mb-1">Après</div>
                                <div className="font-medium text-green-600">
                                  {change.type === 'site' ? (
                                    change.site_apres_nom || 'Non assigné'
                                  ) : (
                                    change.besoin_operation_apres_nom || 'Non assigné'
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              ) : (
                <Alert>
                  <AlertTitle>Aucun changement</AlertTitle>
                  <AlertDescription>
                    L'optimisation n'a proposé aucune modification aux assignations existantes.
                  </AlertDescription>
                </Alert>
              )}

              {/* Action Buttons */}
              {onApply && result.improvement.unmet_diff <= 0 && changes.length > 0 && (
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isApplying}>
                    Annuler
                  </Button>
                  <Button onClick={onApply} disabled={isApplying}>
                    {isApplying ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Application en cours...
                      </>
                    ) : (
                      `Appliquer ces changements (${changes.length})`
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
