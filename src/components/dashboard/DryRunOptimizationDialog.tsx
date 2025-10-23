import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, XCircle, ArrowRight, Building2, Scissors, Plus, Minus } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';

interface Assignment {
  date: string;
  site_id: string;
  site_nom: string;
  periode: string;
  type: string;
  bloc_operation_id?: string;
  besoin_operation_id?: string;
  medecins_noms?: string[];
  operation_nom?: string;
  besoin_nom?: string;
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
  const [enrichedData, setEnrichedData] = useState<{
    medecinsByBesoin: Map<string, string[]>;
    blocInfoById: Map<string, { operation_nom: string; besoin_nom: string }>;
  } | null>(null);
  const [loadingEnrichment, setLoadingEnrichment] = useState(false);

  // Fetch enriched data when dialog opens
  useEffect(() => {
    if (open && date && result) {
      fetchEnrichedData();
    }
  }, [open, date, result]);

  const fetchEnrichedData = async () => {
    try {
      setLoadingEnrichment(true);

      // Récupérer les médecins des sites via besoin_effectif
      const { data: besoinsEffectifs, error: besoinsError } = await supabase
        .from('besoin_effectif')
        .select(`
          id,
          site_id,
          date,
          demi_journee,
          medecin_id,
          type,
          medecins(id, first_name, name)
        `)
        .eq('date', date)
        .eq('type', 'medecin');

      if (besoinsError) {
        console.error('Error fetching besoins effectifs:', besoinsError);
      }

      // Récupérer les infos des blocs opératoires
      const { data: planningBloc, error: blocError } = await supabase
        .from('planning_genere_bloc_operatoire')
        .select(`
          id,
          besoin_effectif_id,
          date,
          periode,
          type_intervention_id,
          types_intervention(id, nom)
        `)
        .eq('date', date);

      if (blocError) {
        console.error('Error fetching planning bloc:', blocError);
      }

      // Récupérer les besoins opérations depuis besoin_effectif
      const blocBesoinIds = planningBloc?.map(p => p.besoin_effectif_id).filter(Boolean) || [];
      let besoinsOperations: any[] = [];
      
      if (blocBesoinIds.length > 0) {
        const { data: besoinsOp, error: besoinsOpError } = await supabase
          .from('besoin_effectif')
          .select(`
            id,
            type_intervention_id,
            besoins_operations(id, nom)
          `)
          .in('id', blocBesoinIds);

        if (!besoinsOpError && besoinsOp) {
          besoinsOperations = besoinsOp;
        }
      }

      // Construire les maps de lookup
      const medecinsByBesoin = new Map<string, string[]>();
      
      // Grouper les médecins par (site_id, date, periode)
      const medecinsBySiteDate = new Map<string, string[]>();
      
      for (const besoin of besoinsEffectifs || []) {
        // Déterminer les périodes
        const periodes = besoin.demi_journee === 'toute_journee' 
          ? ['matin', 'apres_midi'] 
          : [besoin.demi_journee];

        for (const periode of periodes) {
          const key = `${besoin.site_id}_${besoin.date}_${periode}`;
          
          if (!medecinsBySiteDate.has(key)) {
            medecinsBySiteDate.set(key, []);
          }
          
          if (besoin.medecins) {
            const nomComplet = `${besoin.medecins.first_name} ${besoin.medecins.name}`;
            const existing = medecinsBySiteDate.get(key)!;
            if (!existing.includes(nomComplet)) {
              existing.push(nomComplet);
            }
          }
        }
      }

      // Construire la map des infos de bloc
      const blocInfoById = new Map<string, { operation_nom: string; besoin_nom: string }>();
      
      for (const bloc of planningBloc || []) {
        const operation_nom = bloc.types_intervention?.nom || 'Opération non spécifiée';
        
        // Trouver le besoin opération correspondant
        const besoinOp = besoinsOperations.find(b => b.id === bloc.besoin_effectif_id);
        const besoin_nom = besoinOp?.besoins_operations?.nom || 'Besoin non spécifié';
        
        if (bloc.id) {
          blocInfoById.set(bloc.id, { operation_nom, besoin_nom });
        }
      }

      setEnrichedData({ 
        medecinsByBesoin: medecinsBySiteDate, 
        blocInfoById 
      });

    } catch (error) {
      console.error('Error fetching enriched data:', error);
    } finally {
      setLoadingEnrichment(false);
    }
  };

  // Enrichir les assignments avec les données chargées
  const enrichAssignment = (assignment: Assignment): Assignment => {
    if (!enrichedData) return assignment;

    const enriched = { ...assignment };

    if (assignment.type === 'site') {
      // Récupérer les médecins par site/date/periode
      const key = `${assignment.site_id}_${assignment.date}_${assignment.periode}`;
      const medecins = enrichedData.medecinsByBesoin.get(key) || [];
      enriched.medecins_noms = medecins;
    } else if (assignment.type === 'bloc_operatoire' && assignment.bloc_operation_id) {
      // Récupérer les infos du bloc
      const blocInfo = enrichedData.blocInfoById.get(assignment.bloc_operation_id);
      if (blocInfo) {
        enriched.operation_nom = blocInfo.operation_nom;
        enriched.besoin_nom = blocInfo.besoin_nom;
      }
    }

    return enriched;
  };

  // Group assignments by site/bloc (not by period) for side-by-side display
  const getGroupedAssignments = (beforeAssignments: Assignment[], afterAssignments: Assignment[]) => {
    const grouped = new Map<string, {
      key: string;
      siteNom: string;
      type: string;
      medecins_noms?: string[];
      operation_nom?: string;
      besoin_nom?: string;
      matin: {
        before?: Assignment;
        after?: Assignment;
      };
      apres_midi: {
        before?: Assignment;
        after?: Assignment;
      };
    }>();

    // Process both before and after assignments
    const allAssignments = [
      ...beforeAssignments.map(a => ({ ...a, phase: 'before' as const })),
      ...afterAssignments.map(a => ({ ...a, phase: 'after' as const }))
    ];

    for (const assignment of allAssignments) {
      const key = `${assignment.site_id}_${assignment.type}_${assignment.bloc_operation_id || ''}_${assignment.besoin_operation_id || ''}`;
      
      if (!grouped.has(key)) {
        const enriched = enrichAssignment(assignment);
        grouped.set(key, {
          key,
          siteNom: assignment.site_nom,
          type: assignment.type,
          medecins_noms: enriched.medecins_noms,
          operation_nom: enriched.operation_nom,
          besoin_nom: enriched.besoin_nom,
          matin: {},
          apres_midi: {}
        });
      }

      const group = grouped.get(key)!;
      const periode = assignment.periode as 'matin' | 'apres_midi';
      
      if (assignment.phase === 'before') {
        group[periode].before = enrichAssignment(assignment);
      } else {
        group[periode].after = enrichAssignment(assignment);
      }
    }

    return Array.from(grouped.values());
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
                  {loadingEnrichment ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-4 w-4 animate-spin text-primary mr-2" />
                      <span className="text-sm text-muted-foreground">Chargement des détails...</span>
                    </div>
                  ) : (
                    <>
                      <h3 className="text-sm font-semibold">Comparaison détaillée par site et bloc</h3>
                      
                      {(() => {
                        const grouped = getGroupedAssignments(result.before.assignments, result.after.assignments);
                        
                        return grouped.map(group => {
                          const hasMatinChanges = hasChanges(group.matin.before, group.matin.after);
                          const hasAmChanges = hasChanges(group.apres_midi.before, group.apres_midi.after);
                          const hasAnyChanges = hasMatinChanges || hasAmChanges;

                          return (
                            <div 
                              key={group.key}
                              className={`p-4 rounded-lg border transition-colors ${
                                hasAnyChanges ? 'bg-primary/5 border-primary/30' : 'bg-card'
                              }`}
                            >
                              {/* Site/Bloc Header */}
                              <div className="flex items-center gap-2 mb-3">
                                {group.type === 'bloc_operatoire' ? (
                                  <Scissors className="h-4 w-4 text-muted-foreground" />
                                ) : (
                                  <Building2 className="h-4 w-4 text-muted-foreground" />
                                )}
                                <span className="font-semibold">{group.siteNom}</span>
                                {group.type === 'bloc_operatoire' ? (
                                  <Badge variant="outline" className="text-xs">Bloc</Badge>
                                ) : (
                                  <Badge variant="outline" className="text-xs">Site</Badge>
                                )}
                              </div>

                              {/* Afficher les médecins pour les sites ou l'opération pour les blocs */}
                              {group.type === 'site' && group.medecins_noms && group.medecins_noms.length > 0 && (
                                <div className="mb-3 p-2 bg-muted/30 rounded">
                                  <div className="text-xs text-muted-foreground mb-1">Médecins présents :</div>
                                  <div className="flex flex-wrap gap-1">
                                    {group.medecins_noms.map((nom, idx) => (
                                      <span key={idx} className="text-xs px-2 py-0.5 bg-background rounded">
                                        Dr {nom}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {group.type === 'bloc_operatoire' && (
                                <div className="mb-3 p-2 bg-muted/30 rounded space-y-1">
                                  {group.operation_nom && (
                                    <div className="text-xs">
                                      <span className="text-muted-foreground">Opération : </span>
                                      <span className="font-medium">{group.operation_nom}</span>
                                    </div>
                                  )}
                                  {group.besoin_nom && (
                                    <div className="text-xs">
                                      <span className="text-muted-foreground">Besoin : </span>
                                      <span className="font-medium">{group.besoin_nom}</span>
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Grid 2 colonnes: Matin | Après-midi */}
                              <div className="grid grid-cols-2 gap-4">
                                {/* Colonne Matin */}
                                <div className="space-y-3">
                                  <div className="text-xs font-medium text-center p-1 bg-muted/50 rounded">
                                    🌅 Matin
                                  </div>

                                  {/* Section Avant */}
                                  <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                      <span className="text-xs text-muted-foreground">Avant</span>
                                      {getStatusBadge(group.matin.before)}
                                    </div>
                                    <div className="space-y-1">
                                      {group.matin.before?.secretaires.length ? (
                                        group.matin.before.secretaires.map((s, idx) => {
                                          const isRemoved = hasMatinChanges && !group.matin.after?.secretaires.find(a => a.id === s.id);
                                          return (
                                            <div 
                                              key={idx} 
                                              className={`text-xs px-2 py-1 rounded flex items-center gap-1 ${
                                                isRemoved ? 'bg-destructive/10 text-destructive' : 'bg-muted/50'
                                              }`}
                                            >
                                              {isRemoved && <Minus className="h-3 w-3" />}
                                              <span className={isRemoved ? 'line-through' : ''}>{s.nom}</span>
                                            </div>
                                          );
                                        })
                                      ) : (
                                        <div className="text-xs text-muted-foreground italic px-2">Aucune assignation</div>
                                      )}
                                    </div>
                                  </div>

                                  {/* Section Après */}
                                  <div className="space-y-2 pt-2 border-t">
                                    <div className="flex items-center justify-between">
                                      <span className="text-xs text-muted-foreground">Après</span>
                                      {getStatusBadge(group.matin.after)}
                                    </div>
                                    <div className="space-y-1">
                                      {group.matin.after?.secretaires.length ? (
                                        group.matin.after.secretaires.map((s, idx) => {
                                          const isNew = !group.matin.before?.secretaires.find(b => b.id === s.id);
                                          return (
                                            <div 
                                              key={idx} 
                                              className={`text-xs px-2 py-1 rounded flex items-center gap-1 ${
                                                isNew ? 'bg-green-500/10 text-green-700 font-medium' : 'bg-muted/50'
                                              }`}
                                            >
                                              {isNew && <Plus className="h-3 w-3" />}
                                              <span>{s.nom}</span>
                                            </div>
                                          );
                                        })
                                      ) : (
                                        <div className="text-xs text-muted-foreground italic px-2">Aucune assignation</div>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                {/* Colonne Après-midi */}
                                <div className="space-y-3">
                                  <div className="text-xs font-medium text-center p-1 bg-muted/50 rounded">
                                    ☀️ Après-midi
                                  </div>

                                  {/* Section Avant */}
                                  <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                      <span className="text-xs text-muted-foreground">Avant</span>
                                      {getStatusBadge(group.apres_midi.before)}
                                    </div>
                                    <div className="space-y-1">
                                      {group.apres_midi.before?.secretaires.length ? (
                                        group.apres_midi.before.secretaires.map((s, idx) => {
                                          const isRemoved = hasAmChanges && !group.apres_midi.after?.secretaires.find(a => a.id === s.id);
                                          return (
                                            <div 
                                              key={idx} 
                                              className={`text-xs px-2 py-1 rounded flex items-center gap-1 ${
                                                isRemoved ? 'bg-destructive/10 text-destructive' : 'bg-muted/50'
                                              }`}
                                            >
                                              {isRemoved && <Minus className="h-3 w-3" />}
                                              <span className={isRemoved ? 'line-through' : ''}>{s.nom}</span>
                                            </div>
                                          );
                                        })
                                      ) : (
                                        <div className="text-xs text-muted-foreground italic px-2">Aucune assignation</div>
                                      )}
                                    </div>
                                  </div>

                                  {/* Section Après */}
                                  <div className="space-y-2 pt-2 border-t">
                                    <div className="flex items-center justify-between">
                                      <span className="text-xs text-muted-foreground">Après</span>
                                      {getStatusBadge(group.apres_midi.after)}
                                    </div>
                                    <div className="space-y-1">
                                      {group.apres_midi.after?.secretaires.length ? (
                                        group.apres_midi.after.secretaires.map((s, idx) => {
                                          const isNew = !group.apres_midi.before?.secretaires.find(b => b.id === s.id);
                                          return (
                                            <div 
                                              key={idx} 
                                              className={`text-xs px-2 py-1 rounded flex items-center gap-1 ${
                                                isNew ? 'bg-green-500/10 text-green-700 font-medium' : 'bg-muted/50'
                                              }`}
                                            >
                                              {isNew && <Plus className="h-3 w-3" />}
                                              <span>{s.nom}</span>
                                            </div>
                                          );
                                        })
                                      ) : (
                                        <div className="text-xs text-muted-foreground italic px-2">Aucune assignation</div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        });
                      })()}
                    </>
                  )}
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
