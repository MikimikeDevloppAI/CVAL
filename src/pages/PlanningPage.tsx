import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useCanManagePlanning } from '@/hooks/useCanManagePlanning';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Building2, Users, Clock, Plus, Edit, Trash2, Loader2, Zap, FileText, CheckCircle, RefreshCw, Scissors } from 'lucide-react';
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { AddBesoinDialog } from '@/components/planning/AddBesoinDialog';
import { EditBesoinDialog } from '@/components/planning/EditBesoinDialog';
import { AddCapaciteDialog } from '@/components/planning/AddCapaciteDialog';
import { MILPOptimizationView } from '@/components/planning/MILPOptimizationView';
import { SecretaryPlanningView } from '@/components/planning/SecretaryPlanningView';
import { BlocOperatoirePlanningView } from '@/components/planning/BlocOperatoirePlanningView';
import { SitePlanningView } from '@/components/planning/SitePlanningView';
import { AddPlanningCreneauDialog } from '@/components/planning/AddPlanningCreneauDialog';
import { SecretaryCapacityView } from '@/components/planning/SecretaryCapacityView';
import { SelectDatesForOptimizationDialog } from '@/components/planning/SelectDatesForOptimizationDialog';
import { OptimizationProgressDialog } from '@/components/planning/OptimizationProgressDialog';
import { OptimizationResult } from '@/types/planning';
import { eachDayOfInterval } from 'date-fns';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface BesoinEffectif {
  id: string;
  date: string;
  type: string;
  demi_journee: 'matin' | 'apres_midi' | 'toute_journee';
  site_id: string;
  medecin_id?: string;
  type_intervention_id?: string;
  medecin?: { first_name: string; name: string; besoin_secretaires: number };
  site?: { nom: string };
  type_intervention?: { nom: string; code: string };
}

interface BesoinParSite {
  site_id: string;
  site_nom: string;
  besoins: BesoinEffectif[];
  total_medecins: number;
  total_secretaires_requis: number;
}

interface CapaciteEffective {
  id: string;
  date: string;
  demi_journee: 'matin' | 'apres_midi' | 'toute_journee';
  secretaire_id?: string;
  secretaire?: { first_name: string; name: string };
  sites?: string[];
}

export default function PlanningPage() {
  const [currentWeekStart, setCurrentWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [besoins, setBesoins] = useState<BesoinEffectif[]>([]);
  const [besoinsParSite, setBesoinsParSite] = useState<BesoinParSite[]>([]);
  const [capacites, setCapacites] = useState<CapaciteEffective[]>([]);
  const [sites, setSites] = useState<{ id: string; nom: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedSiteId, setSelectedSiteId] = useState('');
  const [selectedSiteName, setSelectedSiteName] = useState('');
  const [selectedBesoin, setSelectedBesoin] = useState<BesoinEffectif | null>(null);
  const [selectedBesoins, setSelectedBesoins] = useState<BesoinEffectif[]>([]);
  const [besoinsToDelete, setBesoinsToDelete] = useState<BesoinEffectif[]>([]);
  const [addCapaciteDialogOpen, setAddCapaciteDialogOpen] = useState(false);
  const [deleteCapaciteDialogOpen, setDeleteCapaciteDialogOpen] = useState(false);
  const [selectedCapacite, setSelectedCapacite] = useState<CapaciteEffective | null>(null);
  const [optimizationResult, setOptimizationResult] = useState<OptimizationResult | null>(null);
  const [specialites, setSpecialites] = useState<{ id: string; nom: string }[]>([]);
  const [isOptimizingMILP, setIsOptimizingMILP] = useState(false);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [generatedPdfUrl, setGeneratedPdfUrl] = useState<string | null>(null);
  const [confirmRegenerateDialogOpen, setConfirmRegenerateDialogOpen] = useState(false);
  const [planningView, setPlanningView] = useState<'site' | 'secretary'>('site');
  const [addPlanningDialogOpen, setAddPlanningDialogOpen] = useState(false);
  const [currentPlanningId, setCurrentPlanningId] = useState<string | null>(null);
  const [currentPlanningStatus, setCurrentPlanningStatus] = useState<'en_cours' | 'valide'>('en_cours');
  const [planningUpdatedAt, setPlanningUpdatedAt] = useState<string | null>(null);
  const [lastPersonnelUpdate, setLastPersonnelUpdate] = useState<string | null>(null);
  const [validatedBy, setValidatedBy] = useState<string | null>(null);
  const [validatedAt, setValidatedAt] = useState<string | null>(null);
  const [isValidatingPlanning, setIsValidatingPlanning] = useState(false);
  const [selectDatesDialogOpen, setSelectDatesDialogOpen] = useState(false);
  const [showProgressDialog, setShowProgressDialog] = useState(false);
  const [isLoadingOptimizationResults, setIsLoadingOptimizationResults] = useState(false);
  const [optimizationProgress, setOptimizationProgress] = useState({
    currentDay: 0,
    totalDays: 0,
    currentPhase: 'bloc' as 'bloc' | 'sites' | 'complete',
    currentDate: '',
    completedDays: [] as Array<{
      date: string;
      blocAssignments: number;
      sitesAssignments: number;
    }>,
    optimizeBloc: true,
    optimizeSites: true,
  });
  const { toast } = useToast();
  const { canManage } = useCanManagePlanning();

  const weekEnd = endOfWeek(currentWeekStart, { weekStartsOn: 1 });
  const weekDays = eachDayOfInterval({ start: currentWeekStart, end: weekEnd });

  useEffect(() => {
    setGeneratedPdfUrl(null); // Reset PDF URL when week changes
  }, [currentWeekStart]);

  useEffect(() => {
    fetchData();
    fetchPlanningGenere();

    // Real-time updates for besoin_effectif
    const besoinChannel = supabase
      .channel('besoin-effectif-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'besoin_effectif'
        },
        () => {
          fetchBesoins();
        }
      )
      .subscribe();

    // Real-time updates for capacite_effective
    const capaciteChannel = supabase
      .channel('capacite-effective-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'capacite_effective'
        },
        () => {
          fetchCapacites();
        }
      )
      .subscribe();

    // Real-time updates for planning_genere
    const planningChannel = supabase
      .channel('planning-genere-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'planning_genere'
        },
        () => {
          fetchPlanningGenere();
        }
      )
      .subscribe();

    // Real-time updates for planning
    const planningMetaChannel = supabase
      .channel('planning-meta-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'planning'
        },
        () => {
          fetchCurrentPlanning();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(besoinChannel);
      supabase.removeChannel(capaciteChannel);
      supabase.removeChannel(planningChannel);
      supabase.removeChannel(planningMetaChannel);
    };
  }, [currentWeekStart]);

  const fetchData = async () => {
    setLoading(true);
    try {
      await Promise.all([
        fetchSites(), 
        fetchSpecialites(), 
        fetchBesoins(), 
        fetchCapacites(), 
        fetchPlanningGenere(),
        fetchCurrentPlanning()
      ]);
    } catch (error) {
      console.error('Erreur lors du chargement des données:', error);
      toast({
        title: "Erreur",
        description: "Erreur lors du chargement des données",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchSpecialites = async () => {
    const { data, error } = await supabase
      .from('specialites')
      .select('id, nom')
      .order('nom');

    if (error) {
      console.error('Erreur lors du chargement des spécialités:', error);
      toast({
        title: "Erreur",
        description: "Impossible de charger les spécialités",
        variant: "destructive",
      });
      return;
    }

    setSpecialites(data || []);
  };

  const fetchPlanningGenere = async () => {
    // TODO: This function needs refactoring to use new planning architecture
    // (needs to query planning_genere_site_besoin and planning_genere_site_personnel)
    console.warn('fetchPlanningGenere not yet refactored for new architecture');
    setOptimizationResult(null);
  };


  const fetchCurrentPlanning = async () => {
    try {
      const { data, error } = await supabase
        .from('planning')
        .select('*')
        .eq('date_debut', format(currentWeekStart, 'yyyy-MM-dd'))
        .eq('date_fin', format(weekEnd, 'yyyy-MM-dd'))
        .maybeSingle();

      if (error) {
        console.error('Error fetching planning:', error);
        return;
      }

      if (data) {
        setCurrentPlanningId(data.id);
        setCurrentPlanningStatus(data.statut as 'en_cours' | 'valide');
        setGeneratedPdfUrl(data.pdf_url);
        setPlanningUpdatedAt(data.updated_at);
        setValidatedAt(data.validated_at);
        
        // Fetch validator profile if exists
        if (data.validated_by) {
          const { data: profileData, error: profileError } = await supabase
            .from('profiles')
            .select('prenom, nom')
            .eq('id', data.validated_by)
            .maybeSingle();
          
          if (!profileError && profileData) {
            setValidatedBy(`${profileData.prenom} ${profileData.nom}`);
          } else {
            setValidatedBy(null);
          }
        } else {
          setValidatedBy(null);
        }

        // Fetch max updated_at from planning_genere_personnel
        const { data: personnelData, error: personnelError } = await supabase
          .from('planning_genere_personnel')
          .select('updated_at, created_at')
          .eq('planning_id', data.id)
          .order('updated_at', { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle();

        if (!personnelError && personnelData) {
          setLastPersonnelUpdate(personnelData.updated_at || personnelData.created_at);
        } else {
          setLastPersonnelUpdate(null);
        }
      } else {
        setCurrentPlanningId(null);
        setCurrentPlanningStatus('en_cours');
        setGeneratedPdfUrl(null);
        setPlanningUpdatedAt(null);
        setLastPersonnelUpdate(null);
        setValidatedBy(null);
        setValidatedAt(null);
      }
    } catch (error) {
      console.error('Error fetching current planning:', error);
    }
  };

  const fetchSites = async () => {
    const { data, error } = await supabase
      .from('sites')
      .select('id, nom')
      .eq('actif', true)
      .order('nom');

    if (error) throw error;
    setSites(data || []);
  };

  const fetchBesoins = async () => {
    const { data, error } = await supabase
        .from('besoin_effectif')
        .select(`
          *,
          medecin:medecins(first_name, name, besoin_secretaires),
          site:sites(nom),
          type_intervention:types_intervention(nom, code)
        `)
        .gte('date', format(currentWeekStart, 'yyyy-MM-dd'))
        .lte('date', format(weekEnd, 'yyyy-MM-dd'))
        .eq('actif', true)
        .order('date')
        .order('demi_journee');

    if (error) throw error;
    setBesoins(data || []);
    
    if (data) {
      const groupedBySite = data.reduce((acc, besoin) => {
        const siteId = besoin.site_id;
        if (!acc[siteId]) {
          acc[siteId] = {
            site_id: siteId,
            site_nom: besoin.site?.nom || 'Site inconnu',
            besoins: [],
            total_medecins: 0,
            total_secretaires_requis: 0,
          };
        }
        
        acc[siteId].besoins.push(besoin);
        if (besoin.type === 'medecin') {
          acc[siteId].total_medecins++;
        }
        
        // Calculer le besoin selon le type
        let besoinValue = 0;
        if (besoin.medecin?.besoin_secretaires) {
          besoinValue = Number(besoin.medecin.besoin_secretaires);
        }
        acc[siteId].total_secretaires_requis += besoinValue;
        
        return acc;
      }, {} as Record<string, BesoinParSite>);
      
      setBesoinsParSite(Object.values(groupedBySite));
    }
  };

  const fetchCapacites = async () => {
    const { data, error } = await supabase
        .from('capacite_effective')
        .select(`
          *,
          secretaire:secretaires(first_name, name)
        `)
        .gte('date', format(currentWeekStart, 'yyyy-MM-dd'))
        .lte('date', format(weekEnd, 'yyyy-MM-dd'))
        .eq('actif', true)
        .order('date')
        .order('demi_journee');

    if (error) throw error;

    // Récupérer les spécialités pour enrichir les données
    if (data && data.length > 0) {
      const { data: specialitesData } = await supabase
        .from('specialites')
        .select('id, nom');

      const specialitesMap = new Map(
        specialitesData?.map(s => [s.id, s.nom]) || []
      );

      const enrichedData = data.map(capacite => {
        // Récupérer les sites depuis secretaire ou backup
        const sitesIds: string[] = []; // Using secretaires_sites now
        return {
          ...capacite,
          sites: sitesIds
        };
      });

      setCapacites(enrichedData);
    } else {
      setCapacites([]);
    }
  };

  const goToPreviousWeek = () => {
    setCurrentWeekStart(subWeeks(currentWeekStart, 1));
  };

  const goToNextWeek = () => {
    setCurrentWeekStart(addWeeks(currentWeekStart, 1));
  };

  const goToCurrentWeek = () => {
    setCurrentWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }));
  };

  const handleAddClick = (date: string, siteId: string, siteName: string) => {
    setSelectedDate(date);
    setSelectedSiteId(siteId);
    setSelectedSiteName(siteName);
    setAddDialogOpen(true);
  };

  const handleEditClick = (besoin: BesoinEffectif) => {
    setSelectedBesoin(besoin);
    setEditDialogOpen(true);
  };

  const handleDeleteClick = (besoin: BesoinEffectif) => {
    setSelectedBesoin(besoin);
    setDeleteDialogOpen(true);
  };

  const handleDeleteGroupClick = (besoins: BesoinEffectif[]) => {
    setBesoinsToDelete(besoins);
    setDeleteDialogOpen(true);
  };

  const handleDeleteCapaciteClick = (capacite: CapaciteEffective) => {
    setSelectedCapacite(capacite);
    setDeleteCapaciteDialogOpen(true);
  };

  const handleDeleteCapacite = async () => {
    if (!selectedCapacite) return;

    try {
      const { error } = await supabase
        .from('capacite_effective')
        .delete()
        .eq('id', selectedCapacite.id);

      if (error) throw error;

      toast({
        title: "Succès",
        description: "Capacité supprimée avec succès",
      });

      fetchData();
      setDeleteCapaciteDialogOpen(false);
      setSelectedCapacite(null);
    } catch (error) {
      console.error('Erreur:', error);
      toast({
        title: "Erreur",
        description: "Erreur lors de la suppression",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async () => {
    if (!selectedBesoin && besoinsToDelete.length === 0) return;

    try {
      if (besoinsToDelete.length > 0) {
        // Suppression groupée
        await Promise.all(
          besoinsToDelete.map(besoin => 
            supabase
              .from('besoin_effectif')
              .delete()
              .eq('id', besoin.id)
          )
        );
      } else if (selectedBesoin) {
        // Suppression simple
        const { error } = await supabase
          .from('besoin_effectif')
          .delete()
          .eq('id', selectedBesoin.id);

        if (error) throw error;
      }

      toast({
        title: "Succès",
        description: besoinsToDelete.length > 0 
          ? `${besoinsToDelete.length} besoin(s) supprimé(s) avec succès`
          : "Besoin supprimé avec succès",
      });

      fetchData();
      setDeleteDialogOpen(false);
      setBesoinsToDelete([]);
    } catch (error) {
      console.error('Erreur:', error);
      toast({
        title: "Erreur",
        description: "Erreur lors de la suppression",
        variant: "destructive",
      });
    }
  };

  const handleValidateAndGeneratePDF = async () => {
    try {
      setIsGeneratingPDF(true);

      // Update planning status in the main planning table
      const weekStartStr = format(currentWeekStart, 'yyyy-MM-dd');
      const weekEndStr = format(weekEnd, 'yyyy-MM-dd');

      // Update status for bloc operatoire
      await supabase
        .from('planning_genere_bloc_operatoire')
        .update({ statut: 'confirme' })
        .gte('date', weekStartStr)
        .lte('date', weekEndStr)
        .eq('statut', 'planifie');

      // No need to update planning_genere_site_besoin as it no longer exists
      // All assignments are now in planning_genere_personnel
      
      // Call validate-planning which will generate PDF and validate
      const { error: validateError } = await supabase.functions.invoke('validate-planning', {
        body: {
          planning_id: currentPlanningId,
        },
      });

      if (validateError) {
        console.error('Error validating planning:', validateError);
        throw validateError;
      }

      toast({
        title: "Succès",
        description: "Planning validé et PDF généré avec succès !",
      });

      await Promise.all([fetchPlanningGenere(), fetchCurrentPlanning()]);
    } catch (error: any) {
      console.error('Error validating and generating PDF:', error);
      const message = error?.message || (typeof error === 'string' ? error : 'Impossible de valider et générer le PDF');
      toast({
        title: "Erreur",
        description: message.length > 180 ? message.slice(0, 180) + '…' : message,
        variant: "destructive",
      });
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  const checkIfPlanningConfirmed = async (): Promise<boolean> => {
    const weekStartStr = format(currentWeekStart, 'yyyy-MM-dd');
    const weekEndStr = format(weekEnd, 'yyyy-MM-dd');
    
    // Check if any bloc operations are confirmed
    const { data, error } = await supabase
      .from('planning_genere_bloc_operatoire')
      .select('statut')
      .gte('date', weekStartStr)
      .lte('date', weekEndStr)
      .eq('statut', 'confirme')
      .limit(1);
    
    if (error) {
      console.error('Error checking planning status:', error);
      return false;
    }
    
    return (data && data.length > 0);
  };

  const handleOptimizeMILP = async () => {
    // Toujours ouvrir le dialogue de sélection
    setSelectDatesDialogOpen(true);
  };

  const executeOptimizeMILP = async (selectedDates?: string[], optimizeBloc = true, optimizeSites = true) => {
    setIsOptimizingMILP(true);
    setIsLoadingOptimizationResults(true);
    setGeneratedPdfUrl(null); // Reset PDF URL when regenerating
    
    // Si on réoptimise un planning validé, le repasser en cours
    if (currentPlanningStatus === 'valide' && currentPlanningId) {
      try {
        const { error } = await supabase
          .from('planning')
          .update({
            statut: 'en_cours',
            pdf_url: null,
            validated_at: null,
            validated_by: null,
            updated_at: new Date().toISOString()
          })
          .eq('id', currentPlanningId);
        
        if (error) throw error;
        setCurrentPlanningStatus('en_cours');
      } catch (error: any) {
        console.error('Error resetting planning status:', error);
      }
    }
    
    try {
      // Déterminer les jours à optimiser
      const daysToOptimize = selectedDates && selectedDates.length > 0
        ? selectedDates
        : weekDays.map(d => format(d, 'yyyy-MM-dd'));

      // Initialiser et afficher la modal de progression
      setOptimizationProgress({
        currentDay: 0,
        totalDays: daysToOptimize.length,
        currentPhase: optimizeBloc ? 'bloc' : 'sites',
        currentDate: daysToOptimize[0],
        completedDays: [],
        optimizeBloc,
        optimizeSites,
      });
      setShowProgressDialog(true);

      const firstDay = daysToOptimize[0];

      // Un seul appel pour toute la semaine (beaucoup plus rapide)
      console.log(`Optimizing entire week starting from: ${firstDay}`);
      
        const { data, error } = await supabase.functions.invoke('optimize-planning-milp-orchestrator', {
          body: {
            selected_dates: daysToOptimize,
            optimize_bloc: optimizeBloc,
            optimize_sites: optimizeSites,
          },
        });

      if (error) throw error;

      // Sauvegarder le planning_id
      if (data?.planning_id) {
        setCurrentPlanningId(data.planning_id);
        setCurrentPlanningStatus('en_cours');
      }

      // Compter les assignations totales
      let totalBlocAssignments = 0;
      let totalSitesAssignments = 0;
      
      if (optimizeBloc && data?.bloc_results) {
        const br = data.bloc_results as any;
        totalBlocAssignments = (br.blocs_assigned ?? 0) + (br.personnel_assigned ?? 0);
      }
      
      if (optimizeSites && data?.sites_results) {
        const sr = data.sites_results as any;
        totalSitesAssignments = sr.rows ?? 0;
      }

      // Simuler la progression pour une meilleure UX
      for (let i = 0; i < daysToOptimize.length; i++) {
        await new Promise(resolve => setTimeout(resolve, 200));
        setOptimizationProgress(prev => ({
          ...prev,
          currentDay: i + 1,
          currentDate: daysToOptimize[i],
          currentPhase: i < daysToOptimize.length - 1 ? (optimizeBloc ? 'bloc' : 'sites') : 'complete',
          completedDays: [...prev.completedDays, {
            date: daysToOptimize[i],
            blocAssignments: Math.round(totalBlocAssignments / daysToOptimize.length),
            sitesAssignments: Math.round(totalSitesAssignments / daysToOptimize.length),
          }],
        }));
      }

      const totalAssignments = totalBlocAssignments + totalSitesAssignments;

      // Marquer comme terminé
      setOptimizationProgress(prev => ({
        ...prev,
        currentPhase: 'complete',
      }));

      // Rafraîchir le planning généré AVANT de fermer la modal
      await Promise.all([fetchPlanningGenere(), fetchCurrentPlanning()]);

      // Attendre un peu pour que l'utilisateur voie le message de complétion
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Fermer la modal de progression
      setShowProgressDialog(false);
      setIsLoadingOptimizationResults(false);

      toast({
        title: "✅ Optimisation MILP terminée",
        description: `${totalAssignments} assignations créées avec succès sur ${daysToOptimize.length} jour${daysToOptimize.length > 1 ? 's' : ''}`,
      });
    } catch (error: any) {
      console.error('MILP optimization error:', error);
      setShowProgressDialog(false);
      setIsLoadingOptimizationResults(false);
      toast({
        title: "Erreur lors de l'optimisation MILP",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsOptimizingMILP(false);
    }
  };

  const validatePlanning = async () => {
    if (!currentPlanningId) {
      toast({
        title: "Erreur",
        description: "Aucun planning à valider",
        variant: "destructive",
      });
      return;
    }

    setIsValidatingPlanning(true);
    try {
      // Délègue au flux unique qui génère le PDF et enregistre l'URL
      await handleValidateAndGeneratePDF();
    } catch (error: any) {
      console.error('Validation error:', error);
      // handleValidateAndGeneratePDF gère déjà les toasts d'erreur,
      // on ne duplique pas sauf si un message explicite est disponible
      if (error?.message) {
        toast({
          title: "Erreur lors de la validation",
          description: error.message,
          variant: "destructive",
        });
      }
    } finally {
      setIsValidatingPlanning(false);
    }
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Planning</h1>
      </div>

      <div className="flex items-center justify-between bg-card p-4 rounded-lg border">
        <Button variant="outline" size="icon" onClick={goToPreviousWeek}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold">
            Semaine du {format(currentWeekStart, 'd MMMM', { locale: fr })} au {format(weekEnd, 'd MMMM yyyy', { locale: fr })}
          </h2>
          <Button variant="outline" size="sm" onClick={goToCurrentWeek}>
            Aujourd'hui
          </Button>
        </div>

        <Button variant="outline" size="icon" onClick={goToNextWeek}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <Tabs defaultValue="planning" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="planning">Planning Généré</TabsTrigger>
          <TabsTrigger value="besoins">Médecin</TabsTrigger>
          <TabsTrigger value="capacites">Assistant médical</TabsTrigger>
        </TabsList>

        <TabsContent value="besoins" className="space-y-4">
          {loading ? (
            <div className="text-center py-12 text-muted-foreground">
              Chargement...
            </div>
          ) : besoins.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              Aucun besoin pour cette semaine
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {sites.map((site) => {
                const besoinsSite = besoins.filter(b => b.site_id === site.id);
                // Regrouper par médecin/type
                const besoinsParMedecin = besoinsSite.reduce((acc, besoin) => {
                  let key: string;
                  if (besoin.type === 'medecin' && besoin.medecin) {
                    key = `medecin-${besoin.medecin.first_name}-${besoin.medecin.name}`;
                  } else if (besoin.type === 'bloc_operatoire') {
                    key = `bloc-${besoin.date}-${besoin.demi_journee}`;
                  } else {
                    key = `autre-${besoin.id}`;
                  }
                  
                  if (!acc[key]) {
                    acc[key] = [];
                  }
                  acc[key].push(besoin);
                  return acc;
                }, {} as Record<string, BesoinEffectif[]>);

                const totalMedecins = Object.keys(besoinsParMedecin).filter(k => k.startsWith('medecin-')).length;
                const totalSecretaires = besoinsSite.reduce((sum, b) => {
                  let besoinValue = 0;
                  if (b.medecin?.besoin_secretaires) {
                    besoinValue = Number(b.medecin.besoin_secretaires);
                  }
                  return sum + besoinValue;
                }, 0);

                return (
                  <Card key={site.id}>
                    <CardHeader className="bg-primary/5">
                      <div className="flex items-center justify-between">
                        <div className="flex flex-col gap-2">
                          <CardTitle className="flex items-center gap-2">
                            <Building2 className="h-6 w-6 text-primary" />
                            {site.nom}
                          </CardTitle>
                        </div>
                        <div className="flex items-center gap-4">
                          {canManage && (
                            <Button
                              variant="default"
                              size="sm"
                              onClick={() => handleAddClick('', site.id, site.nom)}
                              className="flex items-center gap-2"
                            >
                              <Plus className="h-4 w-4" />
                              {site.nom.includes('Bloc') ? 'Ajouter un besoin' : 'Ajouter un médecin'}
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-6">
                      {besoinsSite.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                          Aucun besoin pour cette semaine
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full border-collapse">
                          <thead>
                            <tr className="border-b-2">
                              <th className="text-left p-2 font-medium text-sm text-muted-foreground">Médecin / Détail</th>
                              <th className="text-left p-2 font-medium text-sm text-muted-foreground">
                                <div className="flex items-center gap-4">
                                  <span>Jours de présence</span>
                                  <div className="flex items-center gap-2 text-xs font-normal">
                                    <div className="flex items-center gap-1">
                                      <div className="w-3 h-3 rounded border-2 border-green-500"></div>
                                      <span>Toute la journée</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <div className="w-3 h-3 rounded border-2 border-amber-500"></div>
                                      <span>Matin</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <div className="w-3 h-3 rounded border-2 border-blue-500"></div>
                                      <span>Après-midi</span>
                                    </div>
                                  </div>
                                </div>
                              </th>
                              <th className="text-right p-2 font-medium text-sm text-muted-foreground">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(besoinsParMedecin).map(([key, besoinsGroupe]) => {
                              const premierBesoin = besoinsGroupe[0];
                              const isBloc = key.startsWith('bloc-');
                              
                              // Trier les besoins par date
                              const besoinsTries = [...besoinsGroupe].sort((a, b) => 
                                new Date(a.date).getTime() - new Date(b.date).getTime()
                              );
                              
                              // Regrouper les besoins par date pour déterminer la période
                              const besoinsParDate = besoinsTries.reduce((acc, b) => {
                                if (!acc[b.date]) {
                                  acc[b.date] = [];
                                }
                                acc[b.date].push(b);
                                return acc;
                              }, {} as Record<string, BesoinEffectif[]>);
                              
                              // Construire la liste des jours avec les noms complets et période
                              const joursParNom = Object.entries(besoinsParDate).map(([date, besoinsDate]) => {
                                const dateObj = new Date(date);
                                const jourSemaine = format(dateObj, 'EEEE', { locale: fr });
                                
                                // Déterminer la période depuis demi_journee
                                const demiJournees = besoinsDate.map(b => b.demi_journee);
                                
                                let periode: 'matin' | 'apres_midi' | 'journee';
                                if (demiJournees.includes('toute_journee')) {
                                  periode = 'journee';
                                } else if (demiJournees.includes('matin') && demiJournees.includes('apres_midi')) {
                                  periode = 'journee';
                                } else if (demiJournees.includes('matin')) {
                                  periode = 'matin';
                                } else {
                                  periode = 'apres_midi';
                                }
                                
                                return {
                                  nom: jourSemaine.charAt(0).toUpperCase() + jourSemaine.slice(1),
                                  date: format(dateObj, 'yyyy-MM-dd'),
                                  periode
                                };
                              }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
                              
                              const totalSecretairesPersonne = besoinsGroupe.reduce((sum, b) => {
                                let besoinValue = 0;
                                if (b.medecin?.besoin_secretaires) {
                                  besoinValue = Number(b.medecin.besoin_secretaires);
                                }
                                return sum + besoinValue;
                              }, 0);

                              return (
                                <tr key={key} className={`border-b hover:bg-muted/30 ${isBloc ? 'bg-blue-50/50' : ''}`}>
                                  <td className="p-2 font-medium">
                                    {isBloc 
                                      ? (
                                        <div className="flex flex-col gap-1">
                                          <span className="text-blue-700">Intervention chirurgicale</span>
                                          {premierBesoin.type_intervention && (
                                            <span className="text-xs text-muted-foreground">
                                              {premierBesoin.type_intervention.nom}
                                            </span>
                                          )}
                                        </div>
                                      )
                                      : premierBesoin.medecin 
                                        ? (
                                          <div className="flex flex-col gap-1">
                                            <span>{`${premierBesoin.medecin.first_name} ${premierBesoin.medecin.name}`}</span>
                                            {premierBesoin.type_intervention && (
                                              <span className="text-xs text-muted-foreground">
                                                {premierBesoin.type_intervention.nom}
                                              </span>
                                            )}
                                          </div>
                                        )
                                        : '-'
                                    }
                                  </td>
                                  <td className="p-2">
                                    <div className="flex flex-wrap gap-1">
                                      {joursParNom.map((jour, idx) => {
                                        const borderColor = jour.periode === 'journee' 
                                          ? 'border-green-500 text-green-700' 
                                          : jour.periode === 'matin'
                                          ? 'border-amber-500 text-amber-700'
                                          : 'border-blue-500 text-blue-700';
                                        
                                        return (
                                          <Badge key={idx} variant="outline" className={`text-xs bg-transparent ${borderColor}`}>
                                            {jour.nom}
                                          </Badge>
                                        );
                                      })}
                                    </div>
                                  </td>
                                  <td className="p-2 text-right">
                                    {canManage && (
                                      <div className="flex justify-end gap-1">
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => {
                                            setSelectedBesoins(besoinsGroupe);
                                            setEditDialogOpen(true);
                                          }}
                                          title="Modifier"
                                        >
                                          <Edit className="h-4 w-4" />
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => handleDeleteGroupClick(besoinsGroupe)}
                                          className="text-destructive hover:text-destructive"
                                          title="Supprimer"
                                        >
                                          <Trash2 className="h-4 w-4" />
                                        </Button>
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="capacites" className="space-y-4">
          {canManage && (
            <div className="flex justify-end mb-4">
              <Button onClick={() => setAddCapaciteDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Ajouter une capacité
              </Button>
            </div>
          )}

          {loading ? (
            <div className="text-center py-12 text-muted-foreground">
              Chargement...
            </div>
          ) : capacites.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              Aucune capacité pour cette semaine
            </div>
          ) : (
            <SecretaryCapacityView
              capacites={capacites}
              weekDays={weekDays}
              canManage={canManage}
              onRefresh={fetchCapacites}
            />
          )}
        </TabsContent>

        <TabsContent value="planning" className="space-y-4">
          {canManage && (
            <Card className="mb-4">
              <CardContent className="pt-6">
                {/* Planning Information in a single horizontal line with equal spacing */}
                <div className="grid grid-cols-[auto_1fr_1fr_1fr_1fr_1fr_auto_auto] items-center gap-6">
                  {/* Optimize Button */}
                  <Button 
                    onClick={handleOptimizeMILP} 
                    disabled={isOptimizingMILP}
                    size="default"
                    className="gap-2"
                  >
                    {isOptimizingMILP ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Optimisation...
                      </>
                    ) : (
                      <>
                        <Zap className="h-4 w-4" />
                        Optimiser
                      </>
                    )}
                  </Button>

                  {/* Optimization launched */}
                  {currentPlanningId && (
                    <div className="flex flex-col">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Optimisation lancée</span>
                      <span className="text-sm font-semibold">
                        {planningUpdatedAt 
                          ? format(new Date(planningUpdatedAt), 'dd/MM/yyyy à HH:mm', { locale: fr })
                          : '-'}
                      </span>
                    </div>
                  )}

                  {/* Last modification */}
                  {currentPlanningId && (
                    <div className="flex flex-col">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Dernière modification</span>
                      <span className="text-sm font-semibold">
                        {lastPersonnelUpdate 
                          ? format(new Date(lastPersonnelUpdate), 'dd/MM/yyyy à HH:mm', { locale: fr })
                          : '-'}
                      </span>
                    </div>
                  )}

                  {/* Validated by */}
                  {currentPlanningId && (
                    <div className="flex flex-col">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Validé par</span>
                      <span className="text-sm font-semibold min-h-[1.25rem]">
                        {currentPlanningStatus === 'valide' && validatedBy ? validatedBy : ''}
                      </span>
                    </div>
                  )}

                  {/* Validated at */}
                  {currentPlanningId && (
                    <div className="flex flex-col">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Validé à</span>
                      <span className="text-sm font-semibold min-h-[1.25rem]">
                        {currentPlanningStatus === 'valide' && validatedAt 
                          ? format(new Date(validatedAt), 'dd/MM/yyyy à HH:mm', { locale: fr })
                          : ''}
                      </span>
                    </div>
                  )}

                  {/* Empty space for alignment */}
                  {currentPlanningId && <div />}

                  {/* Validate Button */}
                  {currentPlanningId && currentPlanningStatus === 'en_cours' && (
                    <Button 
                      onClick={validatePlanning} 
                      disabled={isValidatingPlanning || isGeneratingPDF}
                      size="default"
                      className="gap-2 bg-green-600 hover:bg-green-700 text-white"
                    >
                      {isValidatingPlanning || isGeneratingPDF ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          {isGeneratingPDF ? 'Génération...' : 'Validation...'}
                        </>
                      ) : (
                        <>
                          <CheckCircle className="h-4 w-4" />
                          Valider
                        </>
                      )}
                    </Button>
                  )}
                  
                  {/* PDF Download Button */}
                  {generatedPdfUrl && (
                    <Button 
                      onClick={() => window.open(generatedPdfUrl, '_blank')} 
                      size="default"
                      variant="outline"
                      className="gap-2"
                    >
                      <FileText className="h-4 w-4" />
                      Télécharger le PDF
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* View Selector */}
          <div className="flex justify-center mb-4">
            <div className="inline-flex rounded-lg border p-1 bg-muted">
              <Button
                variant={planningView === 'site' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setPlanningView('site')}
                className="gap-2"
              >
                <Building2 className="h-4 w-4" />
                Par site
              </Button>
              <Button
                variant={planningView === 'secretary' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setPlanningView('secretary')}
                className="gap-2"
              >
                <Users className="h-4 w-4" />
                Par secrétaire
              </Button>
            </div>
          </div>

          {/* Planning Views */}
          {isLoadingOptimizationResults ? (
            <Card>
              <CardContent className="p-8 text-center">
                <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
                <p className="text-muted-foreground">Chargement du planning optimisé...</p>
              </CardContent>
            </Card>
          ) : planningView === 'site' ? (
            <SitePlanningView
              startDate={currentWeekStart}
              endDate={weekEnd}
            />
          ) : (
            <SecretaryPlanningView
              startDate={currentWeekStart}
              endDate={weekEnd}
            />
          )}
        </TabsContent>
      </Tabs>

      <AddBesoinDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        date={selectedDate}
        siteId={selectedSiteId}
        siteName={selectedSiteName}
        onSuccess={fetchData}
      />

      <EditBesoinDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        besoins={selectedBesoins}
        onSuccess={fetchData}
      />

      <AddCapaciteDialog
        open={addCapaciteDialogOpen}
        onOpenChange={setAddCapaciteDialogOpen}
        onSuccess={fetchData}
      />

      <AddPlanningCreneauDialog
        open={addPlanningDialogOpen}
        onOpenChange={setAddPlanningDialogOpen}
        onSuccess={fetchPlanningGenere}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={(open) => {
        setDeleteDialogOpen(open);
        if (!open) {
          setBesoinsToDelete([]);
          setSelectedBesoin(null);
        }
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer la suppression</AlertDialogTitle>
            <AlertDialogDescription>
              {besoinsToDelete.length > 0 
                ? `Êtes-vous sûr de vouloir supprimer ${besoinsToDelete.length} besoin(s) ? Cette action est irréversible.`
                : "Êtes-vous sûr de vouloir supprimer ce besoin ? Cette action est irréversible."
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteCapaciteDialogOpen} onOpenChange={(open) => {
        setDeleteCapaciteDialogOpen(open);
        if (!open) {
          setSelectedCapacite(null);
        }
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer la suppression</AlertDialogTitle>
            <AlertDialogDescription>
              Êtes-vous sûr de vouloir supprimer cette capacité ? Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteCapacite} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmRegenerateDialogOpen} onOpenChange={setConfirmRegenerateDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Régénérer le planning ?</AlertDialogTitle>
            <AlertDialogDescription>
              Ce planning a déjà été validé et confirmé. Êtes-vous sûr de vouloir le régénérer ? 
              Cette action supprimera le planning actuel et le PDF généré.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => {
                setConfirmRegenerateDialogOpen(false);
                executeOptimizeMILP();
              }}
              className="bg-primary"
            >
              Régénérer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SelectDatesForOptimizationDialog
        open={selectDatesDialogOpen}
        onOpenChange={setSelectDatesDialogOpen}
        weekDays={weekDays}
        onOptimize={async (dates, optimizeBloc, optimizeSites) => {
          await executeOptimizeMILP(dates, optimizeBloc, optimizeSites);
        }}
        isOptimizing={isOptimizingMILP}
      />

      <OptimizationProgressDialog
        open={showProgressDialog}
        currentDay={optimizationProgress.currentDay}
        totalDays={optimizationProgress.totalDays}
        currentPhase={optimizationProgress.currentPhase}
        currentDate={optimizationProgress.currentDate}
        completedDays={optimizationProgress.completedDays}
        optimizeBloc={optimizationProgress.optimizeBloc}
        optimizeSites={optimizationProgress.optimizeSites}
      />
    </div>
  );
}
