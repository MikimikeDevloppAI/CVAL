import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Building2, User, ChevronDown, Loader2 } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useToast } from '@/hooks/use-toast';
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
  personnel: {
    secretaire_id: string | null;
    secretaire_nom: string;
    ordre: number;
    type_assignation?: 'site' | 'administratif';
  }[];
  type_assignation?: 'site' | 'administratif';
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

      // Fetch from unified planning_genere_personnel table
      const { data: planningSites, error } = await supabase
        .from('planning_genere_personnel')
        .select(`
          *,
          secretaires(first_name, name),
          sites(nom, fermeture),
          besoin_effectif!inner(medecins(first_name, name))
        `)
        .eq('type_assignation', 'site')
        .gte('date', format(startDate, 'yyyy-MM-dd'))
        .lte('date', format(endDate, 'yyyy-MM-dd'))
        .order('date', { ascending: true })
        .order('periode', { ascending: true })
        .order('ordre', { ascending: true });

      if (error) {
        console.error('Error fetching site planning:', error);
        toast({ title: "Erreur", description: "Impossible de charger le planning des sites", variant: "destructive" });
        return;
      }

      // Process data
      const enrichedData: SiteBesoinsData[] = (planningSites || []).map((assignment: any) => ({
        id: assignment.id,
        date: assignment.date,
        periode: assignment.periode,
        site_id: assignment.site_id || '',
        site_nom: assignment.sites?.nom || 'Site inconnu',
        site_fermeture: assignment.sites?.fermeture || false,
        nombre_secretaires_requis: 1,
        medecins_ids: assignment.besoin_effectif?.medecins?.id ? [assignment.besoin_effectif.medecins.id] : [],
        medecins_noms: assignment.besoin_effectif?.medecins ? [`${assignment.besoin_effectif.medecins.first_name} ${assignment.besoin_effectif.medecins.name}`] : [],
        personnel: assignment.secretaire_id && assignment.secretaires ? [{
          secretaire_id: assignment.secretaire_id,
          secretaire_nom: `${assignment.secretaires.first_name} ${assignment.secretaires.name}`,
          ordre: assignment.ordre,
          type_assignation: 'site'
        }] : []
      }));

      // Fetch administrative assignments
      const { data: adminAssignments } = await supabase
        .from('planning_genere_personnel')
        .select(`
          *,
          secretaires(first_name, name)
        `)
        .eq('type_assignation', 'administratif')
        .gte('date', format(startDate, 'yyyy-MM-dd'))
        .lte('date', format(endDate, 'yyyy-MM-dd'));

      // Add admin assignments
      const adminData: SiteBesoinsData[] = (adminAssignments || []).map((assignment: any) => ({
        id: assignment.id,
        date: assignment.date,
        periode: assignment.periode,
        site_id: '',
        site_nom: 'Administratif',
        site_fermeture: false,
        nombre_secretaires_requis: 0,
        medecins_ids: [],
        medecins_noms: [],
        personnel: assignment.secretaire_id && assignment.secretaires ? [{
          secretaire_id: assignment.secretaire_id,
          secretaire_nom: `${assignment.secretaires.first_name} ${assignment.secretaires.name}`,
          ordre: assignment.ordre,
          type_assignation: 'administratif'
        }] : [],
        type_assignation: 'administratif'
      }));

      setSiteBesoins([...enrichedData, ...adminData]);

    } catch (error) {
      console.error('Error in fetchSitePlanning:', error);
      toast({ title: "Erreur", description: "Une erreur est survenue", variant: "destructive" });
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
      {/* Bloc Opératoire Planning - Compact Version */}
      <CompactBlocOperatoirePlanningView startDate={startDate} endDate={endDate} />
      
      {/* Sites Planning */}
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
                          {matin && (matin.personnel.length > 0 || matin.medecins_noms.length > 0) && (
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
                              {matin.personnel.map((p, idx) => (
                                <div key={idx} className="border rounded-lg p-2 bg-card">
                                  <div className="flex items-center gap-1">
                                    <User className="h-3 w-3 text-primary flex-shrink-0" />
                                    <span className="font-medium text-xs line-clamp-2">{p.secretaire_nom}</span>
                                  </div>
                                </div>
                              ))}
                              {matin.personnel.length > 0 && (
                                <Badge 
                                  variant={matin.personnel.length >= matin.nombre_secretaires_requis ? "default" : "destructive"}
                                  className="text-xs w-full justify-center"
                                >
                                  {matin.personnel.length} / {matin.nombre_secretaires_requis}
                                </Badge>
                              )}
                            </div>
                          )}
                          
                          {/* Après-midi */}
                          {apresMidi && (apresMidi.personnel.length > 0 || apresMidi.medecins_noms.length > 0) && (
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
                              {apresMidi.personnel.map((p, idx) => (
                                <div key={idx} className="border rounded-lg p-2 bg-card">
                                  <div className="flex items-center gap-1">
                                    <User className="h-3 w-3 text-primary flex-shrink-0" />
                                    <span className="font-medium text-xs line-clamp-2">{p.secretaire_nom}</span>
                                  </div>
                                </div>
                              ))}
                              {apresMidi.personnel.length > 0 && (
                                <Badge 
                                  variant={apresMidi.personnel.length >= apresMidi.nombre_secretaires_requis ? "default" : "destructive"}
                                  className="text-xs w-full justify-center"
                                >
                                  {apresMidi.personnel.length} / {apresMidi.nombre_secretaires_requis}
                                </Badge>
                              )}
                            </div>
                          )}
                          
                          {(!matin || (matin.personnel.length === 0 && matin.medecins_noms.length === 0)) && 
                           (!apresMidi || (apresMidi.personnel.length === 0 && apresMidi.medecins_noms.length === 0)) && (
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
