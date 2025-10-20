import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Building2, ChevronDown, Loader2 } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { CompactBlocOperatoirePlanningView } from './CompactBlocOperatoirePlanningView';

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
  site_fermeture?: boolean;
  nombre_secretaires_requis: number;
  medecins_ids: string[];
  medecins_noms: string[];
}

export function SitePlanningView({ startDate, endDate }: SitePlanningViewProps) {
  const [loading, setLoading] = useState(true);
  const [siteBesoins, setSiteBesoins] = useState<SiteBesoinsData[]>([]);
  const [expandedSites, setExpandedSites] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchSitePlanning();
  }, [startDate, endDate]);

  const fetchSitePlanning = async () => {
    try {
      setLoading(true);

      // Récupérer les besoins de sites avec les détails des médecins et sites (exclure le bloc opératoire)
      const { data: allBesoins, error: besoinsError } = await supabase
        .from('besoin_effectif')
        .select(`
          *,
          medecins(id, first_name, name, besoin_secretaires),
          sites(id, nom, fermeture)
        `)
        .eq('type', 'medecin')
        .gte('date', format(startDate, 'yyyy-MM-dd'))
        .lte('date', format(endDate, 'yyyy-MM-dd'));

      if (besoinsError) {
        console.error('Error fetching besoins:', besoinsError);
        return;
      }

      // Filtrer pour exclure le site "Bloc opératoire"
      const besoins = (allBesoins || []).filter(b => 
        !b.sites?.nom?.toLowerCase().includes('bloc opératoire') &&
        !b.sites?.nom?.toLowerCase().includes('bloc operatoire')
      );

      // Construire les groupes par (site, date, periode)
      const baseGroups = new Map<string, SiteBesoinsData>();

      for (const besoin of besoins || []) {
        // Déterminer les périodes (split toute_journee en matin + après-midi)
        const periodes: Array<'matin' | 'apres_midi'> = 
          besoin.demi_journee === 'toute_journee' 
            ? ['matin', 'apres_midi'] 
            : [besoin.demi_journee as 'matin' | 'apres_midi'];

        for (const periode of periodes) {
          const key = `${besoin.site_id}_${besoin.date}_${periode}`;

          if (!baseGroups.has(key)) {
            baseGroups.set(key, {
              id: key,
              date: besoin.date,
              periode,
              site_id: besoin.site_id || '',
              site_nom: besoin.sites?.nom || 'Site inconnu',
              site_fermeture: besoin.sites?.fermeture || false,
              nombre_secretaires_requis: 0,
              medecins_ids: [],
              medecins_noms: []
            });
          }

          const group = baseGroups.get(key)!;

          // Incrémenter le besoin en secrétaires
          const besoinSecretaires = besoin.medecins?.besoin_secretaires || 1.2;
          group.nombre_secretaires_requis += besoinSecretaires;

          // Ajouter le médecin s'il n'est pas déjà listé
          if (besoin.medecin_id && !group.medecins_ids.includes(besoin.medecin_id)) {
            group.medecins_ids.push(besoin.medecin_id);
            const nomComplet = besoin.medecins 
              ? `${besoin.medecins.first_name} ${besoin.medecins.name}` 
              : 'Médecin inconnu';
            group.medecins_noms.push(nomComplet);
          }
        }
      }

      // Appliquer Math.ceil sur chaque groupe
      for (const group of baseGroups.values()) {
        group.nombre_secretaires_requis = Math.ceil(group.nombre_secretaires_requis);
      }

      setSiteBesoins(Array.from(baseGroups.values()));

    } catch (error) {
      console.error('Error in fetchSitePlanning:', error);
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

  // Grouper par site et trier alphabétiquement
  const sites = [...new Set(siteBesoins.map(b => b.site_id))];
  const bySite = sites.map(siteId => {
    const siteData = siteBesoins.filter(b => b.site_id === siteId);
    const siteName = siteData[0]?.site_nom || 'Site inconnu';
    
    // Group by date
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

    const totalRequis = siteData.reduce((sum, b) => sum + b.nombre_secretaires_requis, 0);

    return {
      siteId,
      siteName,
      byDate,
      totalRequis,
    };
  }).sort((a, b) => a.siteName.localeCompare(b.siteName, 'fr'));

  return (
    <div className="space-y-4">
      {/* Bloc Opératoire Planning - Compact Version */}
      <CompactBlocOperatoirePlanningView startDate={startDate} endDate={endDate} />
      
      {/* Sites Planning - Besoins uniquement */}
      {bySite.map(({ siteId, siteName, byDate, totalRequis }) => (
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
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">Besoins semaine</div>
                      <div className="font-semibold text-sm">
                        {totalRequis} secrétaires requis
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
                        <div className="bg-muted/30 px-3 py-2 border-b">
                          <div className="text-center">
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
                        </div>
                        
                        {/* Besoins du jour */}
                        <div className="space-y-3 p-3 flex-1">
                          {/* Matin */}
                          {matin && matin.nombre_secretaires_requis > 0 && (
                            <div className="space-y-2">
                              <div className="text-xs font-medium text-muted-foreground">Matin</div>
                              {matin.medecins_noms.length > 0 && (
                                <div className="space-y-1">
                                  {matin.medecins_noms.map((nom, idx) => (
                                    <div key={idx} className="text-xs text-muted-foreground">
                                      Dr {nom}
                                    </div>
                                  ))}
                                </div>
                              )}
                              <Badge 
                                variant="outline"
                                className="text-xs w-full justify-center"
                              >
                                {matin.nombre_secretaires_requis} requis
                              </Badge>
                            </div>
                          )}
                          
                          {/* Après-midi */}
                          {apresMidi && apresMidi.nombre_secretaires_requis > 0 && (
                            <div className="space-y-2">
                              <div className="text-xs font-medium text-muted-foreground">Après-midi</div>
                              {apresMidi.medecins_noms.length > 0 && (
                                <div className="space-y-1">
                                  {apresMidi.medecins_noms.map((nom, idx) => (
                                    <div key={idx} className="text-xs text-muted-foreground">
                                      Dr {nom}
                                    </div>
                                  ))}
                                </div>
                              )}
                              <Badge 
                                variant="outline"
                                className="text-xs w-full justify-center"
                              >
                                {apresMidi.nombre_secretaires_requis} requis
                              </Badge>
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
