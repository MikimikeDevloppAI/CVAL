import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertCircle, ChevronDown, Loader2, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { OptimizationTestDialog } from './OptimizationTestDialog';
import { DryRunOptimizationDialog } from './DryRunOptimizationDialog';

const BLOC_OPERATOIRE_SITE_ID = '86f1047f-c4ff-441f-a064-42ee2f8ef37a';

interface SecretaireSuggestion {
  secretaire_id: string;
  secretaire_nom: string;
  priorite_site?: 1 | 2 | 3 | 4;
  preference_besoin?: 1 | 2 | 3;
}

interface BesoinPersonnel {
  planning_genere_bloc_id: string;
  besoin_operation_id: string;
  besoin_operation_nom: string;
  medecin_nom: string;
  type_intervention_nom: string;
  nombre_requis: number;
  deficit: number;
}

interface PeriodNeed {
  date: string;
  periode: 'matin' | 'apres_midi';
  site_id: string;
  site_nom: string;
  besoin_operation_id?: string;
  besoin_operation_nom?: string;
  medecin_nom?: string;
  type_intervention_nom?: string;
  manque: number;
  suggestions_admin: SecretaireSuggestion[];
  suggestions_not_working: SecretaireSuggestion[];
}

interface UnfilledNeedsPanelProps {
  startDate: string;
  endDate: string;
  onRefresh?: () => void;
  isOpen?: boolean;
}

export const UnfilledNeedsPanel = ({ startDate, endDate, onRefresh, isOpen: initialIsOpen = false }: UnfilledNeedsPanelProps) => {
  const [periodNeeds, setPeriodNeeds] = useState<PeriodNeed[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(initialIsOpen);
  const [assigningKey, setAssigningKey] = useState<string | null>(null);
  const [selectedSecretaire, setSelectedSecretaire] = useState<Record<string, string>>({});
  const [loadingSuggestions, setLoadingSuggestions] = useState<Set<string>>(new Set());
  const [testResult, setTestResult] = useState<any>(null);
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [testedDate, setTestedDate] = useState<string>('');
  const [dryRunResult, setDryRunResult] = useState<any>(null);
  const [dryRunDialogOpen, setDryRunDialogOpen] = useState(false);
  const [dryRunLoading, setDryRunLoading] = useState(false);
  const [dryRunDate, setDryRunDate] = useState<string>('');

  useEffect(() => {
    // Fetch data when date range changes, regardless of isOpen state
    fetchUnfilledNeeds();
  }, [startDate, endDate]);

  useEffect(() => {
    // Open automatically when there are unfilled needs
    if (totalCount > 0 && !isOpen) {
      setIsOpen(true);
    }
  }, [totalCount]);

  const fetchUnfilledNeeds = async () => {
    try {
      setLoading(true);
      const needs: PeriodNeed[] = [];

      // Fetch sites needs
      const { data: siteNeeds, error: siteError } = await supabase
        .from('besoins_sites_summary')
        .select('*')
        .gte('date', startDate)
        .lte('date', endDate)
        .gt('deficit', 0)
        .order('date', { ascending: true });

      if (siteError) throw siteError;

      // Convert site needs to period needs
      for (const need of siteNeeds || []) {
        needs.push({
          date: need.date!,
          periode: need.demi_journee as 'matin' | 'apres_midi',
          site_id: need.site_id!,
          site_nom: need.site_nom!,
          manque: need.deficit!,
          suggestions_admin: [],
          suggestions_not_working: []
        });
      }

      // Fetch bloc operatoire needs
      const { data: blocNeeds, error: blocError } = await supabase
        .from('besoins_bloc_operatoire_summary')
        .select('*')
        .gte('date', startDate)
        .lte('date', endDate)
        .gt('deficit', 0)
        .order('date', { ascending: true });

      if (blocError) throw blocError;

      // Convert bloc needs to period needs
      for (const need of blocNeeds || []) {
        needs.push({
          date: need.date!,
          periode: need.demi_journee as 'matin' | 'apres_midi',
          site_id: BLOC_OPERATOIRE_SITE_ID,
          site_nom: 'Opération',
          besoin_operation_id: need.besoin_operation_id!,
          besoin_operation_nom: need.besoin_operation_nom!,
          medecin_nom: need.medecin_nom!,
          type_intervention_nom: need.type_intervention_nom!,
          manque: need.deficit!,
          suggestions_admin: [],
          suggestions_not_working: []
        });
      }

      // Sort by date and period
      needs.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        if (a.periode !== b.periode) return a.periode === 'matin' ? -1 : 1;
        return a.site_nom.localeCompare(b.site_nom);
      });

      setPeriodNeeds(needs);
      setTotalCount(needs.length);
    } catch (error) {
      console.error('Error fetching unfilled needs:', error);
      toast.error('Erreur lors du chargement des besoins non remplis');
    } finally {
      setLoading(false);
    }
  };

  const loadSuggestions = async (need: PeriodNeed) => {
    const key = `${need.date}-${need.periode}-${need.site_id}-${need.besoin_operation_id || 'site'}`;
    
    if (loadingSuggestions.has(key)) return;
    
    setLoadingSuggestions(prev => new Set(prev).add(key));

    try {
      const admin: SecretaireSuggestion[] = [];
      const notWorking: SecretaireSuggestion[] = [];

      // Get already assigned secretaires for this period
      const { data: alreadyAssigned } = await supabase
        .from('capacite_effective')
        .select('secretaire_id')
        .eq('date', need.date)
        .eq('demi_journee', need.periode)
        .eq('actif', true);

      const assignedIds = new Set(alreadyAssigned?.map(a => a.secretaire_id) || []);

      if (need.besoin_operation_id) {
        // Bloc operatoire - filter by competency
        const { data: secretaires } = await supabase
          .from('secretaires')
          .select(`
            id, first_name, name,
            secretaires_besoins_operations!inner(besoin_operation_id, preference)
          `)
          .eq('actif', true)
          .eq('secretaires_besoins_operations.besoin_operation_id', need.besoin_operation_id);

        for (const sec of secretaires || []) {
          const preference = (sec as any).secretaires_besoins_operations?.[0]?.preference;
          const suggestion: SecretaireSuggestion = {
            secretaire_id: sec.id,
            secretaire_nom: `${sec.first_name} ${sec.name}`.trim(),
            preference_besoin: preference
          };

          if (assignedIds.has(sec.id)) {
            // Check if assigned to admin
            const { data: adminAssignment } = await supabase
              .from('capacite_effective')
              .select('site_id')
              .eq('secretaire_id', sec.id)
              .eq('date', need.date)
              .eq('demi_journee', need.periode)
              .eq('site_id', '00000000-0000-0000-0000-000000000001')
              .single();

            if (adminAssignment) {
              admin.push(suggestion);
            }
          } else {
            notWorking.push(suggestion);
          }
        }
      } else {
        // Site need - filter by site preference or admin
        const { data: secretaires } = await supabase
          .from('secretaires')
          .select(`
            id, first_name, name,
            secretaires_sites(site_id, priorite)
          `)
          .eq('actif', true);

        for (const sec of secretaires || []) {
          const sites = (sec as any).secretaires_sites || [];
          const siteLink = sites.find((s: any) => s.site_id === need.site_id);
          const hasAdminSite = need.site_id === '00000000-0000-0000-0000-000000000001';

          // Include if has site preference OR if site is admin (everyone can work admin)
          if (siteLink || hasAdminSite) {
            const suggestion: SecretaireSuggestion = {
              secretaire_id: sec.id,
              secretaire_nom: `${sec.first_name} ${sec.name}`.trim(),
              priorite_site: siteLink?.priorite
            };

            if (assignedIds.has(sec.id)) {
              const { data: adminAssignment } = await supabase
                .from('capacite_effective')
                .select('site_id')
                .eq('secretaire_id', sec.id)
                .eq('date', need.date)
                .eq('demi_journee', need.periode)
                .eq('site_id', '00000000-0000-0000-0000-000000000001')
                .single();

              if (adminAssignment) {
                admin.push(suggestion);
              }
            } else {
              notWorking.push(suggestion);
            }
          }
        }
      }

      // Update the need with suggestions
      setPeriodNeeds(prev =>
        prev.map(n =>
          `${n.date}-${n.periode}-${n.site_id}-${n.besoin_operation_id || 'site'}` === key
            ? { ...n, suggestions_admin: admin, suggestions_not_working: notWorking }
            : n
        )
      );
    } catch (error) {
      console.error('Error loading suggestions:', error);
      toast.error('Erreur lors du chargement des suggestions');
    } finally {
      setLoadingSuggestions(prev => {
        const newSet = new Set(prev);
        newSet.delete(key);
        return newSet;
      });
    }
  };

  const handleAssign = async (need: PeriodNeed) => {
    const key = `${need.date}-${need.periode}-${need.site_id}-${need.besoin_operation_id || 'site'}`;
    const secretaireId = selectedSecretaire[key];

    if (!secretaireId) {
      toast.error('Veuillez sélectionner un assistant médical');
      return;
    }

    setAssigningKey(key);

    try {
      // Check if secretaire already has a capacity for this period
      const { data: existingCapacity } = await supabase
        .from('capacite_effective')
        .select('id, site_id')
        .eq('secretaire_id', secretaireId)
        .eq('date', need.date)
        .eq('demi_journee', need.periode)
        .eq('actif', true)
        .maybeSingle();

      if (existingCapacity) {
        // Update existing capacity
        const { error: updateError } = await supabase
          .from('capacite_effective')
          .update({
            site_id: need.site_id,
            besoin_operation_id: need.besoin_operation_id || null
          })
          .eq('id', existingCapacity.id);

        if (updateError) throw updateError;
      } else {
        // Create new capacity
        const { error: insertError } = await supabase
          .from('capacite_effective')
          .insert({
            secretaire_id: secretaireId,
            date: need.date,
            demi_journee: need.periode,
            site_id: need.site_id,
            besoin_operation_id: need.besoin_operation_id || null,
            actif: true
          });

        if (insertError) throw insertError;
      }

      toast.success('Assistant médical assigné avec succès');
      setSelectedSecretaire(prev => {
        const newState = { ...prev };
        delete newState[key];
        return newState;
      });
      
      fetchUnfilledNeeds();
      onRefresh?.();
    } catch (error) {
      console.error('Error assigning secretaire:', error);
      toast.error("Erreur lors de l'assignation");
    } finally {
      setAssigningKey(null);
    }
  };

  const handleDryRunOptimization = async (date: string) => {
    setDryRunLoading(true);
    setDryRunDate(date);
    
    try {
      const { data, error } = await supabase.functions.invoke('optimize-planning-dry-run', {
        body: { date }
      });

      if (error) throw error;

      setDryRunResult(data);
      setDryRunDialogOpen(true);
    } catch (error) {
      console.error('Error running dry run optimization:', error);
      toast.error("Erreur lors de l'optimisation test");
    } finally {
      setDryRunLoading(false);
    }
  };

  // Group needs by date
  const needsByDate = periodNeeds.reduce((acc, need) => {
    if (!acc[need.date]) {
      acc[need.date] = [];
    }
    acc[need.date].push(need);
    return acc;
  }, {} as Record<string, PeriodNeed[]>);

  if (!isOpen) return null;

  return (
    <>
      <Card className="rounded-xl overflow-hidden bg-card/50 backdrop-blur-xl border border-border/50 shadow-lg mb-6">
        <div className="flex items-center justify-between p-4 bg-gradient-to-r from-primary/5 to-transparent border-b border-border/50">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-primary" />
            <h3 className="text-base font-semibold">Besoins non satisfaits</h3>
            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
              {totalCount}
            </Badge>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsOpen(false)}
            className="h-8 w-8 p-0"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="p-4">
          {loading ? (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(needsByDate).map(([date, needs]) => (
                <div key={date} className="space-y-2">
                  <div className="flex items-center justify-between bg-gradient-to-r from-primary/5 to-transparent p-2 rounded-lg border border-primary/10">
                    <div className="text-sm font-semibold">
                      {format(new Date(date), 'EEEE dd MMMM yyyy', { locale: fr })}
                    </div>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => handleDryRunOptimization(date)}
                      disabled={dryRunLoading && dryRunDate === date}
                      className="gap-2 h-8 text-xs"
                    >
                      {dryRunLoading && dryRunDate === date ? (
                        <>
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Analyse...
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-3 w-3" />
                          Optimiser
                        </>
                      )}
                    </Button>
                  </div>

                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead className="w-[100px]">Période</TableHead>
                          <TableHead className="w-[200px]">Site</TableHead>
                          <TableHead className="w-[250px]">Besoin</TableHead>
                          <TableHead className="w-[80px] text-center">Manque</TableHead>
                          <TableHead className="w-[300px]">Assigner</TableHead>
                          <TableHead className="w-[100px]"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {needs.map(need => {
                          const key = `${need.date}-${need.periode}-${need.site_id}-${need.besoin_operation_id || 'site'}`;
                          const isAssigning = assigningKey === key;
                          
                          return (
                            <TableRow key={key}>
                              <TableCell className="text-sm">
                                {need.periode === 'matin' ? 'Matin' : 'Après-midi'}
                              </TableCell>
                              <TableCell className="font-medium text-sm">
                                {need.site_nom}
                              </TableCell>
                              <TableCell className="text-sm">
                                {need.besoin_operation_nom ? (
                                  <div className="space-y-0.5">
                                    <div className="font-medium">{need.medecin_nom}</div>
                                    <div className="text-xs text-muted-foreground">
                                      {need.type_intervention_nom} • {need.besoin_operation_nom}
                                    </div>
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground">-</span>
                                )}
                              </TableCell>
                              <TableCell className="text-center">
                                <Badge variant="destructive" className="text-xs">
                                  {need.manque}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Select
                                  value={selectedSecretaire[key] || ""}
                                  onValueChange={(value) => {
                                    setSelectedSecretaire(prev => ({ ...prev, [key]: value }));
                                  }}
                                  onOpenChange={(open) => {
                                    if (open && need.suggestions_admin.length === 0 && need.suggestions_not_working.length === 0) {
                                      loadSuggestions(need);
                                    }
                                  }}
                                >
                                  <SelectTrigger className="h-8 text-xs">
                                    <SelectValue placeholder="Sélectionner..." />
                                  </SelectTrigger>
                                  <SelectContent className="max-h-[300px]">
                                    {loadingSuggestions.has(key) ? (
                                      <div className="flex items-center justify-center p-4">
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      </div>
                                    ) : (
                                      <>
                                        {need.suggestions_admin.length > 0 && (
                                          <>
                                            <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground bg-muted/50">
                                              ✓ En administratif
                                            </div>
                                            {need.suggestions_admin.map(sug => (
                                              <SelectItem key={sug.secretaire_id} value={sug.secretaire_id}>
                                                {sug.secretaire_nom}
                                              </SelectItem>
                                            ))}
                                          </>
                                        )}
                                        {need.suggestions_not_working.length > 0 && (
                                          <>
                                            <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground bg-muted/50 mt-1">
                                              + Créer créneau
                                            </div>
                                            {need.suggestions_not_working.map(sug => (
                                              <SelectItem key={sug.secretaire_id} value={sug.secretaire_id}>
                                                <span className="text-muted-foreground">{sug.secretaire_nom}</span>
                                              </SelectItem>
                                            ))}
                                          </>
                                        )}
                                      </>
                                    )}
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell>
                                {selectedSecretaire[key] && (
                                  <Button
                                    size="sm"
                                    onClick={() => handleAssign(need)}
                                    disabled={isAssigning}
                                    className="h-8 text-xs"
                                  >
                                    {isAssigning ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      'Assigner'
                                    )}
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      <OptimizationTestDialog
        open={testDialogOpen}
        onOpenChange={setTestDialogOpen}
        date={testedDate}
        result={testResult}
      />

      <DryRunOptimizationDialog
        open={dryRunDialogOpen}
        onOpenChange={setDryRunDialogOpen}
        date={dryRunDate}
        result={dryRunResult}
        isLoading={dryRunLoading}
        onApply={() => {
          fetchUnfilledNeeds();
          onRefresh?.();
        }}
      />
    </>
  );
};
