import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, ChevronDown, UserPlus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface SecretaireSuggestion {
  secretaire_id: string;
  secretaire_nom: string;
  raison: 'admin_disponible' | 'competence_site' | 'competence_besoin';
  priorite_site?: 1 | 2 | 3;
  preference_besoin?: 1 | 2 | 3;
  est_en_admin_ce_jour?: boolean;
}

interface UnfilledNeed {
  date: string;
  periode: 'matin' | 'apres_midi';
  site_id: string;
  site_nom: string;
  besoin_operation_id?: string;
  besoin_operation_nom?: string;
  manque: number;
  suggestions: SecretaireSuggestion[];
}

interface UnfilledNeedsPanelProps {
  startDate: string;
  endDate: string;
  onRefresh?: () => void;
}

export const UnfilledNeedsPanel = ({ startDate, endDate, onRefresh }: UnfilledNeedsPanelProps) => {
  const [unfilledNeeds, setUnfilledNeeds] = useState<UnfilledNeed[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [assigningId, setAssigningId] = useState<string | null>(null);

  const fetchUnfilledNeeds = async () => {
    setLoading(true);
    try {
      const needs: UnfilledNeed[] = [];

      // Fetch all sites (excluding bloc opératoire and admin)
      const { data: sites } = await supabase
        .from('sites')
        .select('id, nom')
        .eq('actif', true)
        .not('nom', 'eq', 'Clinique La Vallée - Bloc opératoire')
        .not('id', 'eq', '00000000-0000-0000-0000-000000000001');

      if (!sites) return;

      // 1. Check regular sites needs
      for (const site of sites) {
        for (const periode of ['matin', 'apres_midi'] as const) {
          // Get besoins effectifs grouped by date
          const { data: besoins } = await supabase
            .from('besoin_effectif')
            .select('date, medecins(besoin_secretaires)')
            .eq('site_id', site.id)
            .eq('type', 'medecin')
            .eq('demi_journee', periode)
            .gte('date', startDate)
            .lte('date', endDate);

          // Group by date and sum besoins
          const besoinsByDate = new Map<string, number>();
          besoins?.forEach((b: any) => {
            const besoin = b.medecins?.besoin_secretaires || 1.2;
            besoinsByDate.set(b.date, (besoinsByDate.get(b.date) || 0) + besoin);
          });

          // Check capacite for each date with besoins
          for (const [date, totalBesoin] of besoinsByDate.entries()) {
            const { data: capacite } = await supabase
              .from('capacite_effective')
              .select('secretaire_id')
              .eq('site_id', site.id)
              .eq('date', date)
              .eq('demi_journee', periode)
              .eq('actif', true);

            const assigned = capacite?.length || 0;
            const needed = Math.ceil(totalBesoin);

            if (assigned < needed) {
              const suggestions = await generateSuggestions(date, periode, site.id, undefined);
              needs.push({
                date,
                periode,
                site_id: site.id,
                site_nom: site.nom,
                manque: needed - assigned,
                suggestions
              });
            }
          }
        }
      }

      // 2. Check bloc opératoire needs
      const { data: blocNeeds } = await supabase
        .from('besoin_effectif')
        .select(`
          date,
          demi_journee,
          type_intervention_id,
          types_intervention(nom),
          id
        `)
        .eq('type', 'bloc_operatoire')
        .gte('date', startDate)
        .lte('date', endDate)
        .not('type_intervention_id', 'is', null);

      for (const besoin of blocNeeds || []) {
        // Get required personnel for this intervention type
        const { data: besoinsPersonnel } = await supabase
          .from('types_intervention_besoins_personnel')
          .select('besoin_operation_id, nombre_requis, besoins_operations(nom)')
          .eq('type_intervention_id', besoin.type_intervention_id)
          .eq('actif', true);

        for (const bp of besoinsPersonnel || []) {
          // Count assigned secretaries for this besoin
          const { data: assignedCapacite } = await supabase
            .from('capacite_effective')
            .select('secretaire_id')
            .eq('besoin_operation_id', bp.besoin_operation_id)
            .eq('date', besoin.date)
            .eq('demi_journee', besoin.demi_journee)
            .eq('actif', true);

          const assigned = assignedCapacite?.length || 0;
          const needed = bp.nombre_requis;

          if (assigned < needed) {
            // Get bloc site
            const { data: blocSite } = await supabase
              .from('sites')
              .select('id, nom')
              .eq('nom', 'Clinique La Vallée - Bloc opératoire')
              .single();

            const suggestions = await generateSuggestions(
              besoin.date,
              besoin.demi_journee as 'matin' | 'apres_midi',
              blocSite?.id || '',
              bp.besoin_operation_id
            );

            needs.push({
              date: besoin.date,
              periode: besoin.demi_journee as 'matin' | 'apres_midi',
              site_id: blocSite?.id || '',
              site_nom: `Bloc opératoire - ${besoin.types_intervention?.nom || ''}`,
              besoin_operation_id: bp.besoin_operation_id,
              besoin_operation_nom: (bp.besoins_operations as any)?.nom,
              manque: needed - assigned,
              suggestions
            });
          }
        }
      }

      setUnfilledNeeds(needs);
    } catch (error) {
      console.error('Error fetching unfilled needs:', error);
      toast.error('Erreur lors du chargement des besoins non remplis');
    } finally {
      setLoading(false);
    }
  };

  const generateSuggestions = async (
    date: string,
    periode: 'matin' | 'apres_midi',
    siteId: string,
    besoinOperationId?: string
  ): Promise<SecretaireSuggestion[]> => {
    const suggestions: SecretaireSuggestion[] = [];

    try {
      // Get secretaries already assigned this day/period
      const { data: alreadyAssigned } = await supabase
        .from('capacite_effective')
        .select('secretaire_id')
        .eq('date', date)
        .eq('demi_journee', periode)
        .eq('actif', true);

      const assignedIds = alreadyAssigned?.map(a => a.secretaire_id) || [];

      if (besoinOperationId) {
        // BLOC OPERATOIRE: Priority to admin with besoin competence
        const { data: adminSecretaires } = await supabase
          .from('capacite_effective')
          .select(`
            secretaire_id,
            secretaires(id, first_name, name),
            secretaires_besoins_operations:secretaires!inner(
              secretaires_besoins_operations(
                besoin_operation_id,
                preference
              )
            )
          `)
          .eq('date', date)
          .eq('demi_journee', periode)
          .eq('site_id', '00000000-0000-0000-0000-000000000001')
          .eq('actif', true)
          .not('secretaire_id', 'in', `(${assignedIds.length > 0 ? assignedIds.join(',') : 'NULL'})`);

        // Filter admin secretaries with the right besoin competence
        const adminWithCompetence = adminSecretaires?.filter((as: any) => {
          const besoins = as.secretaires?.secretaires_besoins_operations || [];
          return besoins.some((b: any) => b.besoin_operation_id === besoinOperationId);
        });

        // Add admin suggestions
        adminWithCompetence?.forEach((as: any) => {
          const sec = as.secretaires;
          const besoins = sec?.secretaires_besoins_operations || [];
          const besoin = besoins.find((b: any) => b.besoin_operation_id === besoinOperationId);
          
          suggestions.push({
            secretaire_id: sec.id,
            secretaire_nom: `${sec.first_name} ${sec.name}`.trim(),
            raison: 'admin_disponible',
            preference_besoin: besoin?.preference,
            est_en_admin_ce_jour: true
          });
        });

        // Get available secretaries (not assigned) with besoin competence
        const { data: availableSecretaires } = await supabase
          .from('secretaires')
          .select(`
            id,
            first_name,
            name,
            secretaires_besoins_operations(
              besoin_operation_id,
              preference
            )
          `)
          .eq('actif', true);

        const eligibleBesoin = availableSecretaires?.filter((s: any) => {
          if (assignedIds.includes(s.id)) return false;
          if (suggestions.some(sug => sug.secretaire_id === s.id)) return false;
          return s.secretaires_besoins_operations?.some(
            (b: any) => b.besoin_operation_id === besoinOperationId
          );
        });

        eligibleBesoin?.forEach((s: any) => {
          const besoin = s.secretaires_besoins_operations.find(
            (b: any) => b.besoin_operation_id === besoinOperationId
          );
          suggestions.push({
            secretaire_id: s.id,
            secretaire_nom: `${s.first_name} ${s.name}`.trim(),
            raison: 'competence_besoin',
            preference_besoin: besoin?.preference,
            est_en_admin_ce_jour: false
          });
        });
      } else {
        // SITE CLASSIQUE: Priority to admin with site competence
        const { data: adminSecretaires } = await supabase
          .from('capacite_effective')
          .select(`
            secretaire_id,
            secretaires(id, first_name, name),
            secretaires_sites:secretaires!inner(
              secretaires_sites(
                site_id,
                priorite
              )
            )
          `)
          .eq('date', date)
          .eq('demi_journee', periode)
          .eq('site_id', '00000000-0000-0000-0000-000000000001')
          .eq('actif', true)
          .not('secretaire_id', 'in', `(${assignedIds.length > 0 ? assignedIds.join(',') : 'NULL'})`);

        // Filter admin secretaries with the right site competence
        const adminWithCompetence = adminSecretaires?.filter((as: any) => {
          const sites = as.secretaires?.secretaires_sites || [];
          return sites.some((s: any) => s.site_id === siteId);
        });

        // Add admin suggestions
        adminWithCompetence?.forEach((as: any) => {
          const sec = as.secretaires;
          const sites = sec?.secretaires_sites || [];
          const site = sites.find((s: any) => s.site_id === siteId);
          
          suggestions.push({
            secretaire_id: sec.id,
            secretaire_nom: `${sec.first_name} ${sec.name}`.trim(),
            raison: 'admin_disponible',
            priorite_site: parseInt(site?.priorite || '3') as 1 | 2 | 3,
            est_en_admin_ce_jour: true
          });
        });

        // Get available secretaries (not assigned) with site competence
        const { data: availableSecretaires } = await supabase
          .from('secretaires')
          .select(`
            id,
            first_name,
            name,
            secretaires_sites(
              site_id,
              priorite
            )
          `)
          .eq('actif', true);

        const eligibleSite = availableSecretaires?.filter((s: any) => {
          if (assignedIds.includes(s.id)) return false;
          if (suggestions.some(sug => sug.secretaire_id === s.id)) return false;
          return s.secretaires_sites?.some((ss: any) => ss.site_id === siteId);
        });

        eligibleSite?.forEach((s: any) => {
          const site = s.secretaires_sites.find((ss: any) => ss.site_id === siteId);
          suggestions.push({
            secretaire_id: s.id,
            secretaire_nom: `${s.first_name} ${s.name}`.trim(),
            raison: 'competence_site',
            priorite_site: parseInt(site?.priorite || '3') as 1 | 2 | 3,
            est_en_admin_ce_jour: false
          });
        });
      }

      // Sort suggestions by priority
      suggestions.sort((a, b) => {
        // Admin first
        if (a.est_en_admin_ce_jour && !b.est_en_admin_ce_jour) return -1;
        if (!a.est_en_admin_ce_jour && b.est_en_admin_ce_jour) return 1;

        // Then by preference/priority
        const aPref = a.priorite_site || a.preference_besoin || 3;
        const bPref = b.priorite_site || b.preference_besoin || 3;
        return aPref - bPref;
      });
    } catch (error) {
      console.error('Error generating suggestions:', error);
    }

    return suggestions.slice(0, 5); // Max 5 suggestions
  };

  const handleQuickAssign = async (need: UnfilledNeed, suggestion: SecretaireSuggestion) => {
    const key = `${need.date}-${need.periode}-${need.site_id}-${suggestion.secretaire_id}`;
    setAssigningId(key);

    try {
      const { error } = await supabase
        .from('capacite_effective')
        .insert({
          date: need.date,
          secretaire_id: suggestion.secretaire_id,
          demi_journee: need.periode,
          site_id: need.site_id,
          besoin_operation_id: need.besoin_operation_id || null,
          actif: true
        });

      if (error) throw error;

      toast.success(`${suggestion.secretaire_nom} assigné(e) avec succès`);
      
      // Refresh data
      await fetchUnfilledNeeds();
      onRefresh?.();
    } catch (error: any) {
      console.error('Error assigning secretary:', error);
      toast.error(error.message || 'Erreur lors de l\'assignation');
    } finally {
      setAssigningId(null);
    }
  };

  useEffect(() => {
    fetchUnfilledNeeds();
  }, [startDate, endDate]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (unfilledNeeds.length === 0) {
    return null;
  }

  // Group by date
  const needsByDate = new Map<string, UnfilledNeed[]>();
  unfilledNeeds.forEach(need => {
    if (!needsByDate.has(need.date)) {
      needsByDate.set(need.date, []);
    }
    needsByDate.get(need.date)!.push(need);
  });

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className="border-2 border-orange-500/50 bg-orange-50/10 dark:bg-orange-950/10">
        <CollapsibleTrigger className="w-full">
          <CardHeader className="cursor-pointer hover:bg-accent/50 transition-colors rounded-t-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <AlertCircle className="h-5 w-5 text-orange-500" />
                <div className="text-left">
                  <CardTitle className="text-lg">Besoins non satisfaits</CardTitle>
                  <CardDescription>
                    {unfilledNeeds.length} besoin{unfilledNeeds.length > 1 ? 's' : ''} non rempli{unfilledNeeds.length > 1 ? 's' : ''} cette semaine
                  </CardDescription>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="destructive" className="text-sm">
                  {unfilledNeeds.length}
                </Badge>
                <ChevronDown className={`h-5 w-5 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="pt-6 space-y-6">
            {Array.from(needsByDate.entries()).map(([date, needs]) => (
              <div key={date} className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <span className="text-lg">📅</span>
                  {format(new Date(date), 'EEEE dd MMMM yyyy', { locale: fr })}
                </div>

                {needs.map((need, idx) => (
                  <div key={`${need.date}-${need.periode}-${need.site_id}-${idx}`} className="ml-6 space-y-3 pb-4 border-b last:border-b-0">
                    <div className="flex items-start gap-3">
                      <span className="text-2xl">└─</span>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant={need.periode === 'matin' ? 'default' : 'secondary'}>
                            {need.periode === 'matin' ? 'Matin' : 'Après-midi'}
                          </Badge>
                          <span className="font-medium">{need.site_nom}</span>
                          {need.besoin_operation_nom && (
                            <Badge variant="outline" className="ml-2">
                              {need.besoin_operation_nom}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mb-3">
                          Manque : <span className="font-semibold text-destructive">{need.manque}</span> assistant{need.manque > 1 ? 's' : ''} médica{need.manque > 1 ? 'ux' : 'l'}
                        </p>

                        {need.suggestions.length > 0 ? (
                          <div className="space-y-2">
                            <p className="text-xs font-medium text-muted-foreground">Suggestions :</p>
                            <div className="space-y-2">
                              {need.suggestions.map((suggestion) => {
                                const assignKey = `${need.date}-${need.periode}-${need.site_id}-${suggestion.secretaire_id}`;
                                const isAssigning = assigningId === assignKey;

                                return (
                                  <div
                                    key={suggestion.secretaire_id}
                                    className="flex items-center justify-between gap-3 p-2 rounded-lg bg-accent/50 hover:bg-accent transition-colors"
                                  >
                                    <div className="flex items-center gap-2 flex-1">
                                      {suggestion.est_en_admin_ce_jour ? (
                                        <span className="text-lg" title="En admin">🟢</span>
                                      ) : (
                                        <span className="text-lg" title="Disponible">🔵</span>
                                      )}
                                      <span className="text-sm font-medium">{suggestion.secretaire_nom}</span>
                                      {suggestion.est_en_admin_ce_jour && (
                                        <Badge variant="default" className="text-xs">En admin</Badge>
                                      )}
                                      {(suggestion.priorite_site || suggestion.preference_besoin) && (
                                        <Badge variant="outline" className="text-xs">
                                          Préf {suggestion.priorite_site || suggestion.preference_besoin}
                                        </Badge>
                                      )}
                                    </div>
                                    <Button
                                      size="sm"
                                      variant="default"
                                      onClick={() => handleQuickAssign(need, suggestion)}
                                      disabled={isAssigning}
                                      className="gap-1"
                                    >
                                      {isAssigning ? (
                                        <>
                                          <Loader2 className="h-3 w-3 animate-spin" />
                                          <span className="text-xs">Assignation...</span>
                                        </>
                                      ) : (
                                        <>
                                          <UserPlus className="h-3 w-3" />
                                          <span className="text-xs">Assigner</span>
                                        </>
                                      )}
                                    </Button>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground italic">
                            Aucune suggestion disponible
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
};
