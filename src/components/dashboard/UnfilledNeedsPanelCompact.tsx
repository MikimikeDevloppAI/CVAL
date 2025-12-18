import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertCircle, CheckCircle, ChevronDown, ChevronUp, Loader2, Sparkles, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { OptimizationTestDialog } from './OptimizationTestDialog';
import { MultiDateDryRunDialog } from './MultiDateDryRunDialog';
import { refreshBesoinsViews } from '@/lib/refreshBesoins';

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
  planning_genere_bloc_operatoire_id?: string;
  manque: number;
  deficit_1r?: number;
  deficit_2f3f?: number;
  is_fermeture?: boolean;
  fermeture_type?: '1r' | '2f' | '3f';
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
  const [refreshingViews, setRefreshingViews] = useState(false);

  useEffect(() => {
    // Fetch data when date range changes, regardless of isOpen state
    fetchUnfilledNeeds();
  }, [startDate, endDate]);

  // Panel stays collapsed by default

  const fetchUnfilledNeeds = async () => {
    try {
      setLoading(true);
      
      // Une seule requête à la vue unifiée
      const { data: unifiedNeeds, error } = await supabase
        .from('besoins_unified_summary')
        .select('*')
        .gte('date', startDate)
        .lte('date', endDate)
        .eq('statut', 'DEFICIT')
        .order('date', { ascending: true });

      if (error) throw error;

      const needs: PeriodNeed[] = [];

      for (const need of unifiedNeeds || []) {
        if (need.type_besoin === 'site') {
          needs.push({
            date: need.date!,
            periode: need.demi_journee as 'matin' | 'apres_midi',
            site_id: need.site_id!,
            site_nom: need.site_nom!,
            manque: Math.abs(need.balance!),
            suggestions_admin: [],
            suggestions_not_working: []
          });
        } else if (need.type_besoin === 'bloc') {
          needs.push({
            date: need.date!,
            periode: need.demi_journee as 'matin' | 'apres_midi',
            site_id: BLOC_OPERATOIRE_SITE_ID,
            site_nom: 'Opération',
            besoin_operation_id: need.besoin_operation_id!,
            besoin_operation_nom: need.besoin_operation_nom!,
            medecin_nom: need.medecin_nom!,
            type_intervention_nom: need.type_intervention_nom!,
            planning_genere_bloc_operatoire_id: need.planning_bloc_id!,
            manque: Math.abs(need.balance!),
            suggestions_admin: [],
            suggestions_not_working: []
          });
        } else if (need.type_besoin === 'fermeture_1r') {
          needs.push({
            date: need.date!,
            periode: 'matin',
            site_id: need.site_id!,
            site_nom: need.site_nom!.replace(' (1R)', ''),
            manque: Math.abs(need.balance!),
            deficit_1r: Math.abs(need.balance!),
            is_fermeture: true,
            fermeture_type: '1r',
            suggestions_admin: [],
            suggestions_not_working: []
          });
        } else if (need.type_besoin === 'fermeture_2f') {
          needs.push({
            date: need.date!,
            periode: 'apres_midi',
            site_id: need.site_id!,
            site_nom: need.site_nom!.replace(' (2F)', ''),
            manque: Math.abs(need.balance!),
            deficit_2f3f: Math.abs(need.balance!),
            is_fermeture: true,
            fermeture_type: '2f',
            suggestions_admin: [],
            suggestions_not_working: []
          });
        }
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

      // Gestion spéciale pour les besoins de fermeture
      if (need.is_fermeture && need.fermeture_type) {
        // Récupérer UNIQUEMENT les secrétaires déjà assignés sur CE site pour cette date/période
        const { data: capacites } = await supabase
          .from('capacite_effective')
          .select(`
            id,
            secretaire_id,
            is_1r,
            is_2f,
            is_3f,
            secretaires!inner(id, first_name, name, actif)
          `)
          .eq('date', need.date)
          .eq('demi_journee', need.periode)
          .eq('site_id', need.site_id)
          .eq('actif', true);
        
        for (const cap of capacites || []) {
          const sec = (cap as any).secretaires;
          if (!sec || !sec.actif) continue;
          
          // Vérifier si la personne a déjà cette responsabilité
          const hasResponsibility = 
            (need.fermeture_type === '1r' && cap.is_1r) ||
            (need.fermeture_type === '2f' && cap.is_2f) ||
            (need.fermeture_type === '3f' && cap.is_3f);
          
          // Ne pas afficher ceux qui ont déjà la responsabilité demandée
          if (hasResponsibility) continue;
          
          const suggestion: SecretaireSuggestion = {
            secretaire_id: sec.id,
            secretaire_nom: `${sec.first_name} ${sec.name}`.trim()
          };
          
          admin.push(suggestion);
        }
      } else if (need.besoin_operation_id) {
        // Get already assigned secretaires for this period
        const { data: alreadyAssigned } = await supabase
          .from('capacite_effective')
          .select('secretaire_id')
          .eq('date', need.date)
          .eq('demi_journee', need.periode)
          .eq('actif', true);

        const assignedIds = new Set(alreadyAssigned?.map(a => a.secretaire_id) || []);
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
        // Get already assigned secretaires for this period
        const { data: alreadyAssigned } = await supabase
          .from('capacite_effective')
          .select('secretaire_id')
          .eq('date', need.date)
          .eq('demi_journee', need.periode)
          .eq('actif', true);

        const assignedIds = new Set(alreadyAssigned?.map(a => a.secretaire_id) || []);

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
      // Gestion spéciale pour les besoins de fermeture
      if (need.is_fermeture && need.fermeture_type) {
        // Trouver toutes les capacités existantes pour ce secrétaire sur ce site/date
        const { data: existingCapacities } = await supabase
          .from('capacite_effective')
          .select('id, demi_journee, is_1r, is_2f, is_3f')
          .eq('secretaire_id', secretaireId)
          .eq('date', need.date)
          .eq('site_id', need.site_id)
          .eq('actif', true);

        if (!existingCapacities || existingCapacities.length === 0) {
          throw new Error('Aucune capacité trouvée pour cet assistant médical sur ce site');
        }

        // Mettre à jour la responsabilité sur toutes les demi-journées où la personne est présente
        for (const cap of existingCapacities) {
          const updateData: any = {
            // On s'assure qu'une seule responsabilité est active
            is_1r: false,
            is_2f: false,
            is_3f: false,
          };

          if (need.fermeture_type === '1r') updateData.is_1r = true;
          if (need.fermeture_type === '2f') updateData.is_2f = true;
          if (need.fermeture_type === '3f') updateData.is_3f = true;

          const { error: updateError } = await supabase
            .from('capacite_effective')
            .update(updateData)
            .eq('id', cap.id);

          if (updateError) throw updateError;
        }

        toast.success(`Responsabilité ${need.fermeture_type.toUpperCase()} assignée avec succès`);
      } else {
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
              besoin_operation_id: need.besoin_operation_id || null,
              planning_genere_bloc_operatoire_id: need.planning_genere_bloc_operatoire_id || null
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
              planning_genere_bloc_operatoire_id: need.planning_genere_bloc_operatoire_id || null,
              actif: true
            });

          if (insertError) throw insertError;
        }

        toast.success('Assistant médical assigné avec succès');
      }
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

  const handleDryRunOptimization = async () => {
    setDryRunLoading(true);
    
    try {
      // Generate full week (Monday to Saturday) from startDate to endDate
      const start = new Date(startDate);
      const end = new Date(endDate);
      const allDates: string[] = [];
      
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dayOfWeek = d.getDay();
        // Include Monday (1) to Saturday (6), exclude Sunday (0)
        if (dayOfWeek >= 1 && dayOfWeek <= 6) {
          allDates.push(d.toISOString().split('T')[0]);
        }
      }

      if (allDates.length === 0) {
        toast.info('Aucune date à optimiser dans la période sélectionnée');
        setDryRunLoading(false);
        return;
      }

      console.log('📤 Optimisation de la semaine complète:', allDates);

      // 1. Call Python API
      const { data, error } = await supabase.functions.invoke('optimize-planning-python', {
        body: { 
          dates: allDates,
          minimize_changes: true,
          flexible_overrides: {}
        }
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erreur inconnue');

      console.log('✅ Optimisation terminée, récupération des changements...');

      // 2. Fetch proposed changes from dry_run table (SANS jointures)
      const { data: dryRunChanges, error: dryRunError } = await supabase
        .from('capacite_effective_dry_run')
        .select('*')
        .in('date', allDates);

      if (dryRunError) throw dryRunError;

      // 3. Fetch "before" states from capacite_effective AVEC jointures
      const capaciteIds = dryRunChanges
        ?.map(c => c.capacite_effective_id)
        .filter(Boolean) || [];
      
      const { data: beforeData } = await supabase
        .from('capacite_effective')
        .select(`
          *,
          secretaire:secretaires(id, first_name, name),
          site:sites(id, nom),
          besoin_operation:besoins_operations(id, nom)
        `)
        .in('id', capaciteIds);

      const beforeMap = new Map(beforeData?.map(b => [b.id, b]) || []);

      // 4. Récupérer les sites pour l'état "after"
      const afterSiteIds = [...new Set(dryRunChanges?.map(c => c.site_id).filter(Boolean))];
      const { data: sitesData } = await supabase
        .from('sites')
        .select('id, nom')
        .in('id', afterSiteIds);

      const sitesMap = new Map(sitesData?.map(s => [s.id, s]) || []);

      // 5. Build IndividualChange objects by date
      const changesByDate = new Map<string, any[]>();
      
      dryRunChanges?.forEach((change: any) => {
        const before = beforeMap.get(change.capacite_effective_id);
        const afterSite = sitesMap.get(change.site_id);
        
        const individualChange = {
          date: change.date,
          secretaire_id: change.secretaire_id,
          // Utiliser les infos du secrétaire depuis "before"
          secretaire_nom: `${before?.secretaire?.first_name || ''} ${before?.secretaire?.name || ''}`.trim(),
          periode: change.demi_journee,
          before: before ? {
            site_id: before.site_id,
            site_nom: before.site?.nom || 'Inconnu',
            type: before.besoin_operation_id ? 'operation' : 'site',
            besoin_operation_id: before.besoin_operation_id,
            besoin_operation_nom: before.besoin_operation?.nom,
            is_1r: before.is_1r,
            is_2f: before.is_2f,
            is_3f: before.is_3f
          } : null,
          after: {
            site_id: change.site_id,
            site_nom: afterSite?.nom || 'Inconnu',
            type: change.besoin_operation_id ? 'operation' : 'site',
            besoin_operation_id: change.besoin_operation_id,
            besoin_operation_nom: change.besoin_operation?.nom,
            is_1r: change.is_1r,
            is_2f: change.is_2f,
            is_3f: change.is_3f
          }
        };

        if (!changesByDate.has(change.date)) {
          changesByDate.set(change.date, []);
        }
        changesByDate.get(change.date)!.push(individualChange);
      });

      // 5. Format result for dialog
      const results = allDates.map(date => ({
        success: true,
        message: '',
        date,
        before: { total_unmet: 0, assignments_count: 0 },
        after: { total_unmet: 0, assignments_count: 0 },
        improvement: { unmet_diff: 0, assignment_changes: 0, score_improvement: 0 },
        individual_changes: changesByDate.get(date) || []
      }));

      const combinedResult = {
        success: true,
        dates: allDates,
        results,
        totalImprovements: dryRunChanges?.length || 0
      };

      console.log('📊 Changements préparés:', combinedResult.totalImprovements);

      // 6. Open dialog with results
      setDryRunResult(combinedResult);
      setDryRunDialogOpen(true);

    } catch (error) {
      console.error('Error running dry run optimization:', error);
      toast.error("Erreur lors de l'optimisation test");
    } finally {
      setDryRunLoading(false);
    }
  };

  const handleRefreshViews = async () => {
    setRefreshingViews(true);
    try {
      await refreshBesoinsViews();
      toast.success('Vues matérialisées rafraîchies avec succès');
      await fetchUnfilledNeeds();
      onRefresh?.();
    } catch (error) {
      console.error('Error refreshing views:', error);
      toast.error('Erreur lors du rafraîchissement des vues');
    } finally {
      setRefreshingViews(false);
    }
  };

  // Always show the panel, even when all needs are satisfied

  return (
    <>
      <Card className="rounded-xl overflow-hidden bg-card/50 backdrop-blur-xl border border-border/50 mb-6">
        <div className={`flex items-center justify-between p-4 border-b border-border/50 ${
          totalCount > 0 
            ? 'bg-gradient-to-r from-primary/5 to-transparent' 
            : 'bg-gradient-to-r from-green-500/5 to-transparent'
        }`}>
          <div className="flex items-center gap-3">
            {totalCount > 0 ? (
              <>
                <AlertCircle className="h-5 w-5 text-primary" />
                <h3 className="text-base font-semibold">Besoins non satisfaits</h3>
                <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
                  {totalCount}
                </Badge>
              </>
            ) : (
              <>
                <CheckCircle className="h-5 w-5 text-green-600" />
                <h3 className="text-base font-semibold text-green-600">Tous les besoins sont satisfaits</h3>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="default"
              size="sm"
              onClick={handleDryRunOptimization}
              disabled={dryRunLoading}
              className="gap-2 h-8 text-xs"
            >
              {dryRunLoading ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Optimisation...
                </>
              ) : (
                <>
                  <Sparkles className="h-3 w-3" />
                  Optimiser la semaine
                </>
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsOpen(!isOpen)}
              className="h-8 w-8 p-0"
            >
              {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {isOpen && (
          <div className="p-4">
            {loading ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : periodNeeds.length === 0 ? (
              <div className="text-center p-8 text-muted-foreground">
                Aucun besoin non satisfait pour cette période
              </div>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="w-[150px]">Jour</TableHead>
                      <TableHead className="w-[100px]">Période</TableHead>
                      <TableHead className="w-[200px]">Site</TableHead>
                      <TableHead className="w-[250px]">Besoin</TableHead>
                      <TableHead className="w-[80px] text-center">Manque</TableHead>
                      <TableHead className="w-[300px]">Assigner</TableHead>
                      <TableHead className="w-[100px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {periodNeeds.map(need => {
                      const key = `${need.date}-${need.periode}-${need.site_id}-${need.besoin_operation_id || 'site'}`;
                      const isAssigning = assigningKey === key;
                      
                      return (
                        <TableRow key={key}>
                          <TableCell className="text-sm">
                            {format(new Date(need.date), 'EEE dd MMM', { locale: fr })}
                          </TableCell>
                          <TableCell className="text-sm">
                            {need.is_fermeture ? 'Toute la journée' : need.periode === 'matin' ? 'Matin' : 'Après-midi'}
                          </TableCell>
                          <TableCell className="font-medium text-sm">
                            {need.site_nom}
                          </TableCell>
                          <TableCell className="text-sm">
                            {need.is_fermeture ? (
                              <div className="font-medium">
                                {need.deficit_1r && need.deficit_1r > 0 ? (
                                  <Badge variant="outline" className="bg-orange-500/10 text-orange-600 border-orange-500/20">
                                    Responsable fermeture (1R)
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="bg-purple-500/10 text-purple-600 border-purple-500/20">
                                    Fermeture 2F/3F
                                  </Badge>
                                )}
                              </div>
                            ) : need.besoin_operation_nom ? (
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
                                          {need.is_fermeture ? '✓ Présent sur le site' : '✓ En administratif'}
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
            )}
          </div>
        )}
      </Card>

      <OptimizationTestDialog
        open={testDialogOpen}
        onOpenChange={setTestDialogOpen}
        date={testedDate}
        result={testResult}
      />

      <MultiDateDryRunDialog
        open={dryRunDialogOpen}
        onOpenChange={setDryRunDialogOpen}
        result={dryRunResult}
        isLoading={dryRunLoading}
        onRefresh={() => {
          fetchUnfilledNeeds();
          onRefresh?.();
        }}
      />
    </>
  );
};
