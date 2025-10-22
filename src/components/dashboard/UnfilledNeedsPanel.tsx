import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertCircle, ChevronDown, UserPlus, Loader2, Sparkles, Calendar, Clock, X } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { OptimizationTestDialog } from './OptimizationTestDialog';

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

interface BesoinPersonnel {
  besoin_operation_id: string;
  besoin_operation_nom: string;
  nombre_requis: number;
  nombre_manquant: number;
  suggestions_matin?: {
    suggestions_admin: SecretaireSuggestion[];
    suggestions_not_working: SecretaireSuggestion[];
  };
  suggestions_apres_midi?: {
    suggestions_admin: SecretaireSuggestion[];
    suggestions_not_working: SecretaireSuggestion[];
  };
}

interface AggregatedNeed {
  date: string;
  site_id: string;
  site_nom: string;
  type_intervention_id?: string;
  type_intervention_nom?: string;
  planning_genere_bloc_operatoire_id?: string;
  besoins_personnel?: BesoinPersonnel[];
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
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [expandedSuggestions, setExpandedSuggestions] = useState<Set<string>>(new Set());
  const [expandedFullDays, setExpandedFullDays] = useState<Set<string>>(new Set());
  const [selectedSecretaire, setSelectedSecretaire] = useState<Record<string, string>>({});
  const [loadedSuggestions, setLoadedSuggestions] = useState<Set<string>>(new Set());
  const [loadingSuggestions, setLoadingSuggestions] = useState<Set<string>>(new Set());
  const [testingDays, setTestingDays] = useState<Set<string>>(new Set());
  const [testResult, setTestResult] = useState<any>(null);
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [applyingOptimization, setApplyingOptimization] = useState(false);

  const fetchUnfilledNeedsCount = async () => {
    setLoading(true);
    try {
      const { count, error } = await supabase
        .from('besoins_non_satisfaits_summary')
        .select('*', { count: 'exact', head: true })
        .gte('date', startDate)
        .lte('date', endDate)
        .gt('nombre_manquant', 0);
      
      if (error) throw error;
      setTotalCount(count || 0);
    } catch (error) {
      console.error('Error fetching count:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchBesoinsBlocOperatoire = async (typeInterventionId: string) => {
    const { data, error } = await supabase
      .from('types_intervention_besoins_personnel')
      .select(`
        besoin_operation_id,
        nombre_requis,
        besoins_operations(id, nom, code)
      `)
      .eq('type_intervention_id', typeInterventionId)
      .eq('actif', true);
    
    if (error) {
      console.error('Error fetching besoins bloc:', error);
      return [];
    }

    return data?.map(d => ({
      besoin_operation_id: d.besoin_operation_id,
      besoin_operation_nom: (d.besoins_operations as any)?.nom || '',
      nombre_requis: d.nombre_requis,
      nombre_manquant: 0
    })) || [];
  };

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

      // Agréger les besoins par date + site + planning_bloc_id
      const grouped = new Map<string, AggregatedNeed>();

      for (const need of needs || []) {
        // Pour les blocs opératoires, on groupe par planning_genere_bloc_operatoire_id
        // Pour les sites normaux, on groupe par site_id
        const key = need.planning_genere_bloc_operatoire_id 
          ? `${need.date}-bloc-${need.planning_genere_bloc_operatoire_id}`
          : `${need.date}-site-${need.site_id}`;
        
        if (!grouped.has(key)) {
          // Si c'est un bloc opératoire, récupérer le type d'intervention
          let typeInterventionId: string | undefined;
          let typeInterventionNom: string | undefined;
          let besoinsPersonnel: BesoinPersonnel[] | undefined;

          if (need.planning_genere_bloc_operatoire_id) {
            const { data: blocData } = await supabase
              .from('planning_genere_bloc_operatoire')
              .select(`
                type_intervention_id,
                types_intervention(id, nom)
              `)
              .eq('id', need.planning_genere_bloc_operatoire_id)
              .single();

            if (blocData) {
              typeInterventionId = blocData.type_intervention_id;
              typeInterventionNom = (blocData.types_intervention as any)?.nom;
              
              // Récupérer les besoins en personnel pour ce type d'intervention
              besoinsPersonnel = await fetchBesoinsBlocOperatoire(typeInterventionId);
            }
          }

          grouped.set(key, {
            date: need.date,
            site_id: need.site_id,
            site_nom: need.site_nom,
            type_intervention_id: typeInterventionId,
            type_intervention_nom: typeInterventionNom,
            planning_genere_bloc_operatoire_id: need.planning_genere_bloc_operatoire_id,
            besoins_personnel: besoinsPersonnel,
            has_both_periods: false,
            total_manque: 0,
            periods: {}
          });
        }

        const aggregated = grouped.get(key)!;
        const periode = need.periode as 'matin' | 'apres_midi';
        
        // Ne PAS générer les suggestions ici, juste stocker les infos de base
        if (aggregated.besoins_personnel && aggregated.besoins_personnel.length > 0) {
          for (const besoin of aggregated.besoins_personnel) {
            // Initialiser avec des tableaux vides
            if (periode === 'matin') {
              besoin.suggestions_matin = {
                suggestions_admin: [],
                suggestions_not_working: []
              };
            } else {
              besoin.suggestions_apres_midi = {
                suggestions_admin: [],
                suggestions_not_working: []
              };
            }
            besoin.nombre_manquant = besoin.nombre_requis;
          }
        } else {
          // Cas site normal
          aggregated.periods[periode] = {
            manque: need.nombre_manquant,
            suggestions_admin: [],
            suggestions_not_working: []
          };
        }

        aggregated.total_manque += need.nombre_manquant;
      }

      // Marquer les besoins avec les deux périodes
      grouped.forEach(need => {
        need.has_both_periods = !!need.periods.matin && !!need.periods.apres_midi;
        // Initialiser full_day_suggestions vide
        if (need.has_both_periods && !need.besoins_personnel) {
          need.full_day_suggestions = {
            suggestions_admin: [],
            suggestions_not_working: []
          };
        }
      });

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

        // Récupérer qui est assigné à un SITE (pas admin) pour exclure
        const { data: assignedToSites } = await supabase
          .from('capacite_effective')
          .select('secretaire_id')
          .eq('date', date)
          .neq('site_id', '00000000-0000-0000-0000-000000000001')
          .eq('actif', true)
          .in('demi_journee', ['matin', 'apres_midi']);

        const assignedToSiteIds = [...new Set(assignedToSites?.map(a => a.secretaire_id) || [])];

        // Catégorie 2: Ne travaille pas du tout avec compétence site
        const { data: allSecretaires } = await supabase
          .from('secretaires')
          .select('id, first_name, name, secretaires_sites(site_id, priorite)')
          .eq('actif', true);

        for (const s of allSecretaires || []) {
          if (assignedToSiteIds.includes(s.id)) continue;
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
        // Pour les besoins opératoires: vérifier qui est assigné à un site ou un autre besoin opératoire
        const { data: alreadyAssignedOther } = await supabase
          .from('capacite_effective')
          .select('secretaire_id, site_id, besoin_operation_id')
          .eq('date', date)
          .eq('demi_journee', periode)
          .eq('actif', true);
        
        // Exclure seulement celles assignées à un site (pas admin) ou à un autre besoin opératoire
        const assignedToOtherIds = alreadyAssignedOther
          ?.filter(a => 
            (a.site_id !== '00000000-0000-0000-0000-000000000001') ||
            (a.besoin_operation_id && a.besoin_operation_id !== besoinOperationId)
          )
          .map(a => a.secretaire_id) || [];
        
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
          if (assignedToOtherIds.includes(as.secretaire_id)) continue;
          
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

        // Récupérer tous ceux qui travaillent cette période
        const { data: allWorking } = await supabase
          .from('capacite_effective')
          .select('secretaire_id')
          .eq('date', date)
          .eq('demi_journee', periode)
          .eq('actif', true);
        
        const allWorkingIds = allWorking?.map(a => a.secretaire_id) || [];

        for (const s of allSecretaires || []) {
          if (allWorkingIds.includes(s.id)) continue;
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
        // Pour site: identifier les secrétaires déjà assignées sur un site NON-ADMINISTRATIF
        const { data: nonAdminAssignments } = await supabase
          .from('capacite_effective')
          .select('secretaire_id')
          .eq('date', date)
          .eq('demi_journee', periode)
          .neq('site_id', '00000000-0000-0000-0000-000000000001')
          .eq('actif', true);

        const assignedNonAdminIds = new Set(
          nonAdminAssignments?.map((a) => a.secretaire_id).filter(Boolean) || []
        );
        
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
          // Exclure uniquement si assignée à un site non-admin
          if (assignedNonAdminIds.has(as.secretaire_id)) continue;
          
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
    need: AggregatedNeed | any,
    periode: 'matin' | 'apres_midi',
    suggestion: SecretaireSuggestion,
    fullDay: boolean = false
  ) => {
    const besoinOperationId = (need as any).besoin_operation_id;
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
          besoin_operation_id: besoinOperationId,
          planning_genere_bloc_operatoire_id: need.planning_genere_bloc_operatoire_id,
        });

        const { error } = await supabase
          .from('capacite_effective')
          .insert({
            date: need.date,
            secretaire_id: suggestion.secretaire_id,
            demi_journee: p,
            site_id: need.site_id,
            besoin_operation_id: besoinOperationId || null,
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

  const loadSuggestionsForDropdown = async (
    need: AggregatedNeed,
    periode: 'matin' | 'apres_midi' | 'fullday',
    besoinOperationId?: string
  ) => {
    const key = `${need.date}-${periode}-${need.site_id}-${besoinOperationId || 'site'}`;
    
    if (loadedSuggestions.has(key)) return;
    
    setLoadingSuggestions(prev => new Set(prev).add(key));
    
    try {
      if (periode === 'fullday') {
        const { admin, notWorking } = await generateFullDaySuggestions(
          need.date,
          need.site_id,
          besoinOperationId
        );
        
        setAggregatedNeeds(prev => prev.map(n => 
          n.date === need.date && n.site_id === need.site_id
            ? { ...n, full_day_suggestions: { suggestions_admin: admin, suggestions_not_working: notWorking } }
            : n
        ));
      } else {
        const { admin, notWorking } = await generateSuggestions(
          need.date,
          periode,
          need.site_id,
          besoinOperationId
        );
        
        setAggregatedNeeds(prev => prev.map(n => {
          if (n.date === need.date && n.site_id === need.site_id) {
            if (besoinOperationId && n.besoins_personnel) {
              return {
                ...n,
                besoins_personnel: n.besoins_personnel.map(b =>
                  b.besoin_operation_id === besoinOperationId
                    ? {
                        ...b,
                        [periode === 'matin' ? 'suggestions_matin' : 'suggestions_apres_midi']: {
                          suggestions_admin: admin,
                          suggestions_not_working: notWorking
                        }
                      }
                    : b
                )
              };
            } else {
              return {
                ...n,
                periods: {
                  ...n.periods,
                  [periode]: {
                    manque: n.periods[periode]?.manque || 0,
                    suggestions_admin: admin,
                    suggestions_not_working: notWorking
                  }
                }
              };
            }
          }
          return n;
        }));
      }
      
      setLoadedSuggestions(prev => new Set(prev).add(key));
    } finally {
      setLoadingSuggestions(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const handleTestOptimization = async (date: string) => {
    setTestingDays(prev => new Set(prev).add(date));
    
    try {
      const { data, error } = await supabase.functions.invoke('optimize-planning-dry-run', {
        body: { date }
      });

      if (error) throw error;

      setTestResult(data);
      setTestDialogOpen(true);

      if (data.all_needs_satisfied && data.changes.length > 0) {
        toast.success(`Solution parfaite trouvée avec ${data.changes.length} modification(s) !`);
      } else if (data.feasible) {
        toast.warning('Solution partielle trouvée');
      } else {
        toast.error('Aucune solution trouvée');
      }
    } catch (error) {
      console.error('Test optimization error:', error);
      toast.error('Erreur lors du test d\'optimisation');
    } finally {
      setTestingDays(prev => {
        const next = new Set(prev);
        next.delete(date);
        return next;
      });
    }
  };

  const handleApplyOptimization = async () => {
    if (!testResult) return;

    setApplyingOptimization(true);
    
    try {
      const date = testResult.after.assignments[0]?.date || 
                   testResult.before.assignments[0]?.date;
      
      if (!date) {
        throw new Error('Date not found in test result');
      }

      const { error } = await supabase.functions.invoke('optimize-secretary-assignments-v2', {
        body: { dates: [date] }
      });

      if (error) throw error;

      toast.success('Optimisation appliquée avec succès !');
      setTestDialogOpen(false);
      setTestResult(null);
      
      setTimeout(() => {
        if (onRefresh) onRefresh();
        fetchUnfilledNeeds();
      }, 1000);
    } catch (error) {
      console.error('Apply optimization error:', error);
      toast.error('Erreur lors de l\'application de l\'optimisation');
    } finally {
      setApplyingOptimization(false);
    }
  };

  const handleOptimize = () => {
    toast.info('Optimisation automatique : fonctionnalité en développement');
  };

  useEffect(() => {
    fetchUnfilledNeedsCount();
  }, [startDate, endDate]);

  useEffect(() => {
    if (isOpen) {
      fetchUnfilledNeeds();
    }
  }, [isOpen, startDate, endDate]);

  if (loading && !isOpen) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (totalCount === 0 && !isOpen) {
    return null;
  }

  // Vue simple quand fermé
  if (!isOpen) {
    return (
      <>
        <Card className="rounded-xl overflow-hidden bg-card/50 backdrop-blur-xl border border-border/50 shadow-lg hover:shadow-xl transition-all cursor-pointer mb-6" onClick={() => setIsOpen(true)}>
          <div className="flex items-center gap-3 p-4 bg-gradient-to-r from-primary/5 to-transparent">
            <AlertCircle className="h-5 w-5 text-primary" />
            <h3 className="text-base font-semibold">Besoins non satisfaits</h3>
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
                {totalCount}
              </Badge>
            )}
          </div>
        </Card>

        <OptimizationTestDialog
          open={testDialogOpen}
          onOpenChange={setTestDialogOpen}
          date={testResult?.after?.assignments?.[0]?.date || testResult?.before?.assignments?.[0]?.date || ''}
          result={testResult}
          onApply={handleApplyOptimization}
          isApplying={applyingOptimization}
        />
      </>
    );
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

    const needKey = `${need.date}-${need.site_id}-${need.planning_genere_bloc_operatoire_id || 'site'}`;
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
              onOpenChange={(open) => {
                if (open) {
                  loadSuggestionsForDropdown(need, 'fullday', undefined);
                }
              }}
            >
              <SelectTrigger className="w-full bg-background">
                <SelectValue placeholder="Sélectionner une secrétaire..." />
              </SelectTrigger>
              <SelectContent className="bg-background z-50">
                {loadingSuggestions.has(`${need.date}-fullday-${need.site_id}-site`) ? (
                  <div className="flex items-center justify-center p-4">
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    <span className="text-sm">Chargement...</span>
                  </div>
                ) : (
                  <>
                {/* Secrétaires en administratif */}
                {need.full_day_suggestions.suggestions_admin.length > 0 && (
                  <>
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                      En administratif
                    </div>
                    {need.full_day_suggestions.suggestions_admin.map(sug => (
                      <SelectItem key={sug.secretaire_id} value={sug.secretaire_id}>
                        <span>{sug.secretaire_nom}</span>
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
                        <span>{sug.secretaire_nom}</span>
                      </SelectItem>
                    ))}
                  </>
                )}
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
            onOpenChange={(open) => {
              if (open) {
                loadSuggestionsForDropdown(need, periode, undefined);
              }
            }}
          >
            <SelectTrigger className="w-full bg-background">
              <SelectValue placeholder="Sélectionner une secrétaire..." />
            </SelectTrigger>
            <SelectContent className="bg-background z-50">
              {loadingSuggestions.has(`${need.date}-${periode}-${need.site_id}-site`) ? (
                <div className="flex items-center justify-center p-4">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  <span className="text-sm">Chargement...</span>
                </div>
              ) : (
                <>
              {/* Secrétaires en administratif */}
              {periodData.suggestions_admin.length > 0 && (
                <>
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                    En administratif
                  </div>
                  {periodData.suggestions_admin.map(sug => (
                    <SelectItem key={sug.secretaire_id} value={sug.secretaire_id}>
                      <span>{sug.secretaire_nom}</span>
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
                      <span>{sug.secretaire_nom}</span>
                    </SelectItem>
                  ))}
                </>
              )}
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
      </div>
    );
  };

  // Vue détaillée quand ouvert
  return (
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

      <div className="p-6 space-y-6">{loading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {Array.from(needsByDate.entries()).map(([date, needs]) => (
              <div key={date} className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    {format(new Date(date), 'EEEE dd MMMM yyyy', { locale: fr })}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleTestOptimization(date)}
                    disabled={testingDays.has(date)}
                    className="gap-2"
                  >
                    <Sparkles className="h-4 w-4" />
                    {testingDays.has(date) ? 'Test en cours...' : 'Tester l\'optimisation'}
                  </Button>
                </div>

                {needs.map(need => {
                  const needKey = `${need.date}-${need.site_id}-${need.planning_genere_bloc_operatoire_id || 'site'}`;
                  
                  return (
                    <div key={needKey} className="space-y-3">
                      {/* Cas BLOC OPÉRATOIRE avec besoins personnel détaillés */}
                          {need.besoins_personnel && need.besoins_personnel.length > 0 ? (
                        <div className="space-y-4">
                          <div className="p-3 rounded-lg bg-card border border-border/50">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{need.site_nom}</span>
                            </div>
                          </div>
                          {need.besoins_personnel.map(besoin => (
                            <div key={besoin.besoin_operation_id} className="ml-4 space-y-3 p-4 rounded-lg bg-card border border-border/50">
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className="bg-background">
                                  {besoin.besoin_operation_nom}
                                </Badge>
                                <span className="text-sm text-muted-foreground">
                                  {besoin.nombre_requis} requis
                                </span>
                                {besoin.nombre_manquant > 0 && (
                                  <Badge variant="destructive" className="text-xs">
                                    {besoin.nombre_manquant} manquant
                                  </Badge>
                                )}
                              </div>

                              {/* Suggestions matin */}
                              {besoin.suggestions_matin && (
                                <div className="space-y-2">
                                  <Badge variant="default" className="text-xs">Matin</Badge>
                                  <Select
                                    value={selectedSecretaire[`${needKey}-${besoin.besoin_operation_id}-matin`] || ""}
                                    onValueChange={(value) => {
                                      setSelectedSecretaire(prev => ({ 
                                        ...prev, 
                                        [`${needKey}-${besoin.besoin_operation_id}-matin`]: value 
                                      }));
                                    }}
                                    onOpenChange={(open) => {
                                      if (open) {
                                        loadSuggestionsForDropdown(need, 'matin', besoin.besoin_operation_id);
                                      }
                                    }}
                                  >
                                    <SelectTrigger className="w-full bg-background">
                                      <SelectValue placeholder="Sélectionner..." />
                                    </SelectTrigger>
                                    <SelectContent className="bg-background z-50 max-h-[300px]">
                                      {loadingSuggestions.has(`${need.date}-matin-${need.site_id}-${besoin.besoin_operation_id}`) ? (
                                        <div className="flex items-center justify-center p-4">
                                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                          <span className="text-sm">Chargement...</span>
                                        </div>
                                      ) : (
                                        <>
                                      {besoin.suggestions_matin.suggestions_admin.length > 0 && (
                                        <>
                                          <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground bg-muted/50">
                                            ✓ En administratif (disponibles)
                                          </div>
                                          {besoin.suggestions_matin.suggestions_admin.map(sug => (
                                            <SelectItem key={sug.secretaire_id} value={sug.secretaire_id}>
                                              <span>{sug.secretaire_nom}</span>
                                            </SelectItem>
                                          ))}
                                        </>
                                      )}
                                      {besoin.suggestions_matin.suggestions_not_working.length > 0 && (
                                        <>
                                          <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground bg-muted/50 mt-2">
                                            + Créer un créneau (non disponibles)
                                          </div>
                                          {besoin.suggestions_matin.suggestions_not_working.map(sug => (
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
                                  {selectedSecretaire[`${needKey}-${besoin.besoin_operation_id}-matin`] && (
                                    <Button
                                      size="sm"
                                      variant="default"
                                      onClick={() => {
                                        const allSuggestions = [
                                          ...besoin.suggestions_matin!.suggestions_admin,
                                          ...besoin.suggestions_matin!.suggestions_not_working
                                        ];
                                        const sug = allSuggestions.find(s => 
                                          s.secretaire_id === selectedSecretaire[`${needKey}-${besoin.besoin_operation_id}-matin`]
                                        );
                                        if (sug) {
                                          const tempNeed = { 
                                            ...need, 
                                            site_id: need.site_id,
                                            besoin_operation_id: besoin.besoin_operation_id 
                                          } as any;
                                          handleQuickAssign(tempNeed, 'matin', sug, false);
                                          setSelectedSecretaire(prev => ({ 
                                            ...prev, 
                                            [`${needKey}-${besoin.besoin_operation_id}-matin`]: "" 
                                          }));
                                        }
                                      }}
                                      disabled={!!assigningId}
                                      className="w-full gap-2"
                                    >
                                      {assigningId ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <>
                                          <UserPlus className="h-4 w-4" />
                                          Assigner pour le matin
                                        </>
                                      )}
                                    </Button>
                                  )}
                                </div>
                              )}

                              {/* Suggestions après-midi */}
                              {besoin.suggestions_apres_midi && (
                                <div className="space-y-2">
                                  <Badge variant="secondary" className="text-xs">Après-midi</Badge>
                                  <Select
                                    value={selectedSecretaire[`${needKey}-${besoin.besoin_operation_id}-apres_midi`] || ""}
                                    onValueChange={(value) => {
                                      setSelectedSecretaire(prev => ({ 
                                        ...prev, 
                                        [`${needKey}-${besoin.besoin_operation_id}-apres_midi`]: value 
                                      }));
                                    }}
                                    onOpenChange={(open) => {
                                      if (open) {
                                        loadSuggestionsForDropdown(need, 'apres_midi', besoin.besoin_operation_id);
                                      }
                                    }}
                                  >
                                    <SelectTrigger className="w-full bg-background">
                                      <SelectValue placeholder="Sélectionner..." />
                                    </SelectTrigger>
                                    <SelectContent className="bg-background z-50 max-h-[300px]">
                                      {loadingSuggestions.has(`${need.date}-apres_midi-${need.site_id}-${besoin.besoin_operation_id}`) ? (
                                        <div className="flex items-center justify-center p-4">
                                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                          <span className="text-sm">Chargement...</span>
                                        </div>
                                      ) : (
                                        <>
                                      {besoin.suggestions_apres_midi.suggestions_admin.length > 0 && (
                                        <>
                                          <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground bg-muted/50">
                                            ✓ En administratif (disponibles)
                                          </div>
                                          {besoin.suggestions_apres_midi.suggestions_admin.map(sug => (
                                            <SelectItem key={sug.secretaire_id} value={sug.secretaire_id}>
                                              <span>{sug.secretaire_nom}</span>
                                            </SelectItem>
                                          ))}
                                        </>
                                      )}
                                      {besoin.suggestions_apres_midi.suggestions_not_working.length > 0 && (
                                        <>
                                          <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground bg-muted/50 mt-2">
                                            + Créer un créneau (non disponibles)
                                          </div>
                                          {besoin.suggestions_apres_midi.suggestions_not_working.map(sug => (
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
                                  {selectedSecretaire[`${needKey}-${besoin.besoin_operation_id}-apres_midi`] && (
                                    <Button
                                      size="sm"
                                      variant="default"
                                      onClick={() => {
                                        const allSuggestions = [
                                          ...besoin.suggestions_apres_midi!.suggestions_admin,
                                          ...besoin.suggestions_apres_midi!.suggestions_not_working
                                        ];
                                        const sug = allSuggestions.find(s => 
                                          s.secretaire_id === selectedSecretaire[`${needKey}-${besoin.besoin_operation_id}-apres_midi`]
                                        );
                                        if (sug) {
                                          const tempNeed = { 
                                            ...need, 
                                            site_id: need.site_id,
                                            besoin_operation_id: besoin.besoin_operation_id 
                                          } as any;
                                          handleQuickAssign(tempNeed, 'apres_midi', sug, false);
                                          setSelectedSecretaire(prev => ({ 
                                            ...prev, 
                                            [`${needKey}-${besoin.besoin_operation_id}-apres_midi`]: "" 
                                          }));
                                        }
                                      }}
                                      disabled={!!assigningId}
                                      className="w-full gap-2"
                                    >
                                      {assigningId ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <>
                                          <UserPlus className="h-4 w-4" />
                                          Assigner pour l'après-midi
                                        </>
                                      )}
                                    </Button>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : need.has_both_periods ? (
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
          </>
        )}
      </div>

      <OptimizationTestDialog
        open={testDialogOpen}
        onOpenChange={setTestDialogOpen}
        date={testResult?.after?.assignments?.[0]?.date || testResult?.before?.assignments?.[0]?.date || ''}
        result={testResult}
        onApply={handleApplyOptimization}
        isApplying={applyingOptimization}
      />
    </Card>
  );
};
