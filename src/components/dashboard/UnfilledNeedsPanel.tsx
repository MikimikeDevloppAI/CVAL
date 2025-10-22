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
  statut_actuel?: 'admin' | 'autre_site' | 'ne_travaille_pas';
  site_actuel?: string;
  peut_toute_journee?: boolean;
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
      // Une seule requête pour récupérer tous les besoins non satisfaits depuis la materialized view
      const { data: needs, error } = await supabase
        .from('besoins_non_satisfaits_summary')
        .select('*')
        .gte('date', startDate)
        .lte('date', endDate)
        .gt('manque', 0)
        .order('date', { ascending: true })
        .order('periode', { ascending: true });

      if (error) throw error;

      // Générer les suggestions pour chaque besoin
      const needsWithSuggestions = await Promise.all(
        (needs || []).map(async (need) => {
          const suggestions = await generateSuggestions(
            need.date,
            need.periode as 'matin' | 'apres_midi',
            need.site_id,
            need.besoin_operation_id
          );
          
          return {
            date: need.date,
            periode: need.periode as 'matin' | 'apres_midi',
            site_id: need.site_id,
            site_nom: need.site_nom,
            besoin_operation_id: need.besoin_operation_id,
            besoin_operation_nom: need.besoin_operation_nom,
            manque: need.manque,
            suggestions
          };
        })
      );

      setUnfilledNeeds(needsWithSuggestions);
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
    const fullDaySuggestions: SecretaireSuggestion[] = [];

    try {
      const autrePeriode = periode === 'matin' ? 'apres_midi' : 'matin';
      
      // Get secretaries already assigned this day/period
      const { data: alreadyAssigned } = await supabase
        .from('capacite_effective')
        .select('secretaire_id')
        .eq('date', date)
        .eq('demi_journee', periode)
        .eq('actif', true);

      const assignedIds = alreadyAssigned?.map(a => a.secretaire_id) || [];

      // Helper function to check secretary status
      const getSecretaryStatus = async (secretaireId: string) => {
        const { data: capacite } = await supabase
          .from('capacite_effective')
          .select('site_id, demi_journee, sites(nom)')
          .eq('secretaire_id', secretaireId)
          .eq('date', date)
          .eq('demi_journee', periode)
          .eq('actif', true)
          .single();

        if (!capacite) {
          return { statut: 'ne_travaille_pas' as const, site: undefined };
        }

        if (capacite.site_id === '00000000-0000-0000-0000-000000000001') {
          return { statut: 'admin' as const, site: 'Administratif' };
        }

        return { 
          statut: 'autre_site' as const, 
          site: (capacite.sites as any)?.nom || 'Site inconnu'
        };
      };

      // Check if secretary can cover full day
      const canCoverFullDay = async (secretaireId: string) => {
        const { data: autrePeriodeCapacite } = await supabase
          .from('capacite_effective')
          .select('id, site_id')
          .eq('secretaire_id', secretaireId)
          .eq('date', date)
          .eq('demi_journee', autrePeriode)
          .eq('actif', true)
          .maybeSingle();

        // Can cover full day if in admin for the other period
        return autrePeriodeCapacite?.site_id === '00000000-0000-0000-0000-000000000001';
      };

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
        for (const as of adminWithCompetence || []) {
          const sec = as.secretaires;
          const besoins = (as as any).secretaires?.secretaires_besoins_operations || [];
          const besoin = besoins.find((b: any) => b.besoin_operation_id === besoinOperationId);
          const peutTouteJournee = await canCoverFullDay(sec.id);
          
          const suggestion = {
            secretaire_id: sec.id,
            secretaire_nom: `${sec.first_name} ${sec.name}`.trim(),
            raison: 'admin_disponible' as const,
            preference_besoin: (besoin?.preference || 3) as 1 | 2 | 3,
            est_en_admin_ce_jour: true,
            statut_actuel: 'admin' as const,
            site_actuel: 'Administratif',
            peut_toute_journee: peutTouteJournee
          };

          if (peutTouteJournee) {
            fullDaySuggestions.push(suggestion);
          } else {
            suggestions.push(suggestion);
          }
        }

        // Get available secretaries (not assigned) with besoin competence
        const { data: availableSecretaires } = await supabase
          .from('secretaires')
          .select(`
            id,
            first_name,
            name,
            secretaires_besoins_operations!inner(
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

        for (const s of eligibleBesoin || []) {
          const besoin = (s as any).secretaires_besoins_operations.find(
            (b: any) => b.besoin_operation_id === besoinOperationId
          );
          const status = await getSecretaryStatus(s.id);
          const peutTouteJournee = status.statut === 'ne_travaille_pas' ? false : await canCoverFullDay(s.id);
          
          const suggestion = {
            secretaire_id: s.id,
            secretaire_nom: `${s.first_name} ${s.name}`.trim(),
            raison: 'competence_besoin' as const,
            preference_besoin: (besoin?.preference || 3) as 1 | 2 | 3,
            est_en_admin_ce_jour: false,
            statut_actuel: status.statut,
            site_actuel: status.site,
            peut_toute_journee: peutTouteJournee
          };

          if (peutTouteJournee) {
            fullDaySuggestions.push(suggestion);
          } else {
            suggestions.push(suggestion);
          }
        }
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
        for (const as of adminWithCompetence || []) {
          const sec = as.secretaires;
          const sites = (as as any).secretaires?.secretaires_sites || [];
          const site = sites.find((s: any) => s.site_id === siteId);
          const peutTouteJournee = await canCoverFullDay(sec.id);
          
          const suggestion = {
            secretaire_id: sec.id,
            secretaire_nom: `${sec.first_name} ${sec.name}`.trim(),
            raison: 'admin_disponible' as const,
            priorite_site: parseInt(site?.priorite || '3') as 1 | 2 | 3,
            est_en_admin_ce_jour: true,
            statut_actuel: 'admin' as const,
            site_actuel: 'Administratif',
            peut_toute_journee: peutTouteJournee
          };

          if (peutTouteJournee) {
            fullDaySuggestions.push(suggestion);
          } else {
            suggestions.push(suggestion);
          }
        }

        // Get available secretaries (not assigned) with site competence
        const { data: availableSecretaires } = await supabase
          .from('secretaires')
          .select(`
            id,
            first_name,
            name,
            secretaires_sites!inner(
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

        for (const s of eligibleSite || []) {
          const site = (s as any).secretaires_sites.find((ss: any) => ss.site_id === siteId);
          const status = await getSecretaryStatus(s.id);
          const peutTouteJournee = status.statut === 'ne_travaille_pas' ? false : await canCoverFullDay(s.id);
          
          const suggestion = {
            secretaire_id: s.id,
            secretaire_nom: `${s.first_name} ${s.name}`.trim(),
            raison: 'competence_site' as const,
            priorite_site: parseInt(site?.priorite || '3') as 1 | 2 | 3,
            est_en_admin_ce_jour: false,
            statut_actuel: status.statut,
            site_actuel: status.site,
            peut_toute_journee: peutTouteJournee
          };

          if (peutTouteJournee) {
            fullDaySuggestions.push(suggestion);
          } else {
            suggestions.push(suggestion);
          }
        }
      }

      // Sort full day suggestions by priority
      fullDaySuggestions.sort((a, b) => {
        // Admin first
        if (a.est_en_admin_ce_jour && !b.est_en_admin_ce_jour) return -1;
        if (!a.est_en_admin_ce_jour && b.est_en_admin_ce_jour) return 1;

        // Then by preference/priority
        const aPref = a.priorite_site || a.preference_besoin || 3;
        const bPref = b.priorite_site || b.preference_besoin || 3;
        return aPref - bPref;
      });

      // Sort regular suggestions by priority
      suggestions.sort((a, b) => {
        // Admin first
        if (a.est_en_admin_ce_jour && !b.est_en_admin_ce_jour) return -1;
        if (!a.est_en_admin_ce_jour && b.est_en_admin_ce_jour) return 1;

        // Then by preference/priority
        const aPref = a.priorite_site || a.preference_besoin || 3;
        const bPref = b.priorite_site || b.preference_besoin || 3;
        return aPref - bPref;
      });

      // Combine: full day suggestions first, then regular
      const combined = [...fullDaySuggestions, ...suggestions];
      return combined.slice(0, 5); // Max 5 suggestions
    } catch (error) {
      console.error('Error generating suggestions:', error);
    }

    return suggestions.slice(0, 5);
  };

  const handleQuickAssign = async (need: UnfilledNeed, suggestion: SecretaireSuggestion, fullDay: boolean = false) => {
    const key = `${need.date}-${need.periode}-${need.site_id}-${suggestion.secretaire_id}-${fullDay}`;
    setAssigningId(key);

    try {
      const periodes: ('matin' | 'apres_midi')[] = fullDay ? ['matin', 'apres_midi'] : [need.periode];
      
      for (const periode of periodes) {
        // Delete from admin if exists
        await supabase
          .from('capacite_effective')
          .delete()
          .eq('secretaire_id', suggestion.secretaire_id)
          .eq('date', need.date)
          .eq('demi_journee', periode)
          .eq('site_id', '00000000-0000-0000-0000-000000000001');

        // Insert new assignment
        const { error } = await supabase
          .from('capacite_effective')
          .insert({
            date: need.date,
            secretaire_id: suggestion.secretaire_id,
            demi_journee: periode,
            site_id: need.site_id,
            besoin_operation_id: need.besoin_operation_id || null,
            actif: true
          });

        if (error) throw error;
      }

      toast.success(`${suggestion.secretaire_nom} assigné(e) ${fullDay ? 'toute la journée' : ''} avec succès`);
      
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
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="mb-6">
      <Card className="rounded-xl overflow-hidden bg-card/50 backdrop-blur-xl border border-border/50 shadow-lg hover:shadow-xl transition-all duration-300 ease-out">
        <CollapsibleTrigger className="w-full">
          <div className="flex items-center justify-between p-4 bg-gradient-to-r from-primary/5 to-transparent hover:from-primary/10 transition-all duration-200">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-primary" />
              <h3 className="text-base font-semibold text-foreground">
                Besoins non satisfaits
              </h3>
              {unfilledNeeds.length > 0 && (
                <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
                  {unfilledNeeds.length}
                </Badge>
              )}
            </div>
            <ChevronDown className={`h-5 w-5 text-muted-foreground transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="bg-background p-6 space-y-6">
            {Array.from(needsByDate.entries()).map(([date, needs]) => (
              <div key={date} className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <span className="text-lg">📅</span>
                  {format(new Date(date), 'EEEE dd MMMM yyyy', { locale: fr })}
                </div>

                {needs.map((need, idx) => (
                  <div key={`${need.date}-${need.periode}-${need.site_id}-${idx}`} className="p-4 rounded-lg bg-card border border-border/50 hover:border-primary/30 hover:shadow-md transition-all duration-200">
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
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
                      <p className="text-sm text-muted-foreground">
                        Manque : <span className="font-semibold text-destructive">{need.manque}</span> assistant{need.manque > 1 ? 's' : ''} médica{need.manque > 1 ? 'ux' : 'l'}
                      </p>

                      {need.suggestions.length > 0 ? (
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-muted-foreground">Suggestions :</p>
                          <div className="space-y-2">
                            {need.suggestions.map((suggestion) => {
                              const assignKey = `${need.date}-${need.periode}-${need.site_id}-${suggestion.secretaire_id}-false`;
                              const assignFullDayKey = `${need.date}-${need.periode}-${need.site_id}-${suggestion.secretaire_id}-true`;
                              const isAssigning = assigningId === assignKey;
                              const isAssigningFullDay = assigningId === assignFullDayKey;

                              return (
                                <div
                                  key={suggestion.secretaire_id}
                                  className="flex items-center justify-between gap-3 p-2 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                                >
                                  <div className="flex items-center gap-2 flex-1 flex-wrap">
                                    {suggestion.statut_actuel === 'admin' ? (
                                      <span className="text-lg" title="En admin">🟢</span>
                                    ) : suggestion.statut_actuel === 'autre_site' ? (
                                      <span className="text-lg" title="Sur un autre site">🟡</span>
                                    ) : (
                                      <span className="text-lg" title="Ne travaille pas">⚪</span>
                                    )}
                                    <span className="text-sm font-medium">{suggestion.secretaire_nom}</span>
                                    {suggestion.peut_toute_journee && (
                                      <Badge variant="default" className="text-xs bg-green-500/10 text-green-700 border-green-500/30">
                                        Toute journée
                                      </Badge>
                                    )}
                                    {suggestion.statut_actuel === 'admin' ? (
                                      <Badge variant="default" className="text-xs">Administratif</Badge>
                                    ) : suggestion.statut_actuel === 'autre_site' ? (
                                      <Badge variant="secondary" className="text-xs">{suggestion.site_actuel}</Badge>
                                    ) : (
                                      <Badge variant="outline" className="text-xs">Ne travaille pas</Badge>
                                    )}
                                    {(suggestion.priorite_site || suggestion.preference_besoin) && (
                                      <Badge variant="outline" className="text-xs">
                                        Préf {suggestion.priorite_site || suggestion.preference_besoin}
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="flex gap-2 shrink-0">
                                    {suggestion.peut_toute_journee && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => handleQuickAssign(need, suggestion, true)}
                                        disabled={isAssigningFullDay}
                                        className="gap-1 bg-green-500/5 hover:bg-green-500/10 border-green-500/30 text-green-700"
                                      >
                                        {isAssigningFullDay ? (
                                          <>
                                            <Loader2 className="h-3 w-3 animate-spin" />
                                            <span className="text-xs">...</span>
                                          </>
                                        ) : (
                                          <>
                                            <UserPlus className="h-3 w-3" />
                                            <span className="text-xs">Journée</span>
                                          </>
                                        )}
                                      </Button>
                                    )}
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => handleQuickAssign(need, suggestion, false)}
                                      disabled={isAssigning}
                                      className={`gap-1 ${
                                        suggestion.statut_actuel === 'admin'
                                          ? 'bg-primary/5 hover:bg-primary/10 border-primary/30 text-primary' 
                                          : 'bg-muted/5 hover:bg-muted/20'
                                      }`}
                                    >
                                      {isAssigning ? (
                                        <>
                                          <Loader2 className="h-3 w-3 animate-spin" />
                                          <span className="text-xs">...</span>
                                        </>
                                      ) : (
                                        <>
                                          <UserPlus className="h-3 w-3" />
                                          <span className="text-xs">Assigner</span>
                                        </>
                                      )}
                                    </Button>
                                  </div>
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
                ))}
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
};
