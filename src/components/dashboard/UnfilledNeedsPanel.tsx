import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, ChevronDown, UserPlus, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface SecretaireSuggestion {
  secretaire_id: string;
  secretaire_nom: string;
  priorite_site?: 1 | 2 | 3;
  preference_besoin?: 1 | 2 | 3;
  peut_toute_journee?: boolean;
}

interface PeriodSuggestions {
  manque: number;
  suggestions_admin: SecretaireSuggestion[];
  suggestions_not_working: SecretaireSuggestion[];
}

interface AggregatedNeed {
  date: string;
  site_id: string;
  site_nom: string;
  besoin_operation_id?: string;
  planning_genere_bloc_operatoire_id?: string;
  has_both_periods: boolean;
  total_manque: number;
  periods: {
    matin?: PeriodSuggestions;
    apres_midi?: PeriodSuggestions;
  };
}

interface UnfilledNeedsPanelProps {
  startDate: string;
  endDate: string;
  onRefresh?: () => void;
}

export const UnfilledNeedsPanel = ({ startDate, endDate, onRefresh }: UnfilledNeedsPanelProps) => {
  const [aggregatedNeeds, setAggregatedNeeds] = useState<AggregatedNeed[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [assigningId, setAssigningId] = useState<string | null>(null);

  const fetchUnfilledNeeds = async () => {
    setLoading(true);
    try {
      const { data: needs, error } = await supabase
        .from('besoins_non_satisfaits_summary')
        .select('*')
        .gte('date', startDate)
        .lte('date', endDate)
        .gt('nombre_manquant', 0)
        .order('date', { ascending: true })
        .order('periode', { ascending: true });

      if (error) throw error;

      // Agréger les besoins par date + site + besoin_operation_id
      const grouped = new Map<string, AggregatedNeed>();

      for (const need of needs || []) {
        const key = `${need.date}-${need.site_id}-${need.besoin_operation_id || 'site'}`;
        
        if (!grouped.has(key)) {
          grouped.set(key, {
            date: need.date,
            site_id: need.site_id,
            site_nom: need.site_nom,
            besoin_operation_id: need.besoin_operation_id,
            planning_genere_bloc_operatoire_id: need.planning_genere_bloc_operatoire_id,
            has_both_periods: false,
            total_manque: 0,
            periods: {}
          });
        }

        const aggregated = grouped.get(key)!;
        const periode = need.periode as 'matin' | 'apres_midi';
        
        // Générer les suggestions pour cette période
        const { admin, notWorking } = await generateSuggestions(
          need.date,
          periode,
          need.site_id,
          need.besoin_operation_id
        );

        aggregated.periods[periode] = {
          manque: need.nombre_manquant,
          suggestions_admin: admin,
          suggestions_not_working: notWorking
        };

        aggregated.total_manque += need.nombre_manquant;
      }

      // Marquer les besoins avec les deux périodes
      grouped.forEach(need => {
        need.has_both_periods = !!need.periods.matin && !!need.periods.apres_midi;
      });

      setAggregatedNeeds(Array.from(grouped.values()));
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
  ): Promise<{ admin: SecretaireSuggestion[], notWorking: SecretaireSuggestion[] }> => {
    const admin: SecretaireSuggestion[] = [];
    const notWorking: SecretaireSuggestion[] = [];

    try {
      const autrePeriode = periode === 'matin' ? 'apres_midi' : 'matin';
      
      const { data: alreadyAssigned } = await supabase
        .from('capacite_effective')
        .select('secretaire_id')
        .eq('date', date)
        .eq('demi_journee', periode)
        .eq('actif', true);

      const assignedIds = alreadyAssigned?.map(a => a.secretaire_id) || [];

      const canCoverFullDay = async (secretaireId: string) => {
        const { data: autrePeriodeCapacite } = await supabase
          .from('capacite_effective')
          .select('id, site_id')
          .eq('secretaire_id', secretaireId)
          .eq('date', date)
          .eq('demi_journee', autrePeriode)
          .eq('actif', true)
          .maybeSingle();

        return autrePeriodeCapacite?.site_id === '00000000-0000-0000-0000-000000000001';
      };

      if (besoinOperationId) {
        // Catégorie 1: Admin avec compétence bloc
        const { data: adminSecretaires } = await supabase
          .from('capacite_effective')
          .select(`
            secretaire_id,
            secretaires(id, first_name, name, secretaires_besoins_operations(besoin_operation_id, preference))
          `)
          .eq('date', date)
          .eq('demi_journee', periode)
          .eq('site_id', '00000000-0000-0000-0000-000000000001')
          .eq('actif', true);

        for (const as of adminSecretaires || []) {
          if (assignedIds.includes(as.secretaire_id)) continue;
          
          const sec = as.secretaires as any;
          const besoins = sec?.secretaires_besoins_operations || [];
          const besoin = besoins.find((b: any) => b.besoin_operation_id === besoinOperationId);
          
          if (besoin) {
            admin.push({
              secretaire_id: sec.id,
              secretaire_nom: `${sec.first_name} ${sec.name}`.trim(),
              preference_besoin: besoin.preference as 1 | 2 | 3,
              peut_toute_journee: await canCoverFullDay(sec.id)
            });
          }
        }

        // Catégorie 2: Ne travaille pas avec compétence bloc
        const { data: allSecretaires } = await supabase
          .from('secretaires')
          .select(`
            id,
            first_name,
            name,
            secretaires_besoins_operations(besoin_operation_id, preference)
          `)
          .eq('actif', true);

        for (const s of allSecretaires || []) {
          if (assignedIds.includes(s.id)) continue;
          if (admin.some(a => a.secretaire_id === s.id)) continue;
          
          const besoins = (s as any).secretaires_besoins_operations || [];
          const besoin = besoins.find((b: any) => b.besoin_operation_id === besoinOperationId);
          
          if (besoin) {
            notWorking.push({
              secretaire_id: s.id,
              secretaire_nom: `${s.first_name} ${s.name}`.trim(),
              preference_besoin: besoin.preference as 1 | 2 | 3,
              peut_toute_journee: false
            });
          }
        }
      } else {
        // Catégorie 1: Admin avec compétence site
        const { data: adminSecretaires } = await supabase
          .from('capacite_effective')
          .select(`
            secretaire_id,
            secretaires(id, first_name, name, secretaires_sites(site_id, priorite))
          `)
          .eq('date', date)
          .eq('demi_journee', periode)
          .eq('site_id', '00000000-0000-0000-0000-000000000001')
          .eq('actif', true);

        for (const as of adminSecretaires || []) {
          if (assignedIds.includes(as.secretaire_id)) continue;
          
          const sec = as.secretaires as any;
          const sites = sec?.secretaires_sites || [];
          const site = sites.find((s: any) => s.site_id === siteId);
          
          if (site) {
            admin.push({
              secretaire_id: sec.id,
              secretaire_nom: `${sec.first_name} ${sec.name}`.trim(),
              priorite_site: parseInt(site.priorite) as 1 | 2 | 3,
              peut_toute_journee: await canCoverFullDay(sec.id)
            });
          }
        }

        // Catégorie 2: Ne travaille pas avec compétence site
        const { data: allSecretaires } = await supabase
          .from('secretaires')
          .select(`
            id,
            first_name,
            name,
            secretaires_sites(site_id, priorite)
          `)
          .eq('actif', true);

        for (const s of allSecretaires || []) {
          if (assignedIds.includes(s.id)) continue;
          if (admin.some(a => a.secretaire_id === s.id)) continue;
          
          const sites = (s as any).secretaires_sites || [];
          const site = sites.find((ss: any) => ss.site_id === siteId);
          
          if (site) {
            notWorking.push({
              secretaire_id: s.id,
              secretaire_nom: `${s.first_name} ${s.name}`.trim(),
              priorite_site: parseInt(site.priorite) as 1 | 2 | 3,
              peut_toute_journee: false
            });
          }
        }
      }

      // Trier par préférence/priorité
      const sortByPref = (a: SecretaireSuggestion, b: SecretaireSuggestion) => {
        const aPref = a.priorite_site || a.preference_besoin || 3;
        const bPref = b.priorite_site || b.preference_besoin || 3;
        return aPref - bPref;
      };

      admin.sort(sortByPref);
      notWorking.sort(sortByPref);

      return {
        admin: admin.slice(0, 3),
        notWorking: notWorking.slice(0, 3)
      };
    } catch (error) {
      console.error('Error generating suggestions:', error);
      return { admin: [], notWorking: [] };
    }
  };

  const handleQuickAssign = async (
    need: AggregatedNeed,
    periode: 'matin' | 'apres_midi',
    suggestion: SecretaireSuggestion,
    fullDay: boolean = false
  ) => {
    const key = `${need.date}-${periode}-${need.site_id}-${suggestion.secretaire_id}-${fullDay}`;
    setAssigningId(key);

    try {
      const periodes: ('matin' | 'apres_midi')[] = fullDay ? ['matin', 'apres_midi'] : [periode];
      
      for (const p of periodes) {
        await supabase
          .from('capacite_effective')
          .delete()
          .eq('secretaire_id', suggestion.secretaire_id)
          .eq('date', need.date)
          .eq('demi_journee', p)
          .eq('site_id', '00000000-0000-0000-0000-000000000001');

        console.log('UnfilledNeedsPanel - Quick assign:', {
          date: need.date,
          periode: p,
          secretaire: suggestion.secretaire_nom,
          site_id: need.site_id,
          besoin_operation_id: need.besoin_operation_id,
          planning_genere_bloc_operatoire_id: need.planning_genere_bloc_operatoire_id,
        });

        const { error } = await supabase
          .from('capacite_effective')
          .insert({
            date: need.date,
            secretaire_id: suggestion.secretaire_id,
            demi_journee: p,
            site_id: need.site_id,
            besoin_operation_id: need.besoin_operation_id || null,
            planning_genere_bloc_operatoire_id: need.planning_genere_bloc_operatoire_id || null,
            actif: true
          });

        if (error) throw error;
      }

      toast.success(`${suggestion.secretaire_nom} assigné(e) ${fullDay ? 'toute la journée' : ''}`);
      await fetchUnfilledNeeds();
      onRefresh?.();
    } catch (error: any) {
      console.error('Error assigning secretary:', error);
      toast.error(error.message || 'Erreur lors de l\'assignation');
    } finally {
      setAssigningId(null);
    }
  };

  const handleOptimize = () => {
    toast.info('Optimisation automatique : fonctionnalité en développement');
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

  if (aggregatedNeeds.length === 0) {
    return null;
  }

  const needsByDate = new Map<string, AggregatedNeed[]>();
  aggregatedNeeds.forEach(need => {
    if (!needsByDate.has(need.date)) {
      needsByDate.set(need.date, []);
    }
    needsByDate.get(need.date)!.push(need);
  });

  const renderPeriod = (need: AggregatedNeed, periode: 'matin' | 'apres_midi') => {
    const periodData = need.periods[periode];
    if (!periodData) return null;

    return (
      <div className="ml-4 p-4 rounded-lg bg-muted/20 border-l-2 border-primary/30 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant={periode === 'matin' ? 'default' : 'secondary'}>
              {periode === 'matin' ? 'Matin' : 'Après-midi'}
            </Badge>
            <span className="text-sm text-muted-foreground">
              Manque : <span className="font-semibold text-destructive">{periodData.manque}</span>
            </span>
          </div>
        </div>

        {/* Catégorie 1: Admin */}
        {periodData.suggestions_admin.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-foreground flex items-center gap-2">
              <span className="text-base">🟢</span>
              En administratif ({periodData.suggestions_admin.length})
            </h4>
            <div className="space-y-2">
              {periodData.suggestions_admin.map(sug => {
                const key = `${need.date}-${periode}-${need.site_id}-${sug.secretaire_id}-false`;
                const keyFull = `${need.date}-${periode}-${need.site_id}-${sug.secretaire_id}-true`;
                return (
                  <div key={sug.secretaire_id} className="flex items-center justify-between gap-2 p-2 rounded bg-card border border-border/50">
                    <div className="flex items-center gap-2 flex-1">
                      <span className="text-sm font-medium">{sug.secretaire_nom}</span>
                      {(sug.priorite_site || sug.preference_besoin) && (
                        <Badge variant="outline" className="text-xs">
                          Préf {sug.priorite_site || sug.preference_besoin}
                        </Badge>
                      )}
                    </div>
                    <div className="flex gap-1">
                      {sug.peut_toute_journee && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleQuickAssign(need, periode, sug, true)}
                          disabled={assigningId === keyFull}
                          className="h-7 px-2 text-xs"
                        >
                          {assigningId === keyFull ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Journée'}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        onClick={() => handleQuickAssign(need, periode, sug, false)}
                        disabled={assigningId === key}
                        className="h-7 px-2 text-xs gap-1"
                      >
                        {assigningId === key ? <Loader2 className="h-3 w-3 animate-spin" /> : <><UserPlus className="h-3 w-3" /> Assigner</>}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Catégorie 2: Ne travaille pas */}
        {periodData.suggestions_not_working.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-foreground flex items-center gap-2">
              <span className="text-base">⚪</span>
              Disponibles ({periodData.suggestions_not_working.length})
            </h4>
            <div className="space-y-2">
              {periodData.suggestions_not_working.map(sug => {
                const key = `${need.date}-${periode}-${need.site_id}-${sug.secretaire_id}-false`;
                return (
                  <div key={sug.secretaire_id} className="flex items-center justify-between gap-2 p-2 rounded bg-card border border-border/50">
                    <div className="flex items-center gap-2 flex-1">
                      <span className="text-sm font-medium">{sug.secretaire_nom}</span>
                      {(sug.priorite_site || sug.preference_besoin) && (
                        <Badge variant="outline" className="text-xs">
                          Préf {sug.priorite_site || sug.preference_besoin}
                        </Badge>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleQuickAssign(need, periode, sug, false)}
                      disabled={assigningId === key}
                      className="h-7 px-2 text-xs gap-1"
                    >
                      {assigningId === key ? <Loader2 className="h-3 w-3 animate-spin" /> : <><UserPlus className="h-3 w-3" /> Assigner</>}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Catégorie 3: Meilleure solution */}
        <div className="pt-2 border-t border-border/30">
          <Button
            variant="outline"
            size="sm"
            onClick={handleOptimize}
            className="w-full gap-2 bg-gradient-to-r from-primary/5 to-primary/10 hover:from-primary/10 hover:to-primary/20 border-primary/30"
          >
            <Sparkles className="h-4 w-4" />
            Trouver la meilleure solution
          </Button>
        </div>
      </div>
    );
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="mb-6">
      <Card className="rounded-xl overflow-hidden bg-card/50 backdrop-blur-xl border border-border/50 shadow-lg hover:shadow-xl transition-all">
        <CollapsibleTrigger className="w-full">
          <div className="flex items-center justify-between p-4 bg-gradient-to-r from-primary/5 to-transparent hover:from-primary/10 transition-all">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-primary" />
              <h3 className="text-base font-semibold">Besoins non satisfaits</h3>
              <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
                {aggregatedNeeds.length}
              </Badge>
            </div>
            <ChevronDown className={`h-5 w-5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="p-6 space-y-6">
            {Array.from(needsByDate.entries()).map(([date, needs]) => (
              <div key={date} className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <span>📅</span>
                  {format(new Date(date), 'EEEE dd MMMM yyyy', { locale: fr })}
                </div>

                {needs.map(need => (
                  <div key={`${need.date}-${need.site_id}-${need.besoin_operation_id}`} className="space-y-3">
                    {need.has_both_periods && (
                      <div className="flex items-center gap-2 p-3 rounded-lg bg-card border border-primary/20">
                        <Badge className="bg-primary/10 text-primary border-primary/30">Journée complète</Badge>
                        <span className="font-medium">{need.site_nom}</span>
                        <span className="text-sm text-muted-foreground ml-auto">
                          Manque : <span className="font-semibold text-destructive">{need.total_manque}</span>
                        </span>
                      </div>
                    )}

                    {!need.has_both_periods && (
                      <div className="p-3 rounded-lg bg-card border border-border/50">
                        <span className="font-medium">{need.site_nom}</span>
                      </div>
                    )}

                    {renderPeriod(need, 'matin')}
                    {renderPeriod(need, 'apres_midi')}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
};
