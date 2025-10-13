import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Building2, User, ChevronDown, Loader2 } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useToast } from '@/hooks/use-toast';

interface SitePlanningViewProps {
  startDate: Date;
  endDate: Date;
}

interface SiteBesoinsData {
  id: string;
  date: string;
  periode: 'matin' | 'apres_midi';
  site_id: string;
  site_nom: string;
  nombre_secretaires_requis: number;
  medecins_ids: string[];
  personnel: {
    secretaire_id: string | null;
    secretaire_nom: string;
    ordre: number;
    type_assignation?: 'site' | 'administratif';
  }[];
}

export function SitePlanningView({ startDate, endDate }: SitePlanningViewProps) {
  const [loading, setLoading] = useState(true);
  const [siteBesoins, setSiteBesoins] = useState<SiteBesoinsData[]>([]);
  const [expandedSites, setExpandedSites] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  useEffect(() => {
    fetchSitePlanning();
  }, [startDate, endDate]);

  const fetchSitePlanning = async () => {
    try {
      setLoading(true);
      
      // Récupérer les besoins par site
      const { data: besoinsData, error: besoinsError } = await supabase
        .from('planning_genere_site_besoin')
        .select(`
          id,
          date,
          periode,
          site_id,
          nombre_secretaires_requis,
          medecins_ids,
          sites!inner(nom)
        `)
        .gte('date', format(startDate, 'yyyy-MM-dd'))
        .lte('date', format(endDate, 'yyyy-MM-dd'))
        .order('date')
        .order('periode');

      if (besoinsError) throw besoinsError;

      console.log('besoinsData:', besoinsData);

      // Pour chaque besoin, récupérer le personnel assigné
      const enrichedData: SiteBesoinsData[] = [];
      
      for (const besoin of besoinsData || []) {
        const { data: personnelData, error: personnelError } = await supabase
          .from('planning_genere_site_personnel')
          .select(`
            secretaire_id,
            ordre,
            secretaires!inner(first_name, name)
          `)
          .eq('planning_genere_site_besoin_id', besoin.id)
          .order('ordre');

        if (personnelError) {
          console.error('Error fetching personnel:', personnelError);
          continue;
        }

        enrichedData.push({
          id: besoin.id,
          date: besoin.date,
          periode: besoin.periode,
          site_id: besoin.site_id,
          site_nom: (besoin.sites as any)?.nom || 'Site inconnu',
          nombre_secretaires_requis: besoin.nombre_secretaires_requis,
          medecins_ids: besoin.medecins_ids,
          personnel: (personnelData || []).map(p => ({
            secretaire_id: p.secretaire_id,
            secretaire_nom: p.secretaires 
              ? `${(p.secretaires as any).first_name} ${(p.secretaires as any).name}`
              : 'Non assigné',
            ordre: p.ordre,
            type_assignation: 'site' as const,
          })),
        });
      }

      console.log('enrichedData after sites:', enrichedData);

      // Récupérer aussi les assignations administratives
      const { data: adminData, error: adminError } = await supabase
        .from('planning_genere')
        .select(`
          id,
          date,
          periode,
          secretaire_id,
          secretaires(first_name, name)
        `)
        .eq('type', 'administratif')
        .gte('date', format(startDate, 'yyyy-MM-dd'))
        .lte('date', format(endDate, 'yyyy-MM-dd'))
        .not('secretaire_id', 'is', null)
        .order('date')
        .order('periode');

      console.log('adminData:', adminData, 'adminError:', adminError);

      if (!adminError && adminData && adminData.length > 0) {
        // Grouper les assignations administratives par date/période
        const adminByDatePeriod = new Map<string, any[]>();
        
        for (const admin of adminData) {
          const key = `${admin.date}-${admin.periode}`;
          if (!adminByDatePeriod.has(key)) {
            adminByDatePeriod.set(key, []);
          }
          adminByDatePeriod.get(key)!.push({
            secretaire_id: admin.secretaire_id,
            secretaire_nom: admin.secretaires 
              ? `${(admin.secretaires as any).first_name} ${(admin.secretaires as any).name}`
              : 'Non assigné',
            ordre: 999,
            type_assignation: 'administratif' as const,
          });
        }

        console.log('adminByDatePeriod:', adminByDatePeriod);

        // Ajouter une entrée "Administratif" pour chaque groupe
        adminByDatePeriod.forEach((personnel, key) => {
          const [date, periode] = key.split('-');
          enrichedData.push({
            id: `admin-${key}`,
            date,
            periode: periode as 'matin' | 'apres_midi',
            site_id: 'administratif',
            site_nom: 'Administratif',
            nombre_secretaires_requis: personnel.length,
            medecins_ids: [],
            personnel,
          });
        });
      }

      console.log('enrichedData final:', enrichedData);
      setSiteBesoins(enrichedData);
    } catch (error) {
      console.error('Error fetching site planning:', error);
      toast({
        title: "Erreur",
        description: "Impossible de charger le planning par site",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleSite = (siteId: string) => {
    setExpandedSites(prev => {
      const newSet = new Set(prev);
      if (newSet.has(siteId)) {
        newSet.delete(siteId);
      } else {
        newSet.add(siteId);
      }
      return newSet;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (siteBesoins.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Aucun planning généré pour cette période
        </CardContent>
      </Card>
    );
  }

  // Grouper par site
  const sites = [...new Set(siteBesoins.map(b => b.site_id))];
  const bySite = sites.map(siteId => {
    const siteData = siteBesoins.filter(b => b.site_id === siteId);
    const siteName = siteData[0]?.site_nom || 'Site inconnu';
    
    // Grouper par date
    const dates = [...new Set(siteData.map(b => b.date))].sort();
    const byDate = dates.map(date => {
      const dateData = siteData.filter(b => b.date === date);
      const matin = dateData.find(b => b.periode === 'matin');
      const apresMidi = dateData.find(b => b.periode === 'apres_midi');
      
      return {
        date,
        matin,
        apresMidi,
      };
    });

    const totalSecretaires = siteData.reduce((sum, b) => sum + b.personnel.length, 0);
    const totalRequis = siteData.reduce((sum, b) => sum + b.nombre_secretaires_requis, 0);

    return {
      siteId,
      siteName,
      byDate,
      totalSecretaires,
      totalRequis,
    };
  });

  return (
    <div className="space-y-4">
      {bySite.map(({ siteId, siteName, byDate, totalSecretaires, totalRequis }) => (
        <Card key={siteId}>
          <Collapsible open={expandedSites.has(siteId)} onOpenChange={() => toggleSite(siteId)}>
            <CollapsibleTrigger className="w-full">
              <CardHeader className="bg-primary/5 hover:bg-primary/10 transition-colors cursor-pointer">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <ChevronDown 
                      className={`h-5 w-5 text-primary transition-transform ${
                        expandedSites.has(siteId) ? 'rotate-180' : ''
                      }`}
                    />
                    <Building2 className="h-5 w-5 text-primary" />
                    <CardTitle className="text-lg">{siteName}</CardTitle>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">Secrétaires semaine</div>
                      <div className="font-semibold text-sm">
                        {totalSecretaires} / {totalRequis}
                      </div>
                    </div>
                  </div>
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            
            <CollapsibleContent>
              <CardContent className="pt-6">
                <div className="grid grid-cols-5 gap-4">
                  {byDate.map(({ date, matin, apresMidi }) => {
                    const dateObj = new Date(date + 'T00:00:00');
                    
                    return (
                      <div key={date} className="border rounded-lg overflow-hidden flex flex-col">
                        {/* En-tête du jour */}
                        <div className="bg-muted/30 px-3 py-2 text-center border-b">
                          <div className="font-medium text-xs">
                            {format(dateObj, 'EEE', { locale: fr })}
                          </div>
                          <div className="text-lg font-semibold">
                            {format(dateObj, 'd', { locale: fr })}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {format(dateObj, 'MMM', { locale: fr })}
                          </div>
                        </div>
                        
                        {/* Personnel du jour */}
                        <div className="space-y-3 p-3 flex-1">
                          {/* Matin */}
                          {matin && matin.personnel.length > 0 && (
                            <div className="space-y-2">
                              <div className="text-xs font-medium text-muted-foreground">Matin</div>
                              {matin.personnel.map((p, idx) => (
                                <div key={idx} className="border rounded-lg p-2 bg-card">
                                  <div className="flex items-center gap-1 justify-between">
                                    <div className="flex items-center gap-1 flex-1 min-w-0">
                                      <User className="h-3 w-3 text-primary flex-shrink-0" />
                                      <span className="font-medium text-xs line-clamp-2">{p.secretaire_nom}</span>
                                    </div>
                                    {p.type_assignation === 'administratif' && (
                                      <Badge variant="outline" className="text-xs px-1.5 py-0 bg-purple-50 text-purple-700 border-purple-300 flex-shrink-0">
                                        Admin
                                      </Badge>
                                    )}
                                  </div>
                                  {p.type_assignation === 'site' && (
                                    <div className="text-xs text-muted-foreground mt-1">
                                      Ordre: {p.ordre}
                                    </div>
                                  )}
                                </div>
                              ))}
                              <Badge 
                                variant={matin.personnel.length >= matin.nombre_secretaires_requis ? "default" : "destructive"}
                                className="text-xs w-full justify-center"
                              >
                                {matin.personnel.length} / {matin.nombre_secretaires_requis}
                              </Badge>
                            </div>
                          )}
                          
                          {/* Après-midi */}
                          {apresMidi && apresMidi.personnel.length > 0 && (
                            <div className="space-y-2">
                              <div className="text-xs font-medium text-muted-foreground">Après-midi</div>
                              {apresMidi.personnel.map((p, idx) => (
                                <div key={idx} className="border rounded-lg p-2 bg-card">
                                  <div className="flex items-center gap-1 justify-between">
                                    <div className="flex items-center gap-1 flex-1 min-w-0">
                                      <User className="h-3 w-3 text-primary flex-shrink-0" />
                                      <span className="font-medium text-xs line-clamp-2">{p.secretaire_nom}</span>
                                    </div>
                                    {p.type_assignation === 'administratif' && (
                                      <Badge variant="outline" className="text-xs px-1.5 py-0 bg-purple-50 text-purple-700 border-purple-300 flex-shrink-0">
                                        Admin
                                      </Badge>
                                    )}
                                  </div>
                                  {p.type_assignation === 'site' && (
                                    <div className="text-xs text-muted-foreground mt-1">
                                      Ordre: {p.ordre}
                                    </div>
                                  )}
                                </div>
                              ))}
                              <Badge 
                                variant={apresMidi.personnel.length >= apresMidi.nombre_secretaires_requis ? "default" : "destructive"}
                                className="text-xs w-full justify-center"
                              >
                                {apresMidi.personnel.length} / {apresMidi.nombre_secretaires_requis}
                              </Badge>
                            </div>
                          )}
                          
                          {(!matin || matin.personnel.length === 0) && (!apresMidi || apresMidi.personnel.length === 0) && (
                            <div className="text-xs text-muted-foreground text-center py-4">
                              Aucune assignation
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </CollapsibleContent>
          </Collapsible>
        </Card>
      ))}
    </div>
  );
}
