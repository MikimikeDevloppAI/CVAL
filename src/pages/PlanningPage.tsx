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
  site?: { nom: string };
  specialites?: string[];
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
        secretaire:secretaires(first_name, name),
        site:sites(nom)
      `)
      .gte('date', format(currentWeekStart, 'yyyy-MM-dd'))
      .lte('date', format(weekEnd, 'yyyy-MM-dd'))
      .eq('actif', true)
      .order('date')
      .order('heure_debut');

    if (error) throw error;
    setCapacites(data || []);
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
                  const date = besoin.date;
                  if (!acc[date]) acc[date] = [];
                  acc[date].push(besoin);
                  return acc;
                }, {} as Record<string, BesoinEffectif[]>)
              ).map(([date, besoinsJour]) => {
                // Regrouper par site pour ce jour
                const besoinsParSite = besoinsJour.reduce((acc, besoin) => {
                  const siteId = besoin.site_id;
                  if (!acc[siteId]) {
                    acc[siteId] = {
                      site_nom: besoin.site?.nom || 'Site inconnu',
                      besoins: []
                    };
                  }
                  acc[siteId].besoins.push(besoin);
                  return acc;
                }, {} as Record<string, { site_nom: string; besoins: BesoinEffectif[] }>);

                return (
                  <Card key={date}>
                    <CardHeader className="bg-muted/50">
                      <CardTitle className="flex items-center gap-2">
                        <Clock className="h-5 w-5 text-primary" />
                        {format(new Date(date), 'EEEE d MMMM yyyy', { locale: fr })}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-6">
                      <div className="space-y-6">
                        {Object.entries(besoinsParSite).map(([siteId, { site_nom, besoins: besoinsSite }]) => {
                          const medecins = besoinsSite.filter(b => b.type === 'medecin');
                          const blocs = besoinsSite.filter(b => b.type === 'bloc_operatoire');
                          const totalSecretaires = besoinsSite.reduce((sum, b) => sum + b.nombre_secretaires_requis, 0);

                          return (
                            <div key={siteId} className="space-y-3">
                              <div className="flex items-center justify-between bg-primary/5 p-3 rounded-lg">
                                <div className="flex items-center gap-2">
                                  <Building2 className="h-5 w-5 text-primary" />
                                  <h3 className="font-semibold text-lg">{site_nom}</h3>
                                </div>
                                <div className="flex items-center gap-4">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleAddClick(date, siteId)}
                                  >
                                    <Plus className="h-4 w-4 mr-1" />
                                    Ajouter un besoin
                                  </Button>
                                  <Separator orientation="vertical" className="h-10" />
                                  <div className="text-right">
                                    <div className="text-sm text-muted-foreground">Médecins</div>
                                    <div className="font-bold text-lg">{medecins.length}</div>
                                  </div>
                                  <Separator orientation="vertical" className="h-10" />
                                  <div className="text-right">
                                    <div className="text-sm text-muted-foreground">Secrétaires requis</div>
                                    <div className="font-bold text-lg text-primary">{Math.ceil(totalSecretaires)}</div>
                                  </div>
                                </div>
                              </div>

                              <div className="overflow-x-auto">
                                <table className="w-full border-collapse">
                                  <thead>
                                    <tr className="border-b-2">
                                      <th className="text-left p-2 font-medium text-sm text-muted-foreground">Type</th>
                                      <th className="text-left p-2 font-medium text-sm text-muted-foreground">Médecin / Détail</th>
                                      <th className="text-left p-2 font-medium text-sm text-muted-foreground">Spécialité</th>
                                      <th className="text-left p-2 font-medium text-sm text-muted-foreground">Horaires</th>
                                      <th className="text-right p-2 font-medium text-sm text-muted-foreground">Secrétaires</th>
                                      <th className="text-right p-2 font-medium text-sm text-muted-foreground">Actions</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {medecins.map((besoin) => (
                                      <tr key={besoin.id} className="border-b hover:bg-muted/30">
                                        <td className="p-2">
                                          <Badge variant="default">Médecin</Badge>
                                        </td>
                                        <td className="p-2 font-medium">
                                          {besoin.medecin ? `${besoin.medecin.first_name} ${besoin.medecin.name}` : '-'}
                                        </td>
                                        <td className="p-2 text-sm text-muted-foreground">
                                          {besoin.specialite?.nom || '-'}
                                        </td>
                                        <td className="p-2 text-sm">
                                          {besoin.heure_debut.slice(0, 5)} - {besoin.heure_fin.slice(0, 5)}
                                        </td>
                                        <td className="p-2 text-right font-medium">
                                          {besoin.nombre_secretaires_requis}
                                        </td>
                                        <td className="p-2 text-right">
                                          <div className="flex justify-end gap-1">
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              onClick={() => handleEditClick(besoin)}
                                            >
                                              <Edit className="h-4 w-4" />
                                            </Button>
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              onClick={() => handleDeleteClick(besoin)}
                                              className="text-destructive hover:text-destructive"
                                            >
                                              <Trash2 className="h-4 w-4" />
                                            </Button>
                                          </div>
                                        </td>
                                      </tr>
                                    ))}
                                    {blocs.map((besoin) => (
                                      <tr key={besoin.id} className="border-b hover:bg-muted/30 bg-blue-50/50">
                                        <td className="p-2">
                                          <Badge variant="secondary">Bloc opératoire</Badge>
                                        </td>
                                        <td className="p-2 font-medium text-blue-700">
                                          Intervention chirurgicale
                                        </td>
                                        <td className="p-2 text-sm text-muted-foreground">
                                          {besoin.specialite?.nom || '-'}
                                        </td>
                                        <td className="p-2 text-sm">
                                          {besoin.heure_debut.slice(0, 5)} - {besoin.heure_fin.slice(0, 5)}
                                        </td>
                                        <td className="p-2 text-right font-medium">
                                          {besoin.nombre_secretaires_requis}
                                        </td>
                                        <td className="p-2 text-right">
                                          <div className="flex justify-end gap-1">
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              onClick={() => handleEditClick(besoin)}
                                            >
                                              <Edit className="h-4 w-4" />
                                            </Button>
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              onClick={() => handleDeleteClick(besoin)}
                                              className="text-destructive hover:text-destructive"
                                            >
                                              <Trash2 className="h-4 w-4" />
                                            </Button>
                                          </div>
                                        </td>
                                      </tr>
                                    ))}
                                    <tr className="font-bold bg-muted/50">
                                      <td colSpan={5} className="p-2 text-right">TOTAL</td>
                                      <td className="p-2 text-right text-primary text-lg">
                                        {Math.ceil(totalSecretaires)}
                                      </td>
                                    </tr>
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          );
                        })}
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
                            <div className="text-sm text-muted-foreground">
                              {capacite.site?.nom || 'Site non défini'}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-medium">
                              {capacite.heure_debut.slice(0, 5)} - {capacite.heure_fin.slice(0, 5)}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {capacite.specialites && capacite.specialites.length > 0 
                                ? `${capacite.specialites.length} spécialité(s)`
                                : 'Aucune spécialité'}
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
