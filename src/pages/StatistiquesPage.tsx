import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';

interface SpecialiteStats {
  specialite: string;
  specialite_id: string;
  total_heures: number;
  color: string;
}

interface JourStats {
  jour: string;
  heures: number;
}

const JOURS_SEMAINE = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const COLORS = ['hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))'];

export default function StatistiquesPage() {
  const [besoinsStats, setBesoinsStats] = useState<SpecialiteStats[]>([]);
  const [capacitesStats, setCapacitesStats] = useState<SpecialiteStats[]>([]);
  const [selectedBesoinsSpecialite, setSelectedBesoinsSpecialite] = useState<string | null>(null);
  const [selectedCapacitesSpecialite, setSelectedCapacitesSpecialite] = useState<string | null>(null);
  const [besoinsDetailJour, setBesoinsDetailJour] = useState<JourStats[]>([]);
  const [capacitesDetailJour, setCapacitesDetailJour] = useState<JourStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      setLoading(true);

      // Fetch besoins (horaires base médecins)
      const { data: horairesMedecins, error: errorMedecins } = await supabase
        .from('horaires_base_medecins')
        .select(`
          *,
          medecins!inner(specialite_id),
          specialites:medecins(specialite_id(id, nom, code))
        `)
        .eq('actif', true);

      if (errorMedecins) throw errorMedecins;

      // Fetch capacités (horaires base secrétaires)
      const { data: horairesSecretaires, error: errorSecretaires } = await supabase
        .from('horaires_base_secretaires')
        .select(`
          *,
          secretaires!inner(specialites)
        `)
        .eq('actif', true);

      if (errorSecretaires) throw errorSecretaires;

      // Fetch all specialites
      const { data: specialites } = await supabase
        .from('specialites')
        .select('*');

      const specialitesMap = new Map(specialites?.map(s => [s.id, s]) || []);

      // Process besoins par spécialité
      const besoinsMap = new Map<string, number>();
      horairesMedecins?.forEach((horaire: any) => {
        const specialiteId = horaire.medecins?.specialite_id;
        if (!specialiteId) return;
        
        const debut = new Date(`2000-01-01T${horaire.heure_debut}`);
        const fin = new Date(`2000-01-01T${horaire.heure_fin}`);
        const heures = (fin.getTime() - debut.getTime()) / (1000 * 60 * 60);
        
        besoinsMap.set(specialiteId, (besoinsMap.get(specialiteId) || 0) + heures);
      });

      const besoinsData: SpecialiteStats[] = Array.from(besoinsMap.entries()).map(([id, heures], index) => ({
        specialite: specialitesMap.get(id)?.nom || 'Inconnu',
        specialite_id: id,
        total_heures: Math.round(heures * 10) / 10,
        color: COLORS[index % COLORS.length]
      }));

      // Process capacités par spécialité
      const capacitesMap = new Map<string, number>();
      horairesSecretaires?.forEach((horaire: any) => {
        const specialites = horaire.secretaires?.specialites || [];
        
        const debut = new Date(`2000-01-01T${horaire.heure_debut}`);
        const fin = new Date(`2000-01-01T${horaire.heure_fin}`);
        const heures = (fin.getTime() - debut.getTime()) / (1000 * 60 * 60);
        
        specialites.forEach((specId: string) => {
          capacitesMap.set(specId, (capacitesMap.get(specId) || 0) + heures);
        });
      });

      const capacitesData: SpecialiteStats[] = Array.from(capacitesMap.entries()).map(([id, heures], index) => ({
        specialite: specialitesMap.get(id)?.nom || 'Inconnu',
        specialite_id: id,
        total_heures: Math.round(heures * 10) / 10,
        color: COLORS[index % COLORS.length]
      }));

      setBesoinsStats(besoinsData);
      setCapacitesStats(capacitesData);
    } catch (error) {
      console.error('Error fetching stats:', error);
      toast.error('Erreur lors du chargement des statistiques');
    } finally {
      setLoading(false);
    }
  };

  const fetchBesoinsDetailJour = async (specialiteId: string) => {
    try {
      const { data, error } = await supabase
        .from('horaires_base_medecins')
        .select(`
          *,
          medecins!inner(specialite_id)
        `)
        .eq('actif', true)
        .eq('medecins.specialite_id', specialiteId);

      if (error) throw error;

      const jourMap = new Map<number, number>();
      data?.forEach((horaire: any) => {
        const debut = new Date(`2000-01-01T${horaire.heure_debut}`);
        const fin = new Date(`2000-01-01T${horaire.heure_fin}`);
        const heures = (fin.getTime() - debut.getTime()) / (1000 * 60 * 60);
        
        jourMap.set(horaire.jour_semaine, (jourMap.get(horaire.jour_semaine) || 0) + heures);
      });

      const detailData: JourStats[] = JOURS_SEMAINE.map((jour, index) => ({
        jour,
        heures: Math.round((jourMap.get(index + 1) || 0) * 10) / 10
      }));

      setBesoinsDetailJour(detailData);
    } catch (error) {
      console.error('Error fetching detail:', error);
      toast.error('Erreur lors du chargement du détail');
    }
  };

  const fetchCapacitesDetailJour = async (specialiteId: string) => {
    try {
      const { data, error } = await supabase
        .from('horaires_base_secretaires')
        .select(`
          *,
          secretaires!inner(specialites)
        `)
        .eq('actif', true);

      if (error) throw error;

      const jourMap = new Map<number, number>();
      data?.forEach((horaire: any) => {
        const specialites = horaire.secretaires?.specialites || [];
        if (!specialites.includes(specialiteId)) return;

        const debut = new Date(`2000-01-01T${horaire.heure_debut}`);
        const fin = new Date(`2000-01-01T${horaire.heure_fin}`);
        const heures = (fin.getTime() - debut.getTime()) / (1000 * 60 * 60);
        
        jourMap.set(horaire.jour_semaine, (jourMap.get(horaire.jour_semaine) || 0) + heures);
      });

      const detailData: JourStats[] = JOURS_SEMAINE.map((jour, index) => ({
        jour,
        heures: Math.round((jourMap.get(index + 1) || 0) * 10) / 10
      }));

      setCapacitesDetailJour(detailData);
    } catch (error) {
      console.error('Error fetching detail:', error);
      toast.error('Erreur lors du chargement du détail');
    }
  };

  const handleBesoinsBarClick = (data: any) => {
    setSelectedBesoinsSpecialite(data.specialite_id);
    fetchBesoinsDetailJour(data.specialite_id);
  };

  const handleCapacitesBarClick = (data: any) => {
    setSelectedCapacitesSpecialite(data.specialite_id);
    fetchCapacitesDetailJour(data.specialite_id);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Chargement des statistiques...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Statistiques</h1>
        <p className="text-muted-foreground">Analyse des besoins et capacités par spécialité</p>
      </div>

      <Tabs defaultValue="besoins" className="space-y-6">
        <TabsList>
          <TabsTrigger value="besoins">Besoins (Médecins)</TabsTrigger>
          <TabsTrigger value="capacites">Capacités (Secrétaires)</TabsTrigger>
        </TabsList>

        <TabsContent value="besoins" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Besoins par Spécialité</CardTitle>
              <CardDescription>
                Heures totales par semaine selon les horaires de base des médecins. Cliquez sur une barre pour voir le détail par jour.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={besoinsStats}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="specialite" stroke="hsl(var(--foreground))" />
                  <YAxis stroke="hsl(var(--foreground))" label={{ value: 'Heures', angle: -90, position: 'insideLeft' }} />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--popover))', 
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px'
                    }}
                  />
                  <Bar dataKey="total_heures" onClick={handleBesoinsBarClick} cursor="pointer">
                    {besoinsStats.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {selectedBesoinsSpecialite && besoinsDetailJour.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Détail par Jour de la Semaine</CardTitle>
                <CardDescription>
                  {besoinsStats.find(s => s.specialite_id === selectedBesoinsSpecialite)?.specialite}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={besoinsDetailJour}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="jour" stroke="hsl(var(--foreground))" />
                    <YAxis stroke="hsl(var(--foreground))" label={{ value: 'Heures', angle: -90, position: 'insideLeft' }} />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--popover))', 
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px'
                      }}
                    />
                    <Bar 
                      dataKey="heures" 
                      fill={besoinsStats.find(s => s.specialite_id === selectedBesoinsSpecialite)?.color || COLORS[0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="capacites" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Capacités par Spécialité</CardTitle>
              <CardDescription>
                Heures totales par semaine selon les horaires de base des secrétaires. Cliquez sur une barre pour voir le détail par jour.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={capacitesStats}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="specialite" stroke="hsl(var(--foreground))" />
                  <YAxis stroke="hsl(var(--foreground))" label={{ value: 'Heures', angle: -90, position: 'insideLeft' }} />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--popover))', 
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px'
                    }}
                  />
                  <Bar dataKey="total_heures" onClick={handleCapacitesBarClick} cursor="pointer">
                    {capacitesStats.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {selectedCapacitesSpecialite && capacitesDetailJour.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Détail par Jour de la Semaine</CardTitle>
                <CardDescription>
                  {capacitesStats.find(s => s.specialite_id === selectedCapacitesSpecialite)?.specialite}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={capacitesDetailJour}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="jour" stroke="hsl(var(--foreground))" />
                    <YAxis stroke="hsl(var(--foreground))" label={{ value: 'Heures', angle: -90, position: 'insideLeft' }} />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--popover))', 
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px'
                      }}
                    />
                    <Bar 
                      dataKey="heures" 
                      fill={capacitesStats.find(s => s.specialite_id === selectedCapacitesSpecialite)?.color || COLORS[0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
