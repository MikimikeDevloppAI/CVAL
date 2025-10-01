import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Building2, Users, Clock, Plus, Edit, Trash2 } from 'lucide-react';
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { AddBesoinDialog } from '@/components/planning/AddBesoinDialog';
import { EditBesoinDialog } from '@/components/planning/EditBesoinDialog';
import { AddCapaciteDialog } from '@/components/planning/AddCapaciteDialog';
import { EditCapaciteDialog } from '@/components/planning/EditCapaciteDialog';
import { PlanningOptimizer } from '@/components/planning/PlanningOptimizer';
import { PlanningGridView } from '@/components/planning/PlanningGridView';
import { OptimizationResult } from '@/types/planning';
import { SimpleOptimizationViewer } from '@/components/planning/SimpleOptimizationViewer';
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
  nombre_secretaires_requis: number;
  site_id: string;
  specialite_id?: string;
  bloc_operatoire_besoin_id?: string;
  medecin_id?: string;
  medecin?: { first_name: string; name: string };
  site?: { nom: string };
  specialite?: { nom: string };
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
  secretaire?: { first_name: string; name: string };
  backup?: { first_name: string; name: string };
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
  const [simpleOptimizationResult, setSimpleOptimizationResult] = useState<any>(null);
  const [specialites, setSpecialites] = useState<{ id: string; nom: string }[]>([]);
  const { toast } = useToast();

  const weekEnd = endOfWeek(currentWeekStart, { weekStartsOn: 1 });

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

    return () => {
      supabase.removeChannel(besoinChannel);
      supabase.removeChannel(capaciteChannel);
      supabase.removeChannel(blocChannel);
    };
  }, [currentWeekStart]);

  const fetchData = async () => {
    setLoading(true);
    try {
      await Promise.all([fetchSites(), fetchSpecialites(), fetchBesoins(), fetchCapacites(), fetchPlanningGenere()]);
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
            nombre_secretaires_requis,
            medecin:medecins(first_name, name)
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
            const besoinsForSlot = (besoinsData || []).filter(besoin => {
              if (besoin.date !== row.date || besoin.site_id !== row.site_id) return false;
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
            const nombreRequis = besoinsForSlot.reduce((sum, besoin) => {
              return sum + (Number(besoin.nombre_secretaires_requis) || 0);
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
              nombre_requis: Math.ceil(nombreRequis),
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
        medecin:medecins(first_name, name),
        site:sites(nom),
        specialite:specialites(nom)
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
        acc[siteId].total_secretaires_requis += besoin.nombre_secretaires_requis;
        
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
        secretaire:secretaires(first_name, name),
        backup:backup(first_name, name)
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

      const enrichedData = data.map(capacite => ({
        ...capacite,
        specialites: (capacite.specialites || []).map(
          (id: string) => specialitesMap.get(id) || 'Spécialité inconnue'
        )
      }));

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

      <Tabs defaultValue="besoins" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="besoins">Besoins ({besoins.length})</TabsTrigger>
          <TabsTrigger value="capacites">Capacités ({capacites.length})</TabsTrigger>
          <TabsTrigger value="planning">Planning Généré</TabsTrigger>
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
                const totalSecretaires = besoinsSite.reduce((sum, b) => sum + b.nombre_secretaires_requis, 0);

                return (
                  <Card key={site.id}>
                    <CardHeader className="bg-primary/5">
                      <div className="flex items-center justify-between">
                        <CardTitle className="flex items-center gap-2">
                          <Building2 className="h-6 w-6 text-primary" />
                          {site.nom}
                        </CardTitle>
                        <div className="flex items-center gap-4">
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => handleAddClick('', site.id, site.nom)}
                            className="flex items-center gap-2"
                          >
                            <Plus className="h-4 w-4" />
                            {site.nom.includes('Bloc') ? 'Ajouter un besoin' : 'Ajouter un médecin'}
                          </Button>
                          {besoinsSite.length > 0 && (
                            <>
                              <Separator orientation="vertical" className="h-10" />
                              <div className="text-right">
                                <div className="text-sm text-muted-foreground">Médecins</div>
                                <div className="font-bold text-lg">{totalMedecins}</div>
                              </div>
                              <Separator orientation="vertical" className="h-10" />
                              <div className="text-right">
                                <div className="text-sm text-muted-foreground">Secrétaires requis</div>
                                <div className="font-bold text-lg text-primary">{Math.ceil(totalSecretaires)}</div>
                              </div>
                            </>
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
                              <th className="text-left p-2 font-medium text-sm text-muted-foreground">Type</th>
                              <th className="text-left p-2 font-medium text-sm text-muted-foreground">Médecin / Détail</th>
                              <th className="text-left p-2 font-medium text-sm text-muted-foreground">Spécialité</th>
                              <th className="text-left p-2 font-medium text-sm text-muted-foreground">Jours de présence</th>
                              <th className="text-left p-2 font-medium text-sm text-muted-foreground">Horaires</th>
                              <th className="text-right p-2 font-medium text-sm text-muted-foreground">Secrétaires</th>
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
                              
                              const totalSecretairesPersonne = besoinsGroupe.reduce((sum, b) => sum + b.nombre_secretaires_requis, 0);

                              return (
                                <tr key={key} className={`border-b hover:bg-muted/30 ${isBloc ? 'bg-blue-50/50' : ''}`}>
                                  <td className="p-2">
                                    <Badge variant={isBloc ? "secondary" : "default"}>
                                      {isBloc ? 'Bloc opératoire' : 'Médecin'}
                                    </Badge>
                                  </td>
                                  <td className="p-2 font-medium">
                                    {isBloc 
                                      ? <span className="text-blue-700">Intervention chirurgicale</span>
                                      : premierBesoin.medecin 
                                        ? `${premierBesoin.medecin.first_name} ${premierBesoin.medecin.name}` 
                                        : '-'
                                    }
                                  </td>
                                  <td className="p-2 text-sm text-muted-foreground">
                                    {premierBesoin.specialite?.nom || '-'}
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
                                  <td className="p-2 text-right font-medium">
                                    {totalSecretairesPersonne.toFixed(1)}
                                  </td>
                                  <td className="p-2 text-right">
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
                                  </td>
                                </tr>
                              );
                            })}
                            <tr className="font-bold bg-muted/50">
                              <td colSpan={6} className="p-2 text-right">TOTAL SECRÉTAIRES REQUIS</td>
                              <td className="p-2 text-right text-primary text-lg">
                                {Math.ceil(totalSecretaires)}
                              </td>
                            </tr>
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
          <div className="flex justify-end mb-4">
            <Button onClick={() => setAddCapaciteDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Ajouter une capacité
            </Button>
          </div>

          {loading ? (
            <div className="text-center py-12 text-muted-foreground">
              Chargement...
            </div>
          ) : capacites.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              Aucune capacité pour cette semaine
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(
                capacites.reduce((acc, capacite) => {
                  const date = capacite.date;
                  if (!acc[date]) acc[date] = [];
                  acc[date].push(capacite);
                  return acc;
                }, {} as Record<string, CapaciteEffective[]>)
              ).map(([date, capacitesJour]) => (
                <Card key={date}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Clock className="h-5 w-5 text-primary" />
                      {format(new Date(date), 'EEEE d MMMM yyyy', { locale: fr })}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {capacitesJour.map((capacite) => {
                        const personName = capacite.secretaire 
                          ? `${capacite.secretaire.first_name} ${capacite.secretaire.name}`
                          : capacite.backup
                          ? `${capacite.backup.first_name} ${capacite.backup.name} (Backup)`
                          : 'Personne inconnue';

                        return (
                          <div key={capacite.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors">
                            <div className="flex-1">
                              <div className="font-medium">
                                {personName}
                              </div>
                              <div className="text-sm text-muted-foreground mt-1">
                                {capacite.specialites && capacite.specialites.length > 0 
                                  ? capacite.specialites.join(', ')
                                  : 'Aucune spécialité'}
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="text-right">
                                <div className="font-medium text-lg">
                                  {capacite.heure_debut.slice(0, 5)} - {capacite.heure_fin.slice(0, 5)}
                                </div>
                              </div>
                              <div className="flex gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleEditCapaciteClick(capacite)}
                                  title="Modifier"
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDeleteCapaciteClick(capacite)}
                                  className="text-destructive hover:text-destructive"
                                  title="Supprimer"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="planning" className="space-y-4">
          <div className="flex justify-center py-6">
            <PlanningOptimizer
              weekStart={currentWeekStart}
              onOptimizationComplete={(result) => setSimpleOptimizationResult(result)}
            />
          </div>
          
          {simpleOptimizationResult && (
            <SimpleOptimizationViewer 
              result={simpleOptimizationResult}
              specialites={specialites}
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
    </div>
  );
}
