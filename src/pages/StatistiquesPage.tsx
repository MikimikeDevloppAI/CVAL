import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';

interface SpecialiteStats {
  specialite: string;
  specialite_id: string;
  besoins: number;
  capacites: number;
}

interface JourStats {
  jour: string;
  besoins: number;
  capacites: number;
}

const JOURS_SEMAINE = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

export default function StatistiquesPage() {
  const [stats, setStats] = useState<SpecialiteStats[]>([]);
  const [selectedSpecialite, setSelectedSpecialite] = useState<string | null>(null);
  const [detailJour, setDetailJour] = useState<JourStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      setLoading(true);

      // Fetch all specialites
      const { data: specialites } = await supabase
        .from('specialites')
        .select('*');

      const specialitesMap = new Map(specialites?.map(s => [s.id, s]) || []);

      // Fetch besoins (horaires base médecins)
      const { data: horairesMedecins, error: errorMedecins } = await supabase
        .from('horaires_base_medecins')
        .select(`
          *,
          medecins!inner(specialite_id)
        `)
        .eq('actif', true);

      if (errorMedecins) throw errorMedecins;

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

      // Fetch capacités (horaires base secrétaires)
      const { data: horairesSecretaires, error: errorSecretaires } = await supabase
        .from('horaires_base_secretaires')
        .select(`
          *,
          secretaires!inner(specialites)
        `)
        .eq('actif', true);

      if (errorSecretaires) throw errorSecretaires;

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

      // Merge besoins and capacites
      const allSpecialiteIds = new Set([...besoinsMap.keys(), ...capacitesMap.keys()]);
      const mergedData: SpecialiteStats[] = Array.from(allSpecialiteIds).map(id => ({
        specialite: specialitesMap.get(id)?.nom || 'Inconnu',
        specialite_id: id,
        besoins: Math.round((besoinsMap.get(id) || 0) * 10) / 10,
        capacites: Math.round((capacitesMap.get(id) || 0) * 10) / 10,
      })).sort((a, b) => a.specialite.localeCompare(b.specialite));

      setStats(mergedData);
    } catch (error) {
      console.error('Error fetching stats:', error);
      toast.error('Erreur lors du chargement des statistiques');
    } finally {
      setLoading(false);
    }
  };

  const fetchDetailJour = async (specialiteId: string) => {
    try {
      // Fetch besoins detail
      const { data: horairesMedecins, error: errorMedecins } = await supabase
        .from('horaires_base_medecins')
        .select(`
          *,
          medecins!inner(specialite_id)
        `)
        .eq('actif', true)
        .eq('medecins.specialite_id', specialiteId);

      if (errorMedecins) throw errorMedecins;

      const besoinsJourMap = new Map<number, number>();
      horairesMedecins?.forEach((horaire: any) => {
        const debut = new Date(`2000-01-01T${horaire.heure_debut}`);
        const fin = new Date(`2000-01-01T${horaire.heure_fin}`);
        const heures = (fin.getTime() - debut.getTime()) / (1000 * 60 * 60);
        
        besoinsJourMap.set(horaire.jour_semaine, (besoinsJourMap.get(horaire.jour_semaine) || 0) + heures);
      });

      // Fetch capacites detail
      const { data: horairesSecretaires, error: errorSecretaires } = await supabase
        .from('horaires_base_secretaires')
        .select(`
          *,
          secretaires!inner(specialites)
        `)
        .eq('actif', true);

      if (errorSecretaires) throw errorSecretaires;

      const capacitesJourMap = new Map<number, number>();
      horairesSecretaires?.forEach((horaire: any) => {
        const specialites = horaire.secretaires?.specialites || [];
        if (!specialites.includes(specialiteId)) return;

        const debut = new Date(`2000-01-01T${horaire.heure_debut}`);
        const fin = new Date(`2000-01-01T${horaire.heure_fin}`);
        const heures = (fin.getTime() - debut.getTime()) / (1000 * 60 * 60);
        
        capacitesJourMap.set(horaire.jour_semaine, (capacitesJourMap.get(horaire.jour_semaine) || 0) + heures);
      });

      const detailData: JourStats[] = JOURS_SEMAINE.map((jour, index) => ({
        jour,
        besoins: Math.round((besoinsJourMap.get(index + 1) || 0) * 10) / 10,
        capacites: Math.round((capacitesJourMap.get(index + 1) || 0) * 10) / 10,
      }));

      setDetailJour(detailData);
    } catch (error) {
      console.error('Error fetching detail:', error);
      toast.error('Erreur lors du chargement du détail');
    }
  };

  const handleBarClick = (data: any) => {
    if (data && data.specialite_id) {
      setSelectedSpecialite(data.specialite_id);
      fetchDetailJour(data.specialite_id);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Chargement des statistiques...</p>
      </div>
    );
  }

  const renderCustomLabel = (props: any) => {
    const { x, y, width, value } = props;
    if (value === 0) return null;
    return (
      <text 
        x={x + width + 5} 
        y={y + 12} 
        fill="hsl(var(--foreground))" 
        fontSize={11}
        fontWeight={500}
      >
        {value}h
      </text>
    );
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Statistiques</h1>
        <p className="text-muted-foreground">Analyse des besoins et capacités par spécialité (heures hebdomadaires)</p>
      </div>

      <Card className="border-border/50 shadow-lg">
        <CardHeader>
          <CardTitle>Besoins vs Capacités par Spécialité</CardTitle>
          <CardDescription>
            Basé sur les horaires de base des médecins et secrétaires
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="global" className="space-y-6">
            <div className="flex justify-end">
              <TabsList className="grid w-full max-w-md grid-cols-2">
                <TabsTrigger value="global">Vue Globale</TabsTrigger>
                <TabsTrigger value="detail">
                  Détail par Jour
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="global" className="space-y-4">
              <p className="text-sm text-muted-foreground">Cliquez sur une spécialité pour voir le détail par jour</p>
              <ResponsiveContainer width="100%" height={stats.length * 70 + 100}>
                <BarChart 
                  data={stats} 
                  layout="vertical"
                  onClick={handleBarClick}
                  margin={{ left: 100, right: 80, top: 20, bottom: 20 }}
                  barCategoryGap="20%"
                >
                  <XAxis 
                    type="number"
                    stroke="hsl(var(--muted-foreground))"
                    tick={{ fontSize: 12 }}
                    label={{ value: 'Heures', position: 'insideBottom', offset: -10, style: { fill: 'hsl(var(--muted-foreground))' } }}
                  />
                  <YAxis 
                    type="category"
                    dataKey="specialite" 
                    stroke="hsl(var(--muted-foreground))"
                    tick={{ fontSize: 12 }}
                    width={90}
                    axisLine={false}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--popover))', 
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '12px',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                    }}
                    cursor={{ fill: 'hsl(var(--muted))', opacity: 0.1 }}
                  />
                  <Legend 
                    wrapperStyle={{ paddingTop: '20px' }}
                    iconType="rect"
                  />
                  <Bar 
                    dataKey="besoins" 
                    fill="hsl(217 91% 60%)" 
                    radius={[0, 8, 8, 0]}
                    name="Besoins"
                    cursor="pointer"
                    label={renderCustomLabel}
                    style={{
                      filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.1))',
                    }}
                  />
                  <Bar 
                    dataKey="capacites" 
                    fill="hsl(142 76% 36%)" 
                    radius={[0, 8, 8, 0]}
                    name="Capacités"
                    cursor="pointer"
                    label={renderCustomLabel}
                    style={{
                      filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.1))',
                    }}
                  />
                </BarChart>
              </ResponsiveContainer>
            </TabsContent>

            <TabsContent value="detail">
              {selectedSpecialite && detailJour.length > 0 ? (
                <div className="space-y-4">
                  <p className="text-sm font-medium">
                    {stats.find(s => s.specialite_id === selectedSpecialite)?.specialite}
                  </p>
                  <ResponsiveContainer width="100%" height={450}>
                    <BarChart 
                      data={detailJour} 
                      layout="vertical"
                      margin={{ left: 80, right: 80, top: 20, bottom: 20 }}
                      barCategoryGap="20%"
                    >
                      <XAxis 
                        type="number"
                        stroke="hsl(var(--muted-foreground))"
                        tick={{ fontSize: 12 }}
                        label={{ value: 'Heures', position: 'insideBottom', offset: -10, style: { fill: 'hsl(var(--muted-foreground))' } }}
                      />
                      <YAxis 
                        type="category"
                        dataKey="jour" 
                        stroke="hsl(var(--muted-foreground))"
                        tick={{ fontSize: 12 }}
                        width={70}
                        axisLine={false}
                      />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(var(--popover))', 
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '12px',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                        }}
                      />
                      <Legend 
                        wrapperStyle={{ paddingTop: '20px' }}
                        iconType="rect"
                      />
                      <Bar 
                        dataKey="besoins" 
                        fill="hsl(217 91% 60%)" 
                        radius={[0, 8, 8, 0]}
                        name="Besoins"
                        label={renderCustomLabel}
                        style={{
                          filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.1))',
                        }}
                      />
                      <Bar 
                        dataKey="capacites" 
                        fill="hsl(142 76% 36%)" 
                        radius={[0, 8, 8, 0]}
                        name="Capacités"
                        label={renderCustomLabel}
                        style={{
                          filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.1))',
                        }}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="flex items-center justify-center h-64">
                  <p className="text-muted-foreground">Cliquez sur une spécialité dans la vue globale pour voir le détail</p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
