import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertCircle, ChevronDown, UserPlus, Loader2, Sparkles, Calendar, Clock } from 'lucide-react';
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
  full_day_suggestions?: {
    suggestions_admin: SecretaireSuggestion[];
    suggestions_not_working: SecretaireSuggestion[];
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
  const [expandedSuggestions, setExpandedSuggestions] = useState<Set<string>>(new Set());
  const [expandedFullDays, setExpandedFullDays] = useState<Set<string>>(new Set());
  const [selectedSecretaire, setSelectedSecretaire] = useState<Record<string, string>>({});

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

      // Générer les suggestions journée entière pour les besoins avec les deux périodes
      for (const need of grouped.values()) {
        if (need.has_both_periods) {
          const { admin, notWorking } = await generateFullDaySuggestions(
            need.date,
            need.site_id,
            need.besoin_operation_id
          );
          
          need.full_day_suggestions = {
            suggestions_admin: admin,
            suggestions_not_working: notWorking
          };
        }
      }

      setAggregatedNeeds(Array.from(grouped.values()));
    } catch (error) {
      console.error('Error fetching unfilled needs:', error);
      toast.error('Erreur lors du chargement des besoins non remplis');
    } finally {
      setLoading(false);
    }
  };

  const generateFullDaySuggestions = async (
    date: string,
    siteId: string,
    besoinOperationId?: string
  ): Promise<{ admin: SecretaireSuggestion[], notWorking: SecretaireSuggestion[] }> => {
    const admin: SecretaireSuggestion[] = [];
    const notWorking: SecretaireSuggestion[] = [];

    try {
      // Trouver qui est déjà assigné (matin OU après-midi)
      const { data: alreadyAssigned } = await supabase
        .from('capacite_effective')
        .select('secretaire_id')
        .eq('date', date)
        .eq('actif', true)
        .in('demi_journee', ['matin', 'apres_midi']);

      const assignedIds = [...new Set(alreadyAssigned?.map(a => a.secretaire_id) || [])];

      if (besoinOperationId) {
        // Cas BLOC OPÉRATOIRE

        // Catégorie 1: Admin MATIN ET APRÈS-MIDI avec compétence bloc
        const { data: adminMatin } = await supabase
          .from('capacite_effective')
          .select('secretaire_id, secretaires(id, first_name, name, secretaires_besoins_operations(besoin_operation_id, preference))')
          .eq('date', date)
          .eq('demi_journee', 'matin')
          .eq('site_id', '00000000-0000-0000-0000-000000000001')
          .eq('actif', true);

        const { data: adminApresMidi } = await supabase
          .from('capacite_effective')
          .select('secretaire_id')
          .eq('date', date)
          .eq('demi_journee', 'apres_midi')
          .eq('site_id', '00000000-0000-0000-0000-000000000001')
          .eq('actif', true);

        const adminAMIds = new Set(adminApresMidi?.map(a => a.secretaire_id) || []);

        for (const am of adminMatin || []) {
          if (adminAMIds.has(am.secretaire_id)) {
            const sec = am.secretaires as any;
            const besoins = sec?.secretaires_besoins_operations || [];
            const besoin = besoins.find((b: any) => b.besoin_operation_id === besoinOperationId);
            
            if (besoin) {
              admin.push({
                secretaire_id: sec.id,
                secretaire_nom: `${sec.first_name} ${sec.name}`.trim(),
                preference_besoin: besoin.preference as 1 | 2 | 3,
                peut_toute_journee: true
              });
            }
          }
        }

        // Catégorie 2: Ne travaille pas du tout avec compétence bloc
        const { data: allSecretaires } = await supabase
          .from('secretaires')
          .select('id, first_name, name, secretaires_besoins_operations(besoin_operation_id, preference)')
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
        // Cas SITE

        // Catégorie 1: Admin MATIN ET APRÈS-MIDI avec compétence site
        const { data: adminMatin } = await supabase
          .from('capacite_effective')
          .select('secretaire_id, secretaires(id, first_name, name, secretaires_sites(site_id, priorite))')
          .eq('date', date)
          .eq('demi_journee', 'matin')
          .eq('site_id', '00000000-0000-0000-0000-000000000001')
          .eq('actif', true);

        const { data: adminApresMidi } = await supabase
          .from('capacite_effective')
          .select('secretaire_id')
          .eq('date', date)
          .eq('demi_journee', 'apres_midi')
          .eq('site_id', '00000000-0000-0000-0000-000000000001')
          .eq('actif', true);

        const adminAMIds = new Set(adminApresMidi?.map(a => a.secretaire_id) || []);

        for (const am of adminMatin || []) {
          if (adminAMIds.has(am.secretaire_id)) {
            const sec = am.secretaires as any;
            const sites = sec?.secretaires_sites || [];
            const site = sites.find((s: any) => s.site_id === siteId);
            
            if (site) {
              admin.push({
                secretaire_id: sec.id,
                secretaire_nom: `${sec.first_name} ${sec.name}`.trim(),
                priorite_site: parseInt(site.priorite) as 1 | 2 | 3,
                peut_toute_journee: true
              });
            }
          }
        }

        // Catégorie 2: Ne travaille pas du tout avec compétence site
        const { data: allSecretaires } = await supabase
          .from('secretaires')
          .select('id, first_name, name, secretaires_sites(site_id, priorite)')
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

      return { admin, notWorking };
    } catch (error) {
      console.error('Error generating full day suggestions:', error);
      return { admin: [], notWorking: [] };
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
        admin,
        notWorking
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

  const renderFullDayNeed = (need: AggregatedNeed) => {
    if (!need.full_day_suggestions) return null;

    const needKey = `${need.date}-${need.site_id}-${need.besoin_operation_id}`;
    const isExpanded = expandedFullDays.has(needKey);
    const suggestionKey = `${need.date}-fullday-${need.site_id}`;
    const isSuggestionsExpanded = expandedSuggestions.has(suggestionKey);

    return (
      <div className="space-y-3">
        {/* Header avec badge "Journée entière manquante" */}
        <div className="p-3 rounded-lg bg-card border border-destructive/30">
          <div className="flex items-center gap-2">
            <Badge variant="destructive">Journée entière manquante</Badge>
            <span className="font-medium">{need.site_nom}</span>
            <span className="text-sm text-muted-foreground ml-auto">
              Total: <span className="font-semibold text-destructive">{need.total_manque}</span>
            </span>
          </div>
        </div>

        {/* Suggestions pour journée entière - interface simplifiée */}
        <div className="ml-4 p-4 rounded-lg border space-y-4">
          <div className="space-y-3">
            <h4 className="text-sm font-medium">Créer une journée entière</h4>
            
            {/* Dropdown pour sélectionner la secrétaire */}
            <Select
              value={selectedSecretaire[needKey] || ""}
              onValueChange={(value) => {
                setSelectedSecretaire(prev => ({ ...prev, [needKey]: value }));
              }}
            >
              <SelectTrigger className="w-full bg-background">
                <SelectValue placeholder="Sélectionner une secrétaire..." />
              </SelectTrigger>
              <SelectContent className="bg-background z-50">
                {/* Secrétaires en administratif */}
                {need.full_day_suggestions.suggestions_admin.length > 0 && (
                  <>
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                      En administratif
                    </div>
                    {need.full_day_suggestions.suggestions_admin.map(sug => (
                      <SelectItem key={sug.secretaire_id} value={sug.secretaire_id}>
                        <div className="flex items-center gap-2">
                          <span>{sug.secretaire_nom}</span>
                          {(sug.priorite_site === 1 || sug.preference_besoin === 1) && (
                            <Badge variant="secondary" className="text-xs h-5">★ Préf 1</Badge>
                          )}
                          {(sug.priorite_site === 2 || sug.preference_besoin === 2) && (
                            <Badge variant="outline" className="text-xs h-5">★ Préf 2</Badge>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </>
                )}
                
                {/* Secrétaires non disponibles */}
                {need.full_day_suggestions.suggestions_not_working.length > 0 && (
                  <>
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground mt-2">
                      Ajouter un créneau
                    </div>
                    {need.full_day_suggestions.suggestions_not_working.map(sug => (
                      <SelectItem key={sug.secretaire_id} value={sug.secretaire_id}>
                        <div className="flex items-center gap-2">
                          <span>{sug.secretaire_nom}</span>
                          {(sug.priorite_site === 1 || sug.preference_besoin === 1) && (
                            <Badge variant="secondary" className="text-xs h-5">★ Préf 1</Badge>
                          )}
                          {(sug.priorite_site === 2 || sug.preference_besoin === 2) && (
                            <Badge variant="outline" className="text-xs h-5">★ Préf 2</Badge>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </>
                )}
              </SelectContent>
            </Select>

            {/* Boutons d'action */}
            {selectedSecretaire[needKey] && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => {
                    const allSuggestions = [
                      ...need.full_day_suggestions.suggestions_admin,
                      ...need.full_day_suggestions.suggestions_not_working
                    ];
                    const sug = allSuggestions.find(s => s.secretaire_id === selectedSecretaire[needKey]);
                    if (sug) {
                      handleQuickAssign(need, 'matin', sug, true);
                      setSelectedSecretaire(prev => ({ ...prev, [needKey]: "" }));
                    }
                  }}
                  disabled={!!assigningId}
                  className="flex-1 gap-2"
                >
                  {assigningId ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Calendar className="h-4 w-4" />
                      Assigner journée entière
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>

          {/* Bouton pour décomposer en matin/après-midi */}
          <div className="pt-2 border-t border-border/30">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setExpandedFullDays(prev => {
                  const next = new Set(prev);
                  if (isExpanded) {
                    next.delete(needKey);
                  } else {
                    next.add(needKey);
                  }
                  return next;
                });
              }}
              className="w-full gap-2"
            >
              <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
              {isExpanded ? 'Masquer les demi-journées' : 'Décomposer en matin / après-midi'}
            </Button>
          </div>
        </div>

        {/* Vue décomposée (matin + après-midi) - conditionnelle */}
        {isExpanded && (
          <div className="space-y-3 mt-3 ml-4">
            {renderPeriod(need, 'matin')}
            {renderPeriod(need, 'apres_midi')}
          </div>
        )}
      </div>
    );
  };

  const renderPeriod = (need: AggregatedNeed, periode: 'matin' | 'apres_midi') => {
    const periodData = need.periods[periode];
    if (!periodData) return null;

    const periodKey = `${need.date}-${periode}-${need.site_id}`;

    return (
      <div className="ml-4 p-4 rounded-lg border space-y-4">
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

        <div className="space-y-3">
          <h4 className="text-sm font-medium">Assigner pour {periode === 'matin' ? 'le matin' : 'l\'après-midi'}</h4>
          
          {/* Dropdown pour sélectionner la secrétaire */}
          <Select
            value={selectedSecretaire[periodKey] || ""}
            onValueChange={(value) => {
              setSelectedSecretaire(prev => ({ ...prev, [periodKey]: value }));
            }}
          >
            <SelectTrigger className="w-full bg-background">
              <SelectValue placeholder="Sélectionner une secrétaire..." />
            </SelectTrigger>
            <SelectContent className="bg-background z-50">
              {/* Secrétaires en administratif */}
              {periodData.suggestions_admin.length > 0 && (
                <>
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                    En administratif
                  </div>
                  {periodData.suggestions_admin.map(sug => (
                    <SelectItem key={sug.secretaire_id} value={sug.secretaire_id}>
                      <div className="flex items-center gap-2">
                        <span>{sug.secretaire_nom}</span>
                        {(sug.priorite_site === 1 || sug.preference_besoin === 1) && (
                          <Badge variant="secondary" className="text-xs h-5">★ Préf 1</Badge>
                        )}
                        {(sug.priorite_site === 2 || sug.preference_besoin === 2) && (
                          <Badge variant="outline" className="text-xs h-5">★ Préf 2</Badge>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </>
              )}
              
              {/* Secrétaires non disponibles */}
              {periodData.suggestions_not_working.length > 0 && (
                <>
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground mt-2">
                    Ajouter un créneau
                  </div>
                  {periodData.suggestions_not_working.map(sug => (
                    <SelectItem key={sug.secretaire_id} value={sug.secretaire_id}>
                      <div className="flex items-center gap-2">
                        <span>{sug.secretaire_nom}</span>
                        {(sug.priorite_site === 1 || sug.preference_besoin === 1) && (
                          <Badge variant="secondary" className="text-xs h-5">★ Préf 1</Badge>
                        )}
                        {(sug.priorite_site === 2 || sug.preference_besoin === 2) && (
                          <Badge variant="outline" className="text-xs h-5">★ Préf 2</Badge>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </>
              )}
            </SelectContent>
          </Select>

          {/* Boutons d'action */}
          {selectedSecretaire[periodKey] && (
            <div className="flex gap-2">
              {(() => {
                const allSuggestions = [
                  ...periodData.suggestions_admin,
                  ...periodData.suggestions_not_working
                ];
                const sug = allSuggestions.find(s => s.secretaire_id === selectedSecretaire[periodKey]);
                
                return sug ? (
                  <>
                    {sug.peut_toute_journee && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          handleQuickAssign(need, periode, sug, true);
                          setSelectedSecretaire(prev => ({ ...prev, [periodKey]: "" }));
                        }}
                        disabled={!!assigningId}
                        className="flex-1 gap-2"
                      >
                        {assigningId ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <Calendar className="h-4 w-4" />
                            Journée entière
                          </>
                        )}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => {
                        handleQuickAssign(need, periode, sug, false);
                        setSelectedSecretaire(prev => ({ ...prev, [periodKey]: "" }));
                      }}
                      disabled={!!assigningId}
                      className="flex-1 gap-2"
                    >
                      {assigningId ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <Clock className="h-4 w-4" />
                          {periode === 'matin' ? 'Matin' : 'Après-midi'}
                        </>
                      )}
                    </Button>
                  </>
                ) : null;
              })()}
            </div>
          )}
        </div>

        {/* Aucune suggestion */}
        {periodData.suggestions_admin.length === 0 && periodData.suggestions_not_working.length === 0 && (
          <div className="text-center py-4 text-muted-foreground text-sm">
            <AlertCircle className="h-5 w-5 mx-auto mb-2" />
            Aucune secrétaire qualifiée disponible pour ce {need.besoin_operation_id ? 'besoin opération' : 'site'}
          </div>
        )}

        {/* Catégorie 3: Meilleure solution */}
        <div className="pt-2 border-t border-border/30">
          <Button
            variant="outline"
            size="sm"
            onClick={handleOptimize}
            className="w-full gap-2"
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

                {needs.map(need => {
                  const needKey = `${need.date}-${need.site_id}-${need.besoin_operation_id}`;
                  
                  return (
                    <div key={needKey} className="space-y-3">
                      {need.has_both_periods ? (
                        renderFullDayNeed(need)
                      ) : (
                        <>
                          <div className="p-3 rounded-lg bg-card border border-border/50">
                            <span className="font-medium">{need.site_nom}</span>
                          </div>
                          {renderPeriod(need, 'matin')}
                          {renderPeriod(need, 'apres_midi')}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
};
