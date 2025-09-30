import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Building2, Users, Clock } from 'lucide-react';
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

interface BesoinEffectif {
  id: string;
  date: string;
  type: string;
  heure_debut: string;
  heure_fin: string;
  nombre_secretaires_requis: number;
  site_id: string;
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
          ) : besoinsParSite.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              Aucun besoin pour cette semaine
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {besoinsParSite.map((siteBesoin) => (
                <Card key={siteBesoin.site_id} className="overflow-hidden">
                  <CardHeader className="bg-muted/50">
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Building2 className="h-5 w-5 text-primary" />
                      {siteBesoin.site_nom}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-4 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <div className="text-2xl font-bold">{siteBesoin.total_medecins}</div>
                          <div className="text-xs text-muted-foreground">Médecins</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <div className="text-2xl font-bold">{Math.ceil(siteBesoin.total_secretaires_requis)}</div>
                          <div className="text-xs text-muted-foreground">Secrétaires requis</div>
                        </div>
                      </div>
                    </div>
                    
                    <Separator />
                    
                    <div className="flex items-center gap-2 text-sm">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">
                        {siteBesoin.plage_horaire.debut.slice(0, 5)} - {siteBesoin.plage_horaire.fin.slice(0, 5)}
                      </span>
                    </div>
                    
                    <Separator />
                    
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-muted-foreground">Détail par jour:</div>
                      {Object.entries(
                        siteBesoin.besoins.reduce((acc, b) => {
                          if (!acc[b.date]) acc[b.date] = [];
                          acc[b.date].push(b);
                          return acc;
                        }, {} as Record<string, BesoinEffectif[]>)
                      ).map(([date, besoins]) => (
                        <div key={date} className="text-sm">
                          <div className="font-medium">
                            {format(new Date(date), 'EEEE d MMM', { locale: fr })}
                          </div>
                          <div className="text-muted-foreground pl-2">
                            {besoins.filter(b => b.type === 'medecin').length} médecin(s) • {' '}
                            {Math.ceil(besoins.reduce((sum, b) => sum + b.nombre_secretaires_requis, 0))} secrétaire(s)
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
    </div>
  );
}
