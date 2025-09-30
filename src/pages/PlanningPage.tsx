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
  bloc_operatoire_besoin_id?: string;
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
  secretaire?: { first_name: string; name: string };
  specialites: string[];
}

export default function PlanningPage() {
  const [currentWeekStart, setCurrentWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [besoins, setBesoins] = useState<BesoinEffectif[]>([]);
  const [besoinsParSite, setBesoinsParSite] = useState<BesoinParSite[]>([]);
  const [capacites, setCapacites] = useState<CapaciteEffective[]>([]);
  const [loading, setLoading] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedSiteId, setSelectedSiteId] = useState('');
  const [selectedBesoin, setSelectedBesoin] = useState<BesoinEffectif | null>(null);
  const { toast } = useToast();

  const weekEnd = endOfWeek(currentWeekStart, { weekStartsOn: 1 });

  useEffect(() => {
    fetchData();
  }, [currentWeekStart]);

  const fetchData = async () => {
    setLoading(true);
    try {
      await Promise.all([fetchBesoins(), fetchCapacites()]);
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
        secretaire:secretaires(first_name, name)
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

  const handleAddClick = (date: string, siteId: string) => {
    setSelectedDate(date);
    setSelectedSiteId(siteId);
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

  const handleDelete = async () => {
    if (!selectedBesoin) return;

    try {
      if (selectedBesoin.type === 'bloc_operatoire' && selectedBesoin.bloc_operatoire_besoin_id) {
        // Supprimer depuis bloc_operatoire_besoins (le trigger supprimera de besoin_effectif)
        const { error } = await supabase
          .from('bloc_operatoire_besoins')
          .delete()
          .eq('id', selectedBesoin.bloc_operatoire_besoin_id);

        if (error) throw error;
      } else {
        // Supprimer directement de besoin_effectif
        const { error } = await supabase
          .from('besoin_effectif')
          .delete()
          .eq('id', selectedBesoin.id);

        if (error) throw error;
      }

      toast({
        title: "Succès",
        description: "Besoin supprimé avec succès",
      });

      fetchData();
      setDeleteDialogOpen(false);
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
        <TabsList className="grid w-full grid-cols-2">
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
              {Object.entries(
                besoins.reduce((acc, besoin) => {
                  const siteId = besoin.site_id;
                  if (!acc[siteId]) {
                    acc[siteId] = {
                      site_nom: besoin.site?.nom || 'Site inconnu',
                      besoins: []
                    };
                  }
                  acc[siteId].besoins.push(besoin);
                  return acc;
                }, {} as Record<string, { site_nom: string; besoins: BesoinEffectif[] }>)
              ).map(([siteId, { site_nom, besoins: besoinsSite }]) => {
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
                  <Card key={siteId}>
                    <CardHeader className="bg-primary/5">
                      <div className="flex items-center justify-between">
                        <CardTitle className="flex items-center gap-2">
                          <Building2 className="h-6 w-6 text-primary" />
                          {site_nom}
                        </CardTitle>
                        <div className="flex items-center gap-4">
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
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-6">
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
                              
                              // Construire la liste des jours
                              const jours = besoinsTries.map(b => 
                                format(new Date(b.date), 'EEE d/M', { locale: fr })
                              ).join(', ');
                              
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
                                  <td className="p-2 text-sm font-medium">
                                    {jours}
                                  </td>
                                  <td className="p-2 text-sm">
                                    {horaires}
                                  </td>
                                  <td className="p-2 text-right font-medium">
                                    {totalSecretairesPersonne.toFixed(1)}
                                  </td>
                                  <td className="p-2 text-right">
                                    <div className="flex justify-end gap-1">
                                      {besoinsGroupe.map((besoin) => (
                                        <div key={besoin.id} className="flex gap-1">
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleEditClick(besoin)}
                                            title={`Modifier ${format(new Date(besoin.date), 'd/M', { locale: fr })}`}
                                          >
                                            <Edit className="h-4 w-4" />
                                          </Button>
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleDeleteClick(besoin)}
                                            className="text-destructive hover:text-destructive"
                                            title={`Supprimer ${format(new Date(besoin.date), 'd/M', { locale: fr })}`}
                                          >
                                            <Trash2 className="h-4 w-4" />
                                          </Button>
                                        </div>
                                      ))}
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
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="capacites" className="space-y-4">
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
                      {capacitesJour.map((capacite) => (
                        <div key={capacite.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                          <div className="flex-1">
                            <div className="font-medium">
                              {capacite.secretaire ? `${capacite.secretaire.first_name} ${capacite.secretaire.name}` : 'Secrétaire inconnu'}
                            </div>
                            <div className="text-sm text-muted-foreground mt-1">
                              {capacite.specialites && capacite.specialites.length > 0 
                                ? capacite.specialites.join(', ')
                                : 'Aucune spécialité'}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-medium text-lg">
                              {capacite.heure_debut.slice(0, 5)} - {capacite.heure_fin.slice(0, 5)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <AddBesoinDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        date={selectedDate}
        siteId={selectedSiteId}
        onSuccess={fetchData}
      />

      <EditBesoinDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        besoin={selectedBesoin}
        onSuccess={fetchData}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer la suppression</AlertDialogTitle>
            <AlertDialogDescription>
              Êtes-vous sûr de vouloir supprimer ce besoin ? Cette action est irréversible.
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
    </div>
  );
}
