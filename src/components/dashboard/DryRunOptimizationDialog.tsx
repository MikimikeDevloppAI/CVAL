import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, ArrowRight } from 'lucide-react';
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
  type_intervention_avant_nom: string | null;
  type_intervention_apres_nom: string | null;
  type: 'site' | 'bloc_operatoire';
}

interface GroupedChange {
  secretaire_id: string;
  secretaire_nom: string;
  periods: Array<{
    demi_journee: 'matin' | 'apres_midi';
    avant: string;
    apres: string;
  }>;
}

interface SiteSatisfaction {
  site_nom: string;
  avant: { satisfait: number; partiel: number; non_satisfait: number };
  apres: { satisfait: number; partiel: number; non_satisfait: number };
}

interface DryRunResult {
  success: boolean;
  message: string;
  before: {
    total_unmet: number;
    assignments_count: number;
    assignments?: any[];
  };
  after: {
    total_unmet: number;
    assignments_count: number;
    assignments?: any[];
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

  // Group changes by secretary when both morning and afternoon have the same change
  const groupedChanges = useMemo(() => {
    const groups = new Map<string, GroupedChange>();
    
    changes.forEach(change => {
      const key = change.secretaire_id;
      
      if (!groups.has(key)) {
        groups.set(key, {
          secretaire_id: change.secretaire_id,
          secretaire_nom: change.secretaire_nom,
          periods: []
        });
      }
      
      const group = groups.get(key)!;
      const avant = change.type === 'bloc_operatoire' 
        ? `${change.site_avant_nom || 'Non assigné'} - ${change.type_intervention_avant_nom || ''} (${change.besoin_operation_avant_nom || ''})`
        : change.site_avant_nom || 'Non assigné';
      const apres = change.type === 'bloc_operatoire'
        ? `${change.site_apres_nom || 'Non assigné'} - ${change.type_intervention_apres_nom || ''} (${change.besoin_operation_apres_nom || ''})`
        : change.site_apres_nom || 'Non assigné';
      
      group.periods.push({
        demi_journee: change.demi_journee,
        avant,
        apres
      });
    });
    
    // Check if morning and afternoon can be merged
    const result: GroupedChange[] = [];
    groups.forEach(group => {
      if (group.periods.length === 2) {
        const matin = group.periods.find(p => p.demi_journee === 'matin');
        const am = group.periods.find(p => p.demi_journee === 'apres_midi');
        
        if (matin && am && matin.avant === am.avant && matin.apres === am.apres) {
          // Merge into one entry
          result.push({
            ...group,
            periods: [{ demi_journee: 'matin', avant: matin.avant, apres: matin.apres }]
          });
        } else {
          result.push(group);
        }
      } else {
        result.push(group);
      }
    });
    
    return result;
  }, [changes]);

  // Calculate site satisfaction from result
  const siteSatisfaction = useMemo<SiteSatisfaction[]>(() => {
    if (!result || !result.before || !result.after) return [];
    
    const siteStats = new Map<string, SiteSatisfaction>();
    
    // Process before assignments
    result.before.assignments?.forEach((assignment: any) => {
      if (!siteStats.has(assignment.site_nom)) {
        siteStats.set(assignment.site_nom, {
          site_nom: assignment.site_nom,
          avant: { satisfait: 0, partiel: 0, non_satisfait: 0 },
          apres: { satisfait: 0, partiel: 0, non_satisfait: 0 }
        });
      }
      
      const stats = siteStats.get(assignment.site_nom)!;
      if (assignment.status === 'satisfait') stats.avant.satisfait++;
      else if (assignment.status === 'partiel') stats.avant.partiel++;
      else stats.avant.non_satisfait++;
    });
    
    // Process after assignments
    result.after.assignments?.forEach((assignment: any) => {
      if (!siteStats.has(assignment.site_nom)) {
        siteStats.set(assignment.site_nom, {
          site_nom: assignment.site_nom,
          avant: { satisfait: 0, partiel: 0, non_satisfait: 0 },
          apres: { satisfait: 0, partiel: 0, non_satisfait: 0 }
        });
      }
      
      const stats = siteStats.get(assignment.site_nom)!;
      if (assignment.status === 'satisfait') stats.apres.satisfait++;
      else if (assignment.status === 'partiel') stats.apres.partiel++;
      else stats.apres.non_satisfait++;
    });
    
    return Array.from(siteStats.values());
  }, [result]);

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
            )
          `)
          .eq('date', date);

        if (dryRunError) {
          console.error('Error fetching dry_run:', dryRunError);
          throw dryRunError;
        }

        // Fetch secretaires, site and besoin_operation names
        const secretaireIds = new Set<string>();
        const siteIds = new Set<string>();
        const besoinOpIds = new Set<string>();
        const blocOpIds = new Set<string>();

        (dryRunData || []).forEach((record: any) => {
          if (record.secretaire_id) secretaireIds.add(record.secretaire_id);
          if (record.capacite_effective.site_id) siteIds.add(record.capacite_effective.site_id);
          if (record.site_id) siteIds.add(record.site_id);
          if (record.capacite_effective.besoin_operation_id) besoinOpIds.add(record.capacite_effective.besoin_operation_id);
          if (record.besoin_operation_id) besoinOpIds.add(record.besoin_operation_id);
          if (record.capacite_effective.planning_genere_bloc_operatoire_id) blocOpIds.add(record.capacite_effective.planning_genere_bloc_operatoire_id);
          if (record.planning_genere_bloc_operatoire_id) blocOpIds.add(record.planning_genere_bloc_operatoire_id);
        });

        const { data: secretairesData } = await supabase
          .from('secretaires')
          .select('id, name, first_name')
          .in('id', Array.from(secretaireIds));

        const { data: sitesData } = await supabase
          .from('sites')
          .select('id, nom')
          .in('id', Array.from(siteIds));

        const { data: besoinsData } = await supabase
          .from('besoins_operations')
          .select('id, nom')
          .in('id', Array.from(besoinOpIds));

        const { data: blocData } = await supabase
          .from('planning_genere_bloc_operatoire')
          .select('id, type_intervention_id, types_intervention(nom)')
          .in('id', Array.from(blocOpIds));

        const secretairesMap = new Map(secretairesData?.map(s => [s.id, `${s.first_name} ${s.name}`]) || []);
        const sitesMap = new Map(sitesData?.map(s => [s.id, s.nom]) || []);
        const besoinsMap = new Map(besoinsData?.map(b => [b.id, b.nom]) || []);
        const typeInterventionMap = new Map(
          blocData?.map(b => [b.id, (b.types_intervention as any)?.nom || null]) || []
        );

        const changesList: Change[] = (dryRunData || []).map((record: any) => {
          const isBloc = record.planning_genere_bloc_operatoire_id !== null;
          
          return {
            secretaire_id: record.secretaire_id,
            secretaire_nom: secretairesMap.get(record.secretaire_id) || 'Inconnu',
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
            type_intervention_avant_nom: typeInterventionMap.get(record.capacite_effective.planning_genere_bloc_operatoire_id) || null,
            type_intervention_apres_nom: typeInterventionMap.get(record.planning_genere_bloc_operatoire_id) || null,
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

              {/* Site Satisfaction Summary */}
              {siteSatisfaction.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">Satisfaction des sites</h3>
                  <div className="border rounded text-xs">
                    <table className="w-full">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left p-2 font-medium">Site</th>
                          <th className="text-center p-2 font-medium">Avant</th>
                          <th className="text-center p-2 font-medium">Après</th>
                        </tr>
                      </thead>
                      <tbody>
                        {siteSatisfaction.map((site, idx) => (
                          <tr key={idx} className="border-t">
                            <td className="p-2">{site.site_nom}</td>
                            <td className="p-2 text-center">
                              {site.avant.satisfait > 0 && `✓${site.avant.satisfait} `}
                              {site.avant.partiel > 0 && `~${site.avant.partiel} `}
                              {site.avant.non_satisfait > 0 && `✗${site.avant.non_satisfait}`}
                            </td>
                            <td className="p-2 text-center">
                              {site.apres.satisfait > 0 && `✓${site.apres.satisfait} `}
                              {site.apres.partiel > 0 && `~${site.apres.partiel} `}
                              {site.apres.non_satisfait > 0 && `✗${site.apres.non_satisfait}`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

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
              ) : groupedChanges.length > 0 ? (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold">Changements proposés ({changes.length})</h3>
                  
                  <div className="border rounded text-sm">
                    <table className="w-full">
                      <thead className="bg-muted/30 text-xs">
                        <tr>
                          <th className="text-left p-2 font-medium">Secrétaire</th>
                          <th className="text-left p-2 font-medium">Période</th>
                          <th className="text-left p-2 font-medium">Avant</th>
                          <th className="text-left p-2 font-medium">Après</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groupedChanges.map((group, idx) => (
                          group.periods.length === 1 && changes.filter(c => c.secretaire_id === group.secretaire_id).length === 2 ? (
                            // Both morning and afternoon merged into one
                            <tr key={idx} className="border-t">
                              <td className="p-2 font-medium">{group.secretaire_nom}</td>
                              <td className="p-2">Journée complète</td>
                              <td className="p-2 text-muted-foreground">{group.periods[0].avant}</td>
                              <td className="p-2">{group.periods[0].apres}</td>
                            </tr>
                          ) : (
                            // Separate entries for each period
                            group.periods.map((period, periodIdx) => (
                              <tr key={`${idx}-${periodIdx}`} className="border-t">
                                {periodIdx === 0 && (
                                  <td className="p-2 font-medium" rowSpan={group.periods.length}>
                                    {group.secretaire_nom}
                                  </td>
                                )}
                                <td className="p-2">
                                  {period.demi_journee === 'matin' ? 'Matin' : 'Après-midi'}
                                </td>
                                <td className="p-2 text-muted-foreground">{period.avant}</td>
                                <td className="p-2">{period.apres}</td>
                              </tr>
                            ))
                          )
                        ))}
                      </tbody>
                    </table>
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
