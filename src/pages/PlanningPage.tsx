import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useCanManagePlanning } from '@/hooks/useCanManagePlanning';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Building2, Users, Clock, Plus, Edit, Trash2, Loader2, Zap, FileText, CheckCircle } from 'lucide-react';
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { AddBesoinDialog } from '@/components/planning/AddBesoinDialog';
import { EditBesoinDialog } from '@/components/planning/EditBesoinDialog';
import { AddCapaciteDialog } from '@/components/planning/AddCapaciteDialog';
import { EditCapaciteDialog } from '@/components/planning/EditCapaciteDialog';
import { MILPOptimizationView } from '@/components/planning/MILPOptimizationView';
import { SecretaryPlanningView } from '@/components/planning/SecretaryPlanningView';
import { AddPlanningCreneauDialog } from '@/components/planning/AddPlanningCreneauDialog';
import { SecretaryCapacityView } from '@/components/planning/SecretaryCapacityView';
import { SiteClosingIndicator } from '@/components/planning/SiteClosingIndicator';
import { SelectDatesForOptimizationDialog } from '@/components/planning/SelectDatesForOptimizationDialog';
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
  heure_debut: string;
  heure_fin: string;
  site_id: string;
  bloc_operatoire_besoin_id?: string;
  medecin_id?: string;
  medecin?: { first_name: string; name: string; besoin_secretaires: number };
  site?: { nom: string };
  bloc_operatoire_besoin?: { nombre_secretaires_requis: number };
}

interface BesoinParSite {
  site_id: string;
  site_nom: string;
  besoins: BesoinEffectif[];
  total_medecins: number;
  total_secretaires_requis: number;
  plage_horaire: { debut: string; fin: string };
}

interface CapaciteEffective {
  id: string;
  date: string;
  heure_debut: string;
  heure_fin: string;
  secretaire_id?: string;
  backup_id?: string;
  secretaire?: { first_name: string; name: string; specialites: string[] };
  backup?: { first_name: string; name: string; specialites: string[] };
  specialites: string[];
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
  const [editCapaciteDialogOpen, setEditCapaciteDialogOpen] = useState(false);
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
  const [isValidatingPlanning, setIsValidatingPlanning] = useState(false);
  const [selectDatesDialogOpen, setSelectDatesDialogOpen] = useState(false);
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

    // Real-time updates for bloc_operatoire_besoins
    const blocChannel = supabase
      .channel('bloc-operatoire-besoins-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bloc_operatoire_besoins'
        },
        () => {
          fetchBesoins();
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
      supabase.removeChannel(blocChannel);
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
    try {
      const { data: planningData, error } = await supabase
        .from('planning_genere')
        .select(`
          *,
          site:sites(nom, fermeture)
        `)
        .gte('date', format(currentWeekStart, 'yyyy-MM-dd'))
        .lte('date', format(weekEnd, 'yyyy-MM-dd'))
        .order('date')
        .order('heure_debut');

      if (error) throw error;

      if (planningData && planningData.length > 0) {
        // Récupérer toutes les secrétaires et backups nécessaires
        const allSecretaireIds = planningData.flatMap(row => row.secretaires_ids || []);
        const allBackupIds = planningData.flatMap(row => row.backups_ids || []);
        
        const { data: secretairesData } = await supabase
          .from('secretaires')
          .select('id, first_name, name')
          .in('id', allSecretaireIds.length > 0 ? allSecretaireIds : ['00000000-0000-0000-0000-000000000000']);
        
        const { data: backupsData } = await supabase
          .from('backup')
          .select('id, first_name, name')
          .in('id', allBackupIds.length > 0 ? allBackupIds : ['00000000-0000-0000-0000-000000000000']);
        
        const secretairesMap = new Map(secretairesData?.map(s => [s.id, s]) || []);
        const backupsMap = new Map(backupsData?.map(b => [b.id, b]) || []);

        // Récupérer les besoins effectifs pour obtenir les noms des médecins et les besoins réels
        const { data: besoinsData } = await supabase
          .from('besoin_effectif')
          .select(`
            id,
            date,
            heure_debut,
            heure_fin,
            site_id,
            medecin_id,
            bloc_operatoire_besoin_id,
            type,
            medecin:medecins(first_name, name, besoin_secretaires),
            bloc_operatoire_besoin:bloc_operatoire_besoins(nombre_secretaires_requis)
          `)
          .gte('date', format(currentWeekStart, 'yyyy-MM-dd'))
          .lte('date', format(weekEnd, 'yyyy-MM-dd'))
          .eq('actif', true);

        // Regrouper les affectations par (date, période, site)
        const assignmentsByKey = new Map();

        for (const row of planningData) {
          // Déterminer la période depuis l'heure_debut
          const periode = row.heure_debut < '12:00:00' ? 'matin' : 'apres_midi';
          const key = `${row.date}-${periode}-${row.site_id || 'admin'}`;

          if (!assignmentsByKey.has(key)) {
            const isMatin = periode === 'matin';
            const slotStart = isMatin ? '07:30:00' : '13:00:00';
            const slotEnd = isMatin ? '12:00:00' : '17:00:00';

            // Récupérer les besoins pour cette période en vérifiant le chevauchement d'horaires
            // Pour les assignations administratives (site_id null), ne pas filtrer par site
            const besoinsForSlot = (besoinsData || []).filter(besoin => {
              if (besoin.date !== row.date) return false;
              // Si administrative, ne pas filtrer par site
              if (row.site_id === null) {
                // Filtrer juste par chevauchement de période
                const besoinHeureDebut = besoin.heure_debut || '00:00:00';
                const besoinHeureFin = besoin.heure_fin || '23:59:59';
                const overlap = besoinHeureDebut < slotEnd && besoinHeureFin > slotStart;
                return overlap;
              }
              // Sinon, filtrer par site et période
              if (besoin.site_id !== row.site_id) return false;
              const besoinHeureDebut = besoin.heure_debut || '00:00:00';
              const besoinHeureFin = besoin.heure_fin || '23:59:59';
              const overlap = besoinHeureDebut < slotEnd && besoinHeureFin > slotStart;
              return overlap;
            });

            // Extraire les médecins depuis row.medecins_ids ou depuis les besoins
            const medecinIds = row.medecins_ids || [];
            const medecins = besoinsForSlot
              .filter(besoin => besoin.medecin && medecinIds.includes(besoin.medecin_id))
              .map(besoin => `${besoin.medecin?.first_name || ''} ${besoin.medecin?.name || ''}`.trim())
              .filter((nom, idx, arr) => nom && arr.indexOf(nom) === idx);

            // Calculer le nombre total de secrétaires requis (somme, puis arrondi supérieur)
            // Pour les assignations administratives, ne pas calculer de besoin (mis à 0)
            const nombreRequis = row.site_id === null ? 0 : besoinsForSlot.reduce((sum, besoin) => {
              // Récupérer le besoin selon le type
              let besoinValue = 0;
              if (besoin.type === 'medecin' && besoin.medecin?.besoin_secretaires) {
                besoinValue = Number(besoin.medecin.besoin_secretaires);
              } else if (besoin.type === 'bloc_operatoire' && besoin.bloc_operatoire_besoin?.nombre_secretaires_requis) {
                besoinValue = Number(besoin.bloc_operatoire_besoin.nombre_secretaires_requis);
              }
              return sum + besoinValue;
            }, 0);

            assignmentsByKey.set(key, {
              date: row.date,
              periode,
              site_id: row.site_id,
              site_nom: row.site?.nom || 'Administratif',
              site_fermeture: row.site?.fermeture || false,
              secretaires: [],
              medecins,
              besoin_reel: nombreRequis, // Stocker le besoin réel avant arrondi
              nombre_requis: row.site_id === null ? 0 : Math.ceil(nombreRequis),
              type_assignation: row.type_assignation,
            });
          }

          const assignment = assignmentsByKey.get(key);
          
          // Ajouter toutes les secrétaires depuis l'array secretaires_ids
          for (const secId of (row.secretaires_ids || [])) {
            const sec = secretairesMap.get(secId);
            if (sec) {
              assignment.secretaires.push({
                id: secId,
                secretaire_id: secId,
                backup_id: null,
                nom: `${sec.first_name || ''} ${sec.name || ''}`.trim(),
                is_backup: false,
                is_1r: row.responsable_1r_id === secId,
                is_2f: row.responsable_2f_id === secId,
              });
            }
          }
          
          // Ajouter tous les backups depuis l'array backups_ids
          for (const backupId of (row.backups_ids || [])) {
            const bck = backupsMap.get(backupId);
            if (bck) {
              assignment.secretaires.push({
                id: backupId,
                secretaire_id: null,
                backup_id: backupId,
                nom: `${bck.first_name || ''} ${bck.name || ''}`.trim(),
                is_backup: true,
                is_1r: row.responsable_1r_id === backupId,
                is_2f: row.responsable_2f_id === backupId,
              });
            }
          }
        }

        // Convertir en AssignmentResult[]
        const assignments = Array.from(assignmentsByKey.values()).map(a => {
          const nombreAssigne = a.secretaires.length;
          const besoinReel = a.besoin_reel || 0;
          const nombreRequis = Math.ceil(besoinReel);
          const arrondInferieur = Math.floor(besoinReel);
          
          let status: 'satisfait' | 'arrondi_inferieur' | 'non_satisfait' = 'satisfait';
          
          if (nombreAssigne >= nombreRequis) {
            // On a au moins l'arrondi supérieur → satisfait (vert)
            status = 'satisfait';
          } else if (nombreAssigne >= arrondInferieur && nombreAssigne < nombreRequis) {
            // On est entre l'arrondi inférieur et supérieur → partiel (orange)
            status = 'arrondi_inferieur';
          } else {
            // On est en dessous de l'arrondi inférieur → non satisfait (rouge)
            status = 'non_satisfait';
          }

          return {
            creneau_besoin_id: `${a.date}-${a.periode}-${a.site_id}`,
            date: a.date,
            periode: a.periode,
            site_id: a.site_id || '',
            site_nom: a.site_nom,
            site_fermeture: a.site_fermeture,
            medecins: a.medecins,
            secretaires: a.secretaires,
            nombre_requis: nombreRequis,
            nombre_assigne: nombreAssigne,
            status,
            type_assignation: a.type_assignation,
          };
        });

        // Pour un planning déjà généré, on considère tout comme satisfait
        const siteAssignments = assignments.filter(a => a.type_assignation === 'site');
        
        setOptimizationResult({
          assignments,
          stats: { 
            satisfait: siteAssignments.length, 
            partiel: 0, 
            non_satisfait: 0 
          },
          score_base: 0,
          penalites: {
            changement_site: 0,
            multiple_fermetures: 0,
            centre_esplanade_depassement: 0,
          },
          score_total: 0,
        });
      } else {
        setOptimizationResult(null);
      }
    } catch (error) {
      console.error('Erreur lors du chargement du planning généré:', error);
    }
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
      } else {
        setCurrentPlanningId(null);
        setCurrentPlanningStatus('en_cours');
        setGeneratedPdfUrl(null);
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
        bloc_operatoire_besoin:bloc_operatoire_besoins(nombre_secretaires_requis)
      `)
      .gte('date', format(currentWeekStart, 'yyyy-MM-dd'))
      .lte('date', format(weekEnd, 'yyyy-MM-dd'))
      .eq('actif', true)
      .order('date')
      .order('heure_debut');

    if (error) throw error;
    setBesoins(data || []);
    
    // Regrouper par site
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
            plage_horaire: { debut: '23:59:59', fin: '00:00:00' }
          };
        }
        
        acc[siteId].besoins.push(besoin);
        if (besoin.type === 'medecin') {
          acc[siteId].total_medecins++;
        }
        
        // Calculer le besoin selon le type
        let besoinValue = 0;
        if (besoin.type === 'medecin' && besoin.medecin?.besoin_secretaires) {
          besoinValue = Number(besoin.medecin.besoin_secretaires);
        } else if (besoin.type === 'bloc_operatoire' && besoin.bloc_operatoire_besoin?.nombre_secretaires_requis) {
          besoinValue = Number(besoin.bloc_operatoire_besoin.nombre_secretaires_requis);
        }
        acc[siteId].total_secretaires_requis += besoinValue;
        
        // Mettre à jour la plage horaire
        if (besoin.heure_debut < acc[siteId].plage_horaire.debut) {
          acc[siteId].plage_horaire.debut = besoin.heure_debut;
        }
        if (besoin.heure_fin > acc[siteId].plage_horaire.fin) {
          acc[siteId].plage_horaire.fin = besoin.heure_fin;
        }
        
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
        secretaire:secretaires(first_name, name, specialites),
        backup:backup(first_name, name, specialites)
      `)
      .gte('date', format(currentWeekStart, 'yyyy-MM-dd'))
      .lte('date', format(weekEnd, 'yyyy-MM-dd'))
      .eq('actif', true)
      .order('date')
      .order('heure_debut');

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
        // Récupérer les spécialités depuis secretaire ou backup
        const specialitesIds = capacite.secretaire?.specialites || capacite.backup?.specialites || [];
        return {
          ...capacite,
          specialites: specialitesIds.map(
            (id: string) => specialitesMap.get(id) || 'Spécialité inconnue'
          )
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

  const handleEditCapaciteClick = (capacite: CapaciteEffective) => {
    setSelectedCapacite(capacite);
    setEditCapaciteDialogOpen(true);
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
        if (selectedBesoin.type === 'bloc_operatoire' && selectedBesoin.bloc_operatoire_besoin_id) {
          const { error } = await supabase
            .from('bloc_operatoire_besoins')
            .delete()
            .eq('id', selectedBesoin.bloc_operatoire_besoin_id);

          if (error) throw error;
        } else {
          const { error } = await supabase
            .from('besoin_effectif')
            .delete()
            .eq('id', selectedBesoin.id);

          if (error) throw error;
        }
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

      // Update all planning status to 'confirme' for the current week
      const weekStartStr = format(currentWeekStart, 'yyyy-MM-dd');
      const weekEndStr = format(weekEnd, 'yyyy-MM-dd');

      const { error: updateError } = await supabase
        .from('planning_genere')
        .update({ statut: 'confirme' })
        .gte('date', weekStartStr)
        .lte('date', weekEndStr)
        .eq('statut', 'planifie');

      if (updateError && !String(updateError.message || '').includes('statut_planning')) throw updateError;

      // Prepare secretary data for PDF
      const secretaryData = optimizationResult?.assignments.reduce((acc: any[], assignment) => {
        assignment.secretaires.forEach((sec) => {
          let secretary = acc.find((s) => s.id === sec.id);
          if (!secretary) {
            secretary = {
              id: sec.id,
              name: sec.nom,
              assignments: [],
            };
            acc.push(secretary);
          }

          secretary.assignments.push({
            date: format(new Date(assignment.date), 'dd/MM/yyyy'),
            periode: assignment.periode === 'matin' ? 'Matin (7h30-12h00)' : 'Après-midi (12h00-17h30)',
            site: assignment.site_nom,
            medecins: assignment.medecins,
            is1R: sec.is_1r || false,
            is2F: sec.is_2f || false,
            type: assignment.type_assignation || 'site',
          });
        });
        return acc;
      }, []);

      // Call edge function to generate PDF
      const { data, error } = await supabase.functions.invoke('generate-planning-pdf', {
        body: {
          weekStart: format(currentWeekStart, 'dd/MM/yyyy'),
          weekEnd: format(weekEnd, 'dd/MM/yyyy'),
          secretaries: secretaryData || [],
        },
      });

      if (error) throw error;

      toast({
        title: "Succès",
        description: "Planning validé et PDF généré avec succès !",
      });

      // Store the PDF URL
      if (data?.pdfUrl) {
        console.log('PDF URL received:', data.pdfUrl);
        setGeneratedPdfUrl(data.pdfUrl);
      } else {
        console.warn('No PDF URL in response:', data);
      }

      fetchPlanningGenere();
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
    
    const { data, error } = await supabase
      .from('planning_genere')
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
    // Si le planning est validé, ouvrir le dialog de sélection de dates
    if (currentPlanningStatus === 'valide') {
      setSelectDatesDialogOpen(true);
      return;
    }
    
    // Sinon optimiser toute la semaine
    executeOptimizeMILP();
  };

  const executeOptimizeMILP = async (selectedDates?: string[]) => {
    setIsOptimizingMILP(true);
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
      const dateDebut = selectedDates && selectedDates.length > 0 
        ? selectedDates[0] 
        : format(currentWeekStart, 'yyyy-MM-dd');
      const dateFin = selectedDates && selectedDates.length > 0
        ? selectedDates[selectedDates.length - 1]
        : format(weekEnd, 'yyyy-MM-dd');

      toast({
        title: "Optimisation MILP en cours",
        description: selectedDates 
          ? `Réoptimisation de ${selectedDates.length} jour${selectedDates.length > 1 ? 's' : ''}...`
          : "L'algorithme MILP est en train de calculer le planning optimal...",
      });

      const { data, error } = await supabase.functions.invoke('optimize-planning-milp', {
        body: {
          date_debut: dateDebut,
          date_fin: dateFin,
          selected_dates: selectedDates,
        },
      });

      if (error) throw error;

      // Sauvegarder le planning_id
      if (data?.planning_id) {
        setCurrentPlanningId(data.planning_id);
        setCurrentPlanningStatus('en_cours');
      }

      toast({
        title: "Optimisation MILP terminée",
        description: `${data?.assignments_count || 0} assignations créées avec succès`,
      });

      // Rafraîchir le planning généré
      await Promise.all([fetchPlanningGenere(), fetchCurrentPlanning()]);
    } catch (error: any) {
      console.error('MILP optimization error:', error);
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
    setIsGeneratingPDF(true);
    
    try {
      // 1. D'abord générer le PDF
      toast({
        title: "Génération du PDF en cours",
        description: "Le planning est en cours de génération...",
      });

      const { data: pdfData, error: pdfError } = await supabase.functions.invoke('generate-planning-pdf', {
        body: {
          date_debut: format(currentWeekStart, 'yyyy-MM-dd'),
          date_fin: format(weekEnd, 'yyyy-MM-dd'),
        },
      });

      if (pdfError) throw pdfError;

      const pdfUrl = pdfData?.pdf_url;

      // 2. Ensuite valider le planning avec l'URL du PDF
      const { error: validateError } = await supabase.functions.invoke('validate-planning', {
        body: {
          planning_id: currentPlanningId,
          pdf_url: pdfUrl,
        },
      });

      if (validateError) throw validateError;

      setGeneratedPdfUrl(pdfUrl);

      toast({
        title: "Planning validé",
        description: "Le planning a été validé et le PDF généré avec succès",
      });

      // Refresh data
      await Promise.all([fetchPlanningGenere(), fetchCurrentPlanning()]);
    } catch (error: any) {
      console.error('Validation error:', error);
      toast({
        title: "Erreur lors de la validation",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsValidatingPlanning(false);
      setIsGeneratingPDF(false);
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
          <TabsTrigger value="besoins">Besoins ({besoins.length})</TabsTrigger>
          <TabsTrigger value="capacites">Capacités ({capacites.length})</TabsTrigger>
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
            <div className="space-y-6">
              {sites.map((site) => {
                const besoinsSite = besoins.filter(b => b.site_id === site.id);
                // Regrouper par médecin/type
                const besoinsParMedecin = besoinsSite.reduce((acc, besoin) => {
                  let key: string;
                  if (besoin.type === 'medecin' && besoin.medecin) {
                    key = `medecin-${besoin.medecin.first_name}-${besoin.medecin.name}`;
                  } else if (besoin.type === 'bloc_operatoire') {
                    key = `bloc-${besoin.date}-${besoin.heure_debut}`;
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
                  if (b.type === 'medecin' && b.medecin?.besoin_secretaires) {
                    besoinValue = Number(b.medecin.besoin_secretaires);
                  } else if (b.type === 'bloc_operatoire' && b.bloc_operatoire_besoin?.nombre_secretaires_requis) {
                    besoinValue = Number(b.bloc_operatoire_besoin.nombre_secretaires_requis);
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
                          <SiteClosingIndicator 
                            siteId={site.id} 
                            siteName={site.nom} 
                            weekDays={weekDays} 
                          />
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
                              <th className="text-left p-2 font-medium text-sm text-muted-foreground">Jours de présence</th>
                              <th className="text-left p-2 font-medium text-sm text-muted-foreground">Horaires</th>
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
                              
                              // Construire la liste des jours avec les noms complets
                              const joursParNom = besoinsTries.map(b => {
                                const date = new Date(b.date);
                                const jourSemaine = format(date, 'EEEE', { locale: fr });
                                return {
                                  nom: jourSemaine.charAt(0).toUpperCase() + jourSemaine.slice(1),
                                  date: format(date, 'yyyy-MM-dd')
                                };
                              });
                              
                              // Récupérer les horaires (prendre le premier si c'est identique partout)
                              const horaires = `${premierBesoin.heure_debut.slice(0, 5)} - ${premierBesoin.heure_fin.slice(0, 5)}`;
                              
                              const totalSecretairesPersonne = besoinsGroupe.reduce((sum, b) => {
                                let besoinValue = 0;
                                if (b.type === 'medecin' && b.medecin?.besoin_secretaires) {
                                  besoinValue = Number(b.medecin.besoin_secretaires);
                                } else if (b.type === 'bloc_operatoire' && b.bloc_operatoire_besoin?.nombre_secretaires_requis) {
                                  besoinValue = Number(b.bloc_operatoire_besoin.nombre_secretaires_requis);
                                }
                                return sum + besoinValue;
                              }, 0);

                              return (
                                <tr key={key} className={`border-b hover:bg-muted/30 ${isBloc ? 'bg-blue-50/50' : ''}`}>
                                  <td className="p-2 font-medium">
                                    {isBloc 
                                      ? <span className="text-blue-700">Intervention chirurgicale</span>
                                      : premierBesoin.medecin 
                                        ? `${premierBesoin.medecin.first_name} ${premierBesoin.medecin.name}` 
                                        : '-'
                                    }
                                  </td>
                                  <td className="p-2">
                                    <div className="flex flex-wrap gap-1">
                                      {joursParNom.map((jour, idx) => (
                                        <Badge key={idx} variant="outline" className="text-xs">
                                          {jour.nom}
                                        </Badge>
                                      ))}
                                    </div>
                                  </td>
                                  <td className="p-2 text-sm">
                                    {horaires}
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
            <div className="flex flex-col gap-6 py-6">
              {/* Status Badge */}
              {currentPlanningId && (
                <div className="flex justify-center">
                  <Badge 
                    variant={currentPlanningStatus === 'valide' ? 'default' : 'secondary'}
                    className={`text-lg px-6 py-3 ${currentPlanningStatus === 'valide' ? 'bg-green-600 hover:bg-green-700' : 'bg-orange-500 hover:bg-orange-600'}`}
                  >
                    {currentPlanningStatus === 'valide' ? (
                      <>
                        <CheckCircle className="h-5 w-5 mr-2" />
                        Planning validé
                      </>
                    ) : (
                      <>
                        <Clock className="h-5 w-5 mr-2" />
                        Planning en cours
                      </>
                    )}
                  </Badge>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex justify-center gap-4 flex-wrap">
                <Button 
                  onClick={handleOptimizeMILP} 
                  disabled={isOptimizingMILP}
                  size="lg"
                  variant={currentPlanningStatus === 'valide' ? 'outline' : 'default'}
                  className="gap-2 min-w-[200px]"
                >
                  {isOptimizingMILP ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Optimisation...
                    </>
                  ) : (
                    <>
                      <Zap className="h-4 w-4" />
                      {currentPlanningStatus === 'valide' ? 'Réoptimiser' : 'Optimiser avec MILP'}
                    </>
                  )}
                </Button>
                
                {currentPlanningId && currentPlanningStatus === 'en_cours' && optimizationResult && (
                  <Button 
                    onClick={validatePlanning} 
                    disabled={isValidatingPlanning || isGeneratingPDF}
                    size="lg"
                    variant="default"
                    className="gap-2 bg-green-600 hover:bg-green-700 min-w-[200px]"
                  >
                    {isValidatingPlanning || isGeneratingPDF ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {isGeneratingPDF ? 'Génération PDF...' : 'Validation...'}
                      </>
                    ) : (
                      <>
                        <CheckCircle className="h-4 w-4" />
                        Valider et générer PDF
                      </>
                    )}
                  </Button>
                )}
                
                {generatedPdfUrl && (
                  <Button 
                    onClick={() => window.open(generatedPdfUrl, '_blank')} 
                    size="lg"
                    variant="secondary"
                    className="gap-2 min-w-[200px]"
                  >
                    <FileText className="h-4 w-4" />
                    Télécharger le PDF
                  </Button>
                )}
              </div>

              {/* Info Message */}
              {currentPlanningStatus === 'valide' && (
                <p className="text-center text-sm text-muted-foreground">
                  Le planning est validé. Vous pouvez le réoptimiser pour des jours spécifiques si nécessaire.
                </p>
              )}
            </div>
          )}

          {optimizationResult && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <div className="flex-1 flex justify-start">
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
                {canManage && (
                  <Button onClick={() => setAddPlanningDialogOpen(true)} size="sm">
                    <Plus className="h-4 w-4 mr-2" />
                    Ajouter un créneau
                  </Button>
                )}
              </div>

              {planningView === 'site' ? (
                <MILPOptimizationView
                  assignments={optimizationResult.assignments}
                  weekDays={weekDays}
                  specialites={specialites}
                  onRefresh={fetchPlanningGenere}
                />
              ) : (
                <SecretaryPlanningView
                  assignments={optimizationResult.assignments}
                  weekDays={weekDays}
                  onRefresh={fetchPlanningGenere}
                />
              )}
            </div>
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

      <EditCapaciteDialog
        open={editCapaciteDialogOpen}
        onOpenChange={setEditCapaciteDialogOpen}
        capacite={selectedCapacite}
        onSuccess={fetchData}
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
        onOptimize={executeOptimizeMILP}
        isOptimizing={isOptimizingMILP}
      />
    </div>
  );
}
