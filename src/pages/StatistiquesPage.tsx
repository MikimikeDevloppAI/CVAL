import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

interface SiteStats {
  site_id: string;
  site_nom: string;
  semaine_paire: {
    lundi_matin: number;
    lundi_apres_midi: number;
    mardi_matin: number;
    mardi_apres_midi: number;
    mercredi_matin: number;
    mercredi_apres_midi: number;
    jeudi_matin: number;
    jeudi_apres_midi: number;
    vendredi_matin: number;
    vendredi_apres_midi: number;
  };
  semaine_impaire: {
    lundi_matin: number;
    lundi_apres_midi: number;
    mardi_matin: number;
    mardi_apres_midi: number;
    mercredi_matin: number;
    mercredi_apres_midi: number;
    jeudi_matin: number;
    jeudi_apres_midi: number;
    vendredi_matin: number;
    vendredi_apres_midi: number;
  };
}

const JOURS = [
  { label: 'Lundi', key: 'lundi', jour_semaine: 1 },
  { label: 'Mardi', key: 'mardi', jour_semaine: 2 },
  { label: 'Mercredi', key: 'mercredi', jour_semaine: 3 },
  { label: 'Jeudi', key: 'jeudi', jour_semaine: 4 },
  { label: 'Vendredi', key: 'vendredi', jour_semaine: 5 },
];

export default function StatistiquesPage() {
  const [stats, setStats] = useState<SiteStats[]>([]);
  const [selectedSite, setSelectedSite] = useState<string>('all');
  const [selectedTypeSemaine, setSelectedTypeSemaine] = useState<'paire' | 'impaire'>('paire');
  const [loading, setLoading] = useState(true);
  const [sites, setSites] = useState<Array<{ id: string; nom: string }>>([]);

  useEffect(() => {
    fetchSites();
    fetchStats();
  }, []);

  const fetchSites = async () => {
    try {
      const { data, error } = await supabase
        .from('sites')
        .select('id, nom')
        .eq('actif', true)
        .order('nom');

      if (error) throw error;
      setSites(data || []);
    } catch (error) {
      console.error('Error fetching sites:', error);
      toast.error('Erreur lors du chargement des sites');
    }
  };

  const fetchStats = async () => {
    try {
      setLoading(true);

      // Fetch tous les horaires de base des médecins
      const { data: horairesMedecins, error: errorMedecins } = await supabase
        .from('horaires_base_medecins')
        .select(`
          *,
          sites!inner(id, nom),
          medecins!inner(id, first_name, name, besoin_secretaires)
        `)
        .eq('actif', true);

      if (errorMedecins) throw errorMedecins;

      // Fetch les besoins du bloc opératoire
      const { data: horairesBloc, error: errorBloc } = await supabase
        .from('horaires_base_medecins')
        .select(`
          *,
          sites!inner(id, nom),
          types_intervention!inner(
            id,
            nom,
            types_intervention_besoins_personnel(
              type_besoin,
              nombre_requis
            )
          )
        `)
        .eq('actif', true)
        .not('type_intervention_id', 'is', null);

      if (errorBloc) throw errorBloc;

      // Grouper par site
      const sitesMap = new Map<string, SiteStats>();

      // Traiter les horaires médecins normaux
      horairesMedecins?.forEach((horaire: any) => {
        const siteId = horaire.site_id;
        const siteNom = horaire.sites.nom;
        const jourSemaine = horaire.jour_semaine;
        const demiJournee = horaire.demi_journee;
        const besoins = horaire.medecins?.besoin_secretaires || 1.2;
        const alternanceType = horaire.alternance_type || 'hebdomadaire';
        const alternanceModulo = horaire.alternance_semaine_modulo || 0;

        if (!sitesMap.has(siteId)) {
          sitesMap.set(siteId, {
            site_id: siteId,
            site_nom: siteNom,
            semaine_paire: {
              lundi_matin: 0, lundi_apres_midi: 0,
              mardi_matin: 0, mardi_apres_midi: 0,
              mercredi_matin: 0, mercredi_apres_midi: 0,
              jeudi_matin: 0, jeudi_apres_midi: 0,
              vendredi_matin: 0, vendredi_apres_midi: 0,
            },
            semaine_impaire: {
              lundi_matin: 0, lundi_apres_midi: 0,
              mardi_matin: 0, mardi_apres_midi: 0,
              mercredi_matin: 0, mercredi_apres_midi: 0,
              jeudi_matin: 0, jeudi_apres_midi: 0,
              vendredi_matin: 0, vendredi_apres_midi: 0,
            },
          });
        }

        const siteStats = sitesMap.get(siteId)!;
        const jourKey = JOURS.find(j => j.jour_semaine === jourSemaine)?.key;
        if (!jourKey) return;

        let addPaire = false;
        let addImpaire = false;

        if (alternanceType === 'hebdomadaire') {
          addPaire = true;
          addImpaire = true;
        } else if (alternanceType === 'une_sur_deux') {
          if (alternanceModulo === 0) {
            addPaire = true;
          } else {
            addImpaire = true;
          }
        } else if (alternanceType === 'une_sur_trois') {
          if (alternanceModulo === 0 || alternanceModulo === 2) {
            addPaire = true;
          }
          if (alternanceModulo === 1 || alternanceModulo === 2) {
            addImpaire = true;
          }
        } else if (alternanceType === 'une_sur_quatre') {
          if (alternanceModulo === 0 || alternanceModulo === 2) {
            addPaire = true;
          }
          if (alternanceModulo === 1 || alternanceModulo === 3) {
            addImpaire = true;
          }
        }

        if (demiJournee === 'matin' || demiJournee === 'toute_journee') {
          const key = `${jourKey}_matin` as keyof typeof siteStats.semaine_paire;
          if (addPaire) siteStats.semaine_paire[key] += besoins;
          if (addImpaire) siteStats.semaine_impaire[key] += besoins;
        }
        
        if (demiJournee === 'apres_midi' || demiJournee === 'toute_journee') {
          const key = `${jourKey}_apres_midi` as keyof typeof siteStats.semaine_paire;
          if (addPaire) siteStats.semaine_paire[key] += besoins;
          if (addImpaire) siteStats.semaine_impaire[key] += besoins;
        }
      });

      // Traiter les besoins du bloc opératoire
      horairesBloc?.forEach((horaire: any) => {
        if (!horaire.types_intervention) return;

        const siteId = horaire.site_id;
        const siteNom = horaire.sites.nom;
        const jourSemaine = horaire.jour_semaine;
        const demiJournee = horaire.demi_journee;
        const alternanceType = horaire.alternance_type || 'hebdomadaire';
        const alternanceModulo = horaire.alternance_semaine_modulo || 0;

        const besoinsPersonnel = horaire.types_intervention.types_intervention_besoins_personnel || [];
        const totalBesoins = besoinsPersonnel.reduce((sum: number, besoin: any) => sum + (besoin.nombre_requis || 0), 0);

        if (totalBesoins === 0) return;

        if (!sitesMap.has(siteId)) {
          sitesMap.set(siteId, {
            site_id: siteId,
            site_nom: siteNom,
            semaine_paire: {
              lundi_matin: 0, lundi_apres_midi: 0,
              mardi_matin: 0, mardi_apres_midi: 0,
              mercredi_matin: 0, mercredi_apres_midi: 0,
              jeudi_matin: 0, jeudi_apres_midi: 0,
              vendredi_matin: 0, vendredi_apres_midi: 0,
            },
            semaine_impaire: {
              lundi_matin: 0, lundi_apres_midi: 0,
              mardi_matin: 0, mardi_apres_midi: 0,
              mercredi_matin: 0, mercredi_apres_midi: 0,
              jeudi_matin: 0, jeudi_apres_midi: 0,
              vendredi_matin: 0, vendredi_apres_midi: 0,
            },
          });
        }

        const siteStats = sitesMap.get(siteId)!;
        const jourKey = JOURS.find(j => j.jour_semaine === jourSemaine)?.key;
        if (!jourKey) return;

        let addPaire = false;
        let addImpaire = false;

        if (alternanceType === 'hebdomadaire') {
          addPaire = true;
          addImpaire = true;
        } else if (alternanceType === 'une_sur_deux') {
          if (alternanceModulo === 0) {
            addPaire = true;
          } else {
            addImpaire = true;
          }
        }

        if (demiJournee === 'matin' || demiJournee === 'toute_journee') {
          const key = `${jourKey}_matin` as keyof typeof siteStats.semaine_paire;
          if (addPaire) siteStats.semaine_paire[key] += totalBesoins;
          if (addImpaire) siteStats.semaine_impaire[key] += totalBesoins;
        }
        
        if (demiJournee === 'apres_midi' || demiJournee === 'toute_journee') {
          const key = `${jourKey}_apres_midi` as keyof typeof siteStats.semaine_paire;
          if (addPaire) siteStats.semaine_paire[key] += totalBesoins;
          if (addImpaire) siteStats.semaine_impaire[key] += totalBesoins;
        }
      });

      setStats(Array.from(sitesMap.values()).sort((a, b) => a.site_nom.localeCompare(b.site_nom)));
    } catch (error) {
      console.error('Error fetching stats:', error);
      toast.error('Erreur lors du chargement des statistiques');
    } finally {
      setLoading(false);
    }
  };

  const getChartData = () => {
    const filteredStats = selectedSite === 'all' 
      ? stats 
      : stats.filter(s => s.site_id === selectedSite);

    const typeSemaine = selectedTypeSemaine === 'paire' ? 'semaine_paire' : 'semaine_impaire';

    return JOURS.map(jour => {
      const dataPoint: any = { jour: jour.label };

      filteredStats.forEach(site => {
        const keyMatin = `${jour.key}_matin` as keyof typeof site.semaine_paire;
        const keyAM = `${jour.key}_apres_midi` as keyof typeof site.semaine_paire;
        
        const matin = site[typeSemaine][keyMatin];
        const apresMidi = site[typeSemaine][keyAM];
        
        // Arrondir au-dessus pour une meilleure lisibilité
        dataPoint[`${site.site_nom}_matin`] = Math.ceil(matin);
        dataPoint[`${site.site_nom}_apres_midi`] = Math.ceil(apresMidi);
      });

      return dataPoint;
    });
  };

  const getSummary = () => {
    const typeSemaine = selectedTypeSemaine === 'paire' ? 'semaine_paire' : 'semaine_impaire';
    const filteredStats = selectedSite === 'all' 
      ? stats 
      : stats.filter(s => s.site_id === selectedSite);

    let totalMatin = 0;
    let totalApresMidi = 0;

    filteredStats.forEach(site => {
      JOURS.forEach(jour => {
        const keyMatin = `${jour.key}_matin` as keyof typeof site.semaine_paire;
        const keyAM = `${jour.key}_apres_midi` as keyof typeof site.semaine_paire;
        totalMatin += site[typeSemaine][keyMatin];
        totalApresMidi += site[typeSemaine][keyAM];
      });
    });

    return {
      totalMatin: Math.round(totalMatin * 10) / 10,
      totalApresMidi: Math.round(totalApresMidi * 10) / 10,
      total: Math.round((totalMatin + totalApresMidi) * 10) / 10,
    };
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full gap-2">
        <Loader2 className="h-5 w-5 animate-spin" />
        <p className="text-muted-foreground">Chargement des statistiques...</p>
      </div>
    );
  }

  const chartData = getChartData();
  const summary = getSummary();

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Statistiques</h1>
        <p className="text-muted-foreground">
          Analyse des besoins en secrétaires par site et type de semaine
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <Card className="flex-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Site</CardTitle>
          </CardHeader>
          <CardContent>
            <Select value={selectedSite} onValueChange={setSelectedSite}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les sites</SelectItem>
                {sites.map(site => (
                  <SelectItem key={site.id} value={site.id}>
                    {site.nom}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Card className="flex-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Type de semaine</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs value={selectedTypeSemaine} onValueChange={(v) => setSelectedTypeSemaine(v as 'paire' | 'impaire')}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="paire">Semaine paire</TabsTrigger>
                <TabsTrigger value="impaire">Semaine impaire</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Besoins Matin</CardDescription>
            <CardTitle className="text-3xl">{summary.totalMatin}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Besoins Après-midi</CardDescription>
            <CardTitle className="text-3xl">{summary.totalApresMidi}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Total Hebdomadaire</CardDescription>
            <CardTitle className="text-3xl">{summary.total}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card className="shadow-lg border-border/40">
        <CardHeader className="border-b border-border/40 bg-gradient-to-br from-background to-muted/20">
          <CardTitle className="text-xl">Besoins par jour et période</CardTitle>
          <CardDescription>
            Basé sur les horaires de base des médecins et les besoins du bloc opératoire (arrondis au-dessus)
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <ResponsiveContainer width="100%" height={550}>
            <BarChart 
              data={chartData}
              margin={{ top: 20, right: 30, left: 20, bottom: 100 }}
              barGap={8}
              barCategoryGap="15%"
            >
              <defs>
                <linearGradient id="colorMatin" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(217 91% 60%)" stopOpacity={1}/>
                  <stop offset="100%" stopColor="hsl(217 91% 50%)" stopOpacity={0.85}/>
                </linearGradient>
                <linearGradient id="colorApresMidi" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(142 76% 40%)" stopOpacity={1}/>
                  <stop offset="100%" stopColor="hsl(142 76% 30%)" stopOpacity={0.85}/>
                </linearGradient>
              </defs>
              
              <CartesianGrid 
                strokeDasharray="3 3" 
                stroke="hsl(var(--border))" 
                opacity={0.2}
                vertical={false}
              />
              <XAxis 
                dataKey="jour" 
                stroke="hsl(var(--muted-foreground))"
                tick={{ fontSize: 13, fontWeight: 500 }}
                tickLine={false}
                axisLine={{ stroke: 'hsl(var(--border))', strokeWidth: 1 }}
              />
              <YAxis 
                stroke="hsl(var(--muted-foreground))"
                tick={{ fontSize: 12 }}
                tickLine={false}
                axisLine={{ stroke: 'hsl(var(--border))', strokeWidth: 1 }}
                label={{ 
                  value: 'Besoins (personnel)', 
                  angle: -90, 
                  position: 'insideLeft',
                  style: { 
                    fill: 'hsl(var(--muted-foreground))',
                    fontSize: 13,
                    fontWeight: 500
                  } 
                }}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'hsl(var(--popover))', 
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '12px',
                  boxShadow: '0 8px 16px rgba(0,0,0,0.15)',
                  padding: '12px'
                }}
                labelStyle={{ 
                  fontWeight: 600,
                  marginBottom: '8px',
                  color: 'hsl(var(--foreground))'
                }}
                itemStyle={{
                  padding: '4px 0'
                }}
                formatter={(value: any, name: string) => {
                  const parts = name.split('_');
                  const periode = parts[parts.length - 1] === 'matin' ? '🌅 Matin' : '🌆 Après-midi';
                  const site = parts.slice(0, -1).join(' ');
                  return [`${value} personnes`, `${site} - ${periode}`];
                }}
              />
              <Legend 
                wrapperStyle={{ 
                  paddingTop: '30px',
                  paddingBottom: '10px'
                }}
                layout="horizontal"
                verticalAlign="bottom"
                align="center"
                iconType="circle"
                iconSize={12}
                formatter={(value: string) => {
                  if (value === '_legend_matin') return <span style={{ fontWeight: 600, color: 'hsl(217 91% 60%)' }}>🌅 Matin</span>;
                  if (value === '_legend_apres_midi') return <span style={{ fontWeight: 600, color: 'hsl(142 76% 36%)' }}>🌆 Après-midi</span>;
                  return null;
                }}
                payload={[
                  { value: '_legend_matin', type: 'circle', color: 'hsl(217 91% 60%)' },
                  { value: '_legend_apres_midi', type: 'circle', color: 'hsl(142 76% 36%)' }
                ]}
              />
              {stats
                .filter(s => selectedSite === 'all' || s.site_id === selectedSite)
                .flatMap((site, siteIndex) => {
                  return [
                    <Bar 
                      key={`${site.site_nom}_matin`}
                      dataKey={`${site.site_nom}_matin`}
                      fill="url(#colorMatin)"
                      radius={[8, 8, 0, 0]}
                      legendType="none"
                    />,
                    <Bar 
                      key={`${site.site_nom}_apres_midi`}
                      dataKey={`${site.site_nom}_apres_midi`}
                      fill="url(#colorApresMidi)"
                      radius={[8, 8, 0, 0]}
                      legendType="none"
                    />
                  ];
                })}
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Détail par site</CardTitle>
          <CardDescription>
            Vue détaillée des besoins pour chaque site
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {stats
              .filter(s => selectedSite === 'all' || s.site_id === selectedSite)
              .map(site => {
                const typeSemaine = selectedTypeSemaine === 'paire' ? 'semaine_paire' : 'semaine_impaire';
                
                return (
                  <div key={site.site_id} className="space-y-3">
                    <h3 className="font-semibold text-lg">{site.site_nom}</h3>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Jour</TableHead>
                          <TableHead className="text-center">Matin</TableHead>
                          <TableHead className="text-center">Après-midi</TableHead>
                          <TableHead className="text-center">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {JOURS.map(jour => {
                          const keyMatin = `${jour.key}_matin` as keyof typeof site.semaine_paire;
                          const keyAM = `${jour.key}_apres_midi` as keyof typeof site.semaine_paire;
                          const matin = site[typeSemaine][keyMatin];
                          const apresMidi = site[typeSemaine][keyAM];
                          const total = matin + apresMidi;

                          return (
                            <TableRow key={jour.key}>
                              <TableCell className="font-medium">{jour.label}</TableCell>
                              <TableCell className="text-center">
                                <Badge variant={matin > 0 ? "default" : "secondary"}>
                                  {Math.round(matin * 10) / 10}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-center">
                                <Badge variant={apresMidi > 0 ? "default" : "secondary"}>
                                  {Math.round(apresMidi * 10) / 10}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-center">
                                <Badge variant={total > 0 ? "default" : "outline"}>
                                  {Math.round(total * 10) / 10}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                );
              })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
