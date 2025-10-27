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
import { DryRunOptimizationDialog } from './DryRunOptimizationDialog';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

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
  planning_genere_bloc_id: string;
  besoin_operation_id: string;
  besoin_operation_nom: string;
  medecin_nom: string;
  type_intervention_nom: string;
  nombre_requis: number;
  deficit: number;
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
  type_besoin?: string;
  secretaires_assignees?: SecretaireAssignee[];
}

interface SecretaireAssignee {
  secretaire_id: string;
  nom_complet: string;
  is_1r: boolean;
  is_2f: boolean;
  is_3f: boolean;
  capacite_matin_id: string;
  capacite_apres_midi_id: string;
}

interface UnfilledNeedsPanelProps {
  startDate: string;
  endDate: string;
  onRefresh?: () => void;
  isOpen?: boolean;
}

export const UnfilledNeedsPanel = ({ startDate, endDate, onRefresh, isOpen: initialIsOpen = false }: UnfilledNeedsPanelProps) => {
  const [aggregatedNeeds, setAggregatedNeeds] = useState<AggregatedNeed[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(initialIsOpen);
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
  const [testedDate, setTestedDate] = useState<string | null>(null);
  const [dryRunResult, setDryRunResult] = useState<any>(null);
  const [dryRunDialogOpen, setDryRunDialogOpen] = useState(false);
  const [dryRunLoading, setDryRunLoading] = useState(false);
  const [dryRunDate, setDryRunDate] = useState<string | null>(null);
  const [togglingRole, setTogglingRole] = useState<string | null>(null);
  const [applyingDryRun, setApplyingDryRun] = useState(false);

  const fetchSecretairesAssignees = async (date: string, siteId: string): Promise<SecretaireAssignee[]> => {
    try {
      // Récupérer les capacités du matin
      const { data: capacitesMatin, error: errorMatin } = await supabase
        .from('capacite_effective')
        .select(`
          id,
          secretaire_id,
          is_1r,
          is_2f,
          is_3f,
          secretaires (
            id,
            first_name,
            name
          )
        `)
        .eq('date', date)
        .eq('site_id', siteId)
        .eq('demi_journee', 'matin')
        .eq('actif', true);

      if (errorMatin) throw errorMatin;

      // Récupérer les capacités de l'après-midi
      const { data: capacitesAM, error: errorAM } = await supabase
        .from('capacite_effective')
        .select(`
          id,
          secretaire_id,
          is_1r,
          is_2f,
          is_3f
        `)
        .eq('date', date)
        .eq('site_id', siteId)
        .eq('demi_journee', 'apres_midi')
        .eq('actif', true);

      if (errorAM) throw errorAM;

      // Créer un Map des capacités AM par secretaire_id
      const amMap = new Map(
        capacitesAM?.map(c => [c.secretaire_id, c]) || []
      );

      // Filtrer pour ne garder que celles présentes toute la journée
      const assignees: SecretaireAssignee[] = [];
      
      for (const capMatin of capacitesMatin || []) {
        const capAM = amMap.get(capMatin.secretaire_id);
        if (capAM && capMatin.secretaire_id) {
          const sec = (capMatin as any).secretaires;
          assignees.push({
            secretaire_id: capMatin.secretaire_id,
            nom_complet: `${sec.first_name} ${sec.name}`.trim(),
            is_1r: capMatin.is_1r || capAM.is_1r,
            is_2f: capMatin.is_2f || capAM.is_2f,
            is_3f: capMatin.is_3f || capAM.is_3f,
            capacite_matin_id: capMatin.id,
            capacite_apres_midi_id: capAM.id
          });
        }
      }

      return assignees;
    } catch (error) {
      console.error('Error fetching assignees:', error);
      return [];
    }
  };

  const handleDryRunApply = async () => {
    setApplyingDryRun(true);
    try {
      // Recharger les besoins non satisfaits
      await fetchUnfilledNeeds();
      
      // Recharger le dashboard
      onRefresh?.();
      
      // Fermer le dialog
      setDryRunDialogOpen(false);
      
      toast.success('Changements appliqués et données rafraîchies');
    } catch (error) {
      console.error('Error refreshing data:', error);
    } finally {
      setApplyingDryRun(false);
    }
  };

  const fetchUnfilledNeedsCount = async () => {
    setLoading(true);
    try {
      // Sommer les déficits depuis les 3 vues séparées
      const [sitesResult, blocResult, fermetureResult] = await Promise.all([
        supabase
          .from('besoins_sites_summary')
          .select('deficit')
          .gte('date', startDate)
          .lte('date', endDate)
          .gt('deficit', 0),
        supabase
          .from('besoins_bloc_operatoire_summary')
          .select('deficit')
          .gte('date', startDate)
          .lte('date', endDate)
          .gt('deficit', 0),
        supabase
          .from('besoins_fermeture_summary')
          .select('deficit')
          .gte('date', startDate)
          .lte('date', endDate)
          .gt('deficit', 0)
      ]);
      
      if (sitesResult.error) throw sitesResult.error;
      if (blocResult.error) throw blocResult.error;
      if (fermetureResult.error) throw fermetureResult.error;
      
      const sitesDeficit = sitesResult.data?.reduce((sum, row) => sum + (row.deficit || 0), 0) || 0;
      const blocDeficit = blocResult.data?.reduce((sum, row) => sum + (row.deficit || 0), 0) || 0;
      const fermetureDeficit = fermetureResult.data?.reduce((sum, row) => sum + (row.deficit || 0), 0) || 0;
      const total = sitesDeficit + blocDeficit + fermetureDeficit;
      setTotalCount(total);
    } catch (error) {
      console.error('Error fetching count:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchUnfilledNeeds = async () => {
    setLoading(true);
    try {
      // Récupérer les données des 3 vues en parallèle
      const [sitesResult, blocResult, fermetureResult] = await Promise.all([
        supabase
          .from('besoins_sites_summary')
          .select('*')
          .gte('date', startDate)
          .lte('date', endDate)
          .gt('deficit', 0)
          .order('date', { ascending: true })
          .order('demi_journee', { ascending: true }),
        supabase
          .from('besoins_bloc_operatoire_summary')
          .select('*')
          .gte('date', startDate)
          .lte('date', endDate)
          .gt('deficit', 0)
          .order('date', { ascending: true })
          .order('demi_journee', { ascending: true }),
        supabase
          .from('besoins_fermeture_summary')
          .select('*')
          .gte('date', startDate)
          .lte('date', endDate)
          .gt('deficit', 0)
          .order('date', { ascending: true })
      ]);

      if (sitesResult.error) throw sitesResult.error;
      if (blocResult.error) throw blocResult.error;
      if (fermetureResult.error) throw fermetureResult.error;

      // Agréger les besoins par date + site + planning_bloc_id
      const grouped = new Map<string, AggregatedNeed>();

      // 1. Traiter les besoins SITES
      for (const need of sitesResult.data || []) {
        const key = `${need.date}-site-${need.site_id}`;
        
        if (!grouped.has(key)) {
          grouped.set(key, {
            date: need.date,
            site_id: need.site_id,
            site_nom: need.site_nom,
            has_both_periods: false,
            total_manque: 0,
            periods: {},
            type_besoin: 'site'
          });
        }

        const aggregated = grouped.get(key)!;
        const periode = need.demi_journee as 'matin' | 'apres_midi';
        
        aggregated.periods[periode] = {
          manque: need.deficit,
          suggestions_admin: [],
          suggestions_not_working: []
        };
        aggregated.total_manque += need.deficit;
      }

      // 2. Traiter les besoins BLOC OPÉRATOIRE
      for (const need of blocResult.data || []) {
        const key = `${need.date}-bloc-${need.type_intervention_id}-${need.medecin_id}`;
        
        if (!grouped.has(key)) {
          // Récupérer le site du bloc opératoire
          const { data: blocSite } = await supabase
            .from('sites')
            .select('id, nom')
            .eq('nom', 'Clinique La Vallée - Bloc opératoire')
            .single();

          grouped.set(key, {
            date: need.date,
            site_id: blocSite?.id || '',
            site_nom: 'Clinique La Vallée - Bloc opératoire',
            planning_genere_bloc_operatoire_id: `${need.type_intervention_id}-${need.medecin_id}`,
            besoins_personnel: [],
            has_both_periods: false,
            total_manque: 0,
            periods: {},
            type_besoin: 'bloc_operatoire'
          });
        }

        const aggregated = grouped.get(key)!;
        const periode = need.demi_journee as 'matin' | 'apres_midi';
        
        // Trouver ou créer le besoin personnel
        let besoinPersonnel = aggregated.besoins_personnel?.find(
          b => b.besoin_operation_id === need.besoin_operation_id
        );

        if (!besoinPersonnel) {
          besoinPersonnel = {
            planning_genere_bloc_id: need.planning_genere_bloc_id,
            besoin_operation_id: need.besoin_operation_id,
            besoin_operation_nom: need.besoin_operation_nom,
            medecin_nom: need.medecin_nom,
            type_intervention_nom: need.type_intervention_nom,
            nombre_requis: need.nombre_requis,
            deficit: 0
          };
          aggregated.besoins_personnel?.push(besoinPersonnel);
        }

        // Ajouter les suggestions vides pour cette période
        if (periode === 'matin') {
          besoinPersonnel.suggestions_matin = {
            suggestions_admin: [],
            suggestions_not_working: []
          };
        } else {
          besoinPersonnel.suggestions_apres_midi = {
            suggestions_admin: [],
            suggestions_not_working: []
          };
        }

        // Cumuler le déficit
        besoinPersonnel.deficit += need.deficit;
        aggregated.total_manque += need.deficit;
      }

      // 3. Traiter les besoins FERMETURE
      for (const need of fermetureResult.data || []) {
        const key = `${need.date}-fermeture-${need.site_id}`;
        
        grouped.set(key, {
          date: need.date,
          site_id: need.site_id,
          site_nom: need.site_nom,
          has_both_periods: true,
          total_manque: need.deficit,
          periods: {},
          type_besoin: 'fermeture',
          secretaires_assignees: await fetchSecretairesAssignees(need.date, need.site_id)
        });
      }

      // Marquer les besoins avec les deux périodes et initialiser full_day_suggestions
      grouped.forEach(need => {
        if (need.type_besoin !== 'fermeture' && need.type_besoin !== 'bloc_operatoire') {
          need.has_both_periods = !!need.periods.matin && !!need.periods.apres_midi;
          if (need.has_both_periods) {
            need.full_day_suggestions = {
              suggestions_admin: [],
              suggestions_not_working: []
            };
          }
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
        // Pour site: identifier les assistants médicaux déjà assignés sur un site NON-ADMINISTRATIF
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
          planning_genere_bloc_id: need.planning_genere_bloc_operatoire_id,
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
      setTestedDate(date);
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

  const handleDryRunOptimization = async (date: string) => {
    setDryRunLoading(true);
    setDryRunDate(date);
    setDryRunDialogOpen(true);
    setDryRunResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('optimize-planning-dry-run', {
        body: { date }
      });

      if (error) throw error;

      setDryRunResult(data);
    } catch (error) {
      console.error('Error running dry run optimization:', error);
      toast.error('Erreur lors de l\'optimisation dry run');
      setDryRunDialogOpen(false);
    } finally {
      setDryRunLoading(false);
    }
  };

  const handleApplyOptimization = async () => {
    if (!testResult || !testedDate) {
      toast.error('Aucune date de test disponible');
      return;
    }

    setApplyingOptimization(true);
    
    try {
      const { error } = await supabase.functions.invoke('optimize-secretary-assignments-v2', {
        body: { dates: [testedDate] }
      });

      if (error) throw error;

      toast.success('Optimisation appliquée avec succès !');
      setTestDialogOpen(false);
      setTestResult(null);
      setTestedDate(null);
      
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

  const handleToggleRole = async (
    need: AggregatedNeed,
    assignee: SecretaireAssignee,
    role: '1r' | '2f' | '3f'
  ) => {
    const key = `${need.date}-${assignee.secretaire_id}-${role}`;
    setTogglingRole(key);

    try {
      const newValue = role === '1r' ? !assignee.is_1r : role === '2f' ? !assignee.is_2f : !assignee.is_3f;

      // Mettre à jour les deux capacités (matin et après-midi)
      const updates = [
        supabase
          .from('capacite_effective')
          .update({ [`is_${role}`]: newValue })
          .eq('id', assignee.capacite_matin_id),
        supabase
          .from('capacite_effective')
          .update({ [`is_${role}`]: newValue })
          .eq('id', assignee.capacite_apres_midi_id)
      ];

      const results = await Promise.all(updates);
      
      if (results.some(r => r.error)) {
        throw results.find(r => r.error)?.error;
      }

      // Rafraîchir les vues matérialisées
      await supabase.rpc('refresh_all_besoins_summaries');

      toast.success(`Rôle ${role.toUpperCase()} ${newValue ? 'assigné' : 'retiré'}`);
      
      // Recharger les besoins non satisfaits
      await fetchUnfilledNeeds();
      onRefresh?.();
    } catch (error: any) {
      console.error('Error toggling role:', error);
      toast.error(error.message || 'Erreur lors de la modification du rôle');
    } finally {
      setTogglingRole(null);
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
            <Badge variant="destructive" className="text-xs ml-auto">
              {Math.ceil(need.total_manque / 2)} manquant
            </Badge>
          </div>
        </div>

        {/* Suggestions pour journée entière - interface simplifiée */}
        <div className="ml-4 p-4 rounded-lg border space-y-4">
          <div className="space-y-3">
            <h4 className="text-sm font-medium">Créer une journée entière</h4>
            
            {/* Dropdown pour sélectionner l'assistant médical */}
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
                <SelectValue placeholder="Sélectionner un assistant médical..." />
              </SelectTrigger>
              <SelectContent className="bg-background z-50">
                {loadingSuggestions.has(`${need.date}-fullday-${need.site_id}-site`) ? (
                  <div className="flex items-center justify-center p-4">
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    <span className="text-sm">Chargement...</span>
                  </div>
                ) : (
                  <>
                {/* Assistants médicaux en administratif */}
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
                
                {/* Assistants médicaux non disponibles */}
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
            <Badge variant={periode === 'matin' ? 'default' : 'outline'} className={periode === 'apres_midi' ? 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20' : ''}>
              {periode === 'matin' ? 'Matin' : 'Après-midi'}
            </Badge>
            <Badge variant="destructive" className="text-xs ml-auto">
              {periodData.manque} manquant
            </Badge>
          </div>
        </div>

        <div className="space-y-3">
          <h4 className="text-sm font-medium">Assigner pour {periode === 'matin' ? 'le matin' : 'l\'après-midi'}</h4>
          
          {/* Dropdown pour sélectionner l'assistant médical */}
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
              <SelectValue placeholder="Sélectionner un assistant médical..." />
            </SelectTrigger>
            <SelectContent className="bg-background z-50">
              {loadingSuggestions.has(`${need.date}-${periode}-${need.site_id}-site`) ? (
                <div className="flex items-center justify-center p-4">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  <span className="text-sm">Chargement...</span>
                </div>
              ) : (
                <>
              {/* Assistants médicaux en administratif */}
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
              
              {/* Assistants médicaux non disponibles */}
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
                    onClick={() => handleDryRunOptimization(date)}
                    disabled={dryRunLoading && dryRunDate === date}
                    className="gap-2"
                  >
                    {dryRunLoading && dryRunDate === date ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Analyse...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" />
                        Optimiser
                      </>
                    )}
                  </Button>
                </div>

                {needs
                  .filter(need => {
                    // Pour les blocs opératoires, vérifier qu'il y a au moins un besoin manquant
                    if (need.besoins_personnel && need.besoins_personnel.length > 0) {
                      return need.besoins_personnel.some(besoin => besoin.deficit > 0);
                    }
                    // Pour les sites normaux, vérifier qu'il y a des besoins manquants
                    return need.total_manque > 0;
                  })
                  .map(need => {
                    const needKey = `${need.date}-${need.site_id}-${need.planning_genere_bloc_operatoire_id || need.type_besoin || 'site'}`;
                    
                    return (
                      <div key={needKey} className="space-y-3">
                        {/* Cas spécial : Rôles de fermeture manquants (1R/2F/3F) */}
                        {need.type_besoin === 'fermeture' ? (
                          <div className="space-y-4">
                            <div className="p-3 rounded-lg bg-card border border-border/50">
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{need.site_nom}</span>
                                <Badge variant="outline" className="ml-auto">
                                  {need.total_manque} responsable{need.total_manque > 1 ? 's' : ''} manquant{need.total_manque > 1 ? 's' : ''}
                                </Badge>
                              </div>
                            </div>

                            {/* Liste des secrétaires assignées toute la journée */}
                            {need.secretaires_assignees && need.secretaires_assignees.length > 0 ? (
                              <div className="ml-4 p-4 rounded-lg border space-y-3">
                                <h4 className="text-sm font-medium">
                                  Assistants médicaux assignés toute la journée ({need.secretaires_assignees.length})
                                </h4>
                                <div className="space-y-2">
                                  {need.secretaires_assignees.map(assignee => (
                                    <div 
                                      key={assignee.secretaire_id}
                                      className="flex items-center justify-between p-3 rounded-lg bg-background border border-border"
                                    >
                                      <span className="font-medium">{assignee.nom_complet}</span>
                                      <div className="flex items-center gap-4">
                                        {/* Toggle 1R */}
                                        <div className="flex items-center gap-2">
                                          <Label htmlFor={`${assignee.secretaire_id}-1r`} className="text-xs">
                                            1R
                                          </Label>
                                          <Switch
                                            id={`${assignee.secretaire_id}-1r`}
                                            checked={assignee.is_1r}
                                            onCheckedChange={() => handleToggleRole(need, assignee, '1r')}
                                            disabled={!!togglingRole}
                                          />
                                        </div>

                                        {/* Toggle 2F */}
                                        <div className="flex items-center gap-2">
                                          <Label htmlFor={`${assignee.secretaire_id}-2f`} className="text-xs">
                                            2F
                                          </Label>
                                          <Switch
                                            id={`${assignee.secretaire_id}-2f`}
                                            checked={assignee.is_2f}
                                            onCheckedChange={() => handleToggleRole(need, assignee, '2f')}
                                            disabled={!!togglingRole}
                                          />
                                        </div>

                                        {/* Toggle 3F */}
                                        <div className="flex items-center gap-2">
                                          <Label htmlFor={`${assignee.secretaire_id}-3f`} className="text-xs">
                                            3F
                                          </Label>
                                          <Switch
                                            id={`${assignee.secretaire_id}-3f`}
                                            checked={assignee.is_3f}
                                            onCheckedChange={() => handleToggleRole(need, assignee, '3f')}
                                            disabled={!!togglingRole}
                                          />
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : (
                              <div className="ml-4 p-4 rounded-lg border">
                                <div className="text-sm text-muted-foreground">
                                  Aucun assistant médical assigné toute la journée à ce site.
                                </div>
                              </div>
                            )}
                          </div>
                      ) : need.besoins_personnel && need.besoins_personnel.length > 0 ? (
                        /* Cas BLOC OPÉRATOIRE avec besoins personnel détaillés */
                        <div className="space-y-4">
                          <div className="p-3 rounded-lg bg-card border border-border/50">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-xs">Opération</Badge>
                              <span className="font-medium">{need.site_nom}</span>
                            </div>
                          </div>
                          {need.besoins_personnel
                            .filter(besoin => besoin.deficit > 0)
                            .map(besoin => (
                            <div key={besoin.besoin_operation_id} className="ml-4 space-y-3 p-4 rounded-lg bg-card border border-border/50">
                              <div className="flex items-center gap-2 flex-wrap">
                                <div className="flex flex-col gap-1 flex-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-medium">{besoin.medecin_nom}</span>
                                    <span className="text-sm text-muted-foreground">•</span>
                                    <Badge variant="outline">
                                      {besoin.type_intervention_nom}
                                    </Badge>
                                    <span className="text-sm text-muted-foreground">•</span>
                                    <Badge variant="secondary">
                                      {besoin.besoin_operation_nom}
                                    </Badge>
                                  </div>
                                </div>
                                 <div className="flex items-center gap-2">
                                   {besoin.deficit > 0 && (
                                     <Badge variant="destructive" className="text-xs">
                                       {besoin.deficit} manquant
                                     </Badge>
                                   )}
                                 </div>
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
                                            besoin_operation_id: besoin.besoin_operation_id,
                                            planning_genere_bloc_operatoire_id: besoin.planning_genere_bloc_id
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
                                            besoin_operation_id: besoin.besoin_operation_id,
                                            planning_genere_bloc_operatoire_id: besoin.planning_genere_bloc_id
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
                      ) : need.type_besoin === 'site' ? (
                        /* Cas SITE - avec journée entière OU périodes uniques */
                        need.has_both_periods ? (
                          renderFullDayNeed(need)
                        ) : (
                          <>
                            <div className="p-3 rounded-lg bg-card border border-border/50">
                              <span className="font-medium">{need.site_nom}</span>
                            </div>
                            {need.periods.matin && renderPeriod(need, 'matin')}
                            {need.periods.apres_midi && renderPeriod(need, 'apres_midi')}
                          </>
                        )
                      ) : null}
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
        date={testedDate || testResult?.after?.assignments?.[0]?.date || testResult?.before?.assignments?.[0]?.date || ''}
        result={testResult}
        onApply={handleApplyOptimization}
        isApplying={applyingOptimization}
      />

      <DryRunOptimizationDialog
        open={dryRunDialogOpen}
        onOpenChange={setDryRunDialogOpen}
        date={dryRunDate || ''}
        result={dryRunResult}
        isLoading={dryRunLoading}
        onApply={handleDryRunApply}
        isApplying={applyingDryRun}
      />
    </Card>
  );
};
