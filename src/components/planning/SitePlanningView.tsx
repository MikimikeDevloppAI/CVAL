import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Building2, User, ChevronDown, Loader2, Plus, Edit2 } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useToast } from '@/hooks/use-toast';
import { CompactBlocOperatoirePlanningView } from './CompactBlocOperatoirePlanningView';
import { UnsatisfiedNeedsReport } from './UnsatisfiedNeedsReport';
import { ManagePersonnelDialog } from './ManagePersonnelDialog';
import { EditResponsibilitesDialog } from './EditResponsibilitesDialog';
import { Button } from '@/components/ui/button';

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
    id: string; // ID de l'assignment dans planning_genere_personnel
    secretaire_id: string | null;
    secretaire_nom: string;
    ordre: number;
    type_assignation?: 'site' | 'administratif';
    is_1r?: boolean;
    is_2f?: boolean;
    is_3f?: boolean;
  }[];
  type_assignation?: 'site' | 'administratif';
}

export function SitePlanningView({ startDate, endDate }: SitePlanningViewProps) {
  const [loading, setLoading] = useState(true);
  const [siteBesoins, setSiteBesoins] = useState<SiteBesoinsData[]>([]);
  const [expandedSites, setExpandedSites] = useState<Set<string>>(new Set());
  const [manageDialogOpen, setManageDialogOpen] = useState(false);
  const [editRespDialogOpen, setEditRespDialogOpen] = useState(false);
  const [dialogContext, setDialogContext] = useState<any>(null);
  const [respAssignment, setRespAssignment] = useState<any>(null);
  const { toast } = useToast();

  useEffect(() => {
    fetchSitePlanning();
  }, [startDate, endDate]);

  const fetchSitePlanning = async () => {
    try {
      setLoading(true);

      // Fetch site assignments
      const { data: planningSites, error } = await supabase
        .from('planning_genere_personnel')
        .select(`
          *,
          secretaires!secretaire_id(first_name, name),
          sites(nom, fermeture)
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

      // Fetch besoins to get the required counts
      const { data: besoins } = await supabase
        .from('besoin_effectif')
        .select('*, medecins(first_name, name, besoin_secretaires)')
        .eq('type', 'medecin')
        .gte('date', format(startDate, 'yyyy-MM-dd'))
        .lte('date', format(endDate, 'yyyy-MM-dd'));

      // Group site assignments by (site_id, date, periode)
      const groupedSites = new Map<string, SiteBesoinsData>();
      
      for (const assignment of planningSites || []) {
        const key = `${assignment.site_id}_${assignment.date}_${assignment.periode}`;
        
        if (!groupedSites.has(key)) {
          // Calculate required secretaries from besoins
          const periodBesoins = (besoins || []).filter((b: any) => 
            b.site_id === assignment.site_id && 
            b.date === assignment.date && 
            (b.demi_journee === assignment.periode || b.demi_journee === 'toute_journee')
          );
          
          const totalNeed = periodBesoins.reduce((sum: number, b: any) => 
            sum + (b.medecins?.besoin_secretaires || 1.2), 0
          );
          
          const medecins = periodBesoins.map((b: any) => ({
            id: b.medecin_id,
            nom: b.medecins ? `${b.medecins.first_name} ${b.medecins.name}` : ''
          })).filter(m => m.nom);

          groupedSites.set(key, {
            id: key,
            date: assignment.date,
            periode: assignment.periode,
            site_id: assignment.site_id || '',
            site_nom: assignment.sites?.nom || 'Site inconnu',
            site_fermeture: assignment.sites?.fermeture || false,
            nombre_secretaires_requis: Math.ceil(totalNeed),
            medecins_ids: medecins.map(m => m.id),
            medecins_noms: medecins.map(m => m.nom),
            personnel: []
          });
        }
        
        // Add personnel to the group
        if (assignment.secretaire_id && assignment.secretaires) {
          groupedSites.get(key)!.personnel.push({
            id: assignment.id, // ID de l'assignment
            secretaire_id: assignment.secretaire_id,
            secretaire_nom: `${assignment.secretaires.first_name} ${assignment.secretaires.name}`,
            ordre: assignment.ordre,
            type_assignation: 'site',
            is_1r: assignment.is_1r || false,
            is_2f: assignment.is_2f || false,
            is_3f: assignment.is_3f || false
          });
        }
      }

      // Fetch administrative assignments
      const { data: adminAssignments } = await supabase
        .from('planning_genere_personnel')
        .select(`
          *,
          secretaires!secretaire_id(first_name, name)
        `)
        .eq('type_assignation', 'administratif')
        .gte('date', format(startDate, 'yyyy-MM-dd'))
        .lte('date', format(endDate, 'yyyy-MM-dd'))
        .order('date', { ascending: true })
        .order('periode', { ascending: true })
        .order('ordre', { ascending: true });

      // Group admin assignments by (date, periode)
      const groupedAdmin = new Map<string, SiteBesoinsData>();
      
      for (const assignment of adminAssignments || []) {
        const key = `admin_${assignment.date}_${assignment.periode}`;
        
        if (!groupedAdmin.has(key)) {
          groupedAdmin.set(key, {
            id: key,
            date: assignment.date,
            periode: assignment.periode,
            site_id: '',
            site_nom: 'Administratif',
            site_fermeture: false,
            nombre_secretaires_requis: 0,
            medecins_ids: [],
            medecins_noms: [],
            personnel: [],
            type_assignation: 'administratif'
          });
        }
        
        // Add personnel to the group
        if (assignment.secretaire_id && assignment.secretaires) {
          groupedAdmin.get(key)!.personnel.push({
            id: assignment.id, // ID de l'assignment
            secretaire_id: assignment.secretaire_id,
            secretaire_nom: `${assignment.secretaires.first_name} ${assignment.secretaires.name}`,
            ordre: assignment.ordre,
            type_assignation: 'administratif',
            is_1r: assignment.is_1r || false,
            is_2f: assignment.is_2f || false,
            is_3f: assignment.is_3f || false
          });
        }
      }

      setSiteBesoins([...Array.from(groupedSites.values()), ...Array.from(groupedAdmin.values())]);

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

  // Grouper par site et trier alphabétiquement
  const sites = [...new Set(siteBesoins.map(b => b.site_id))];
  const bySite = sites.map(siteId => {
    const siteData = siteBesoins.filter(b => b.site_id === siteId);
    const siteName = siteData[0]?.site_nom || 'Site inconnu';
    
    // Group by date (data is already aggregated per site/date/periode)
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
  }).sort((a, b) => a.siteName.localeCompare(b.siteName, 'fr'));

  const handleDayClick = (date: string, periode: 'matin' | 'apres_midi', siteId: string, siteName: string) => {
    setDialogContext({
      date,
      periode,
      site_id: siteId,
      site_nom: siteName,
    });
    setManageDialogOpen(true);
  };

  const handleRespClick = (personnel: any, date: string, periode: 'matin' | 'apres_midi', siteName: string) => {
    const current = personnel.is_1r ? '1R' : personnel.is_2f ? '2F' : personnel.is_3f ? '3F' : 'none';
    setRespAssignment({
      id: personnel.id, // ID de l'assignment
      secretaire_nom: personnel.secretaire_nom,
      date,
      periode,
      site_nom: siteName,
      current,
    });
    setEditRespDialogOpen(true);
  };

  return (
    <div className="space-y-4">
      {/* Unsatisfied Needs Report */}
      <UnsatisfiedNeedsReport startDate={startDate} endDate={endDate} />
      
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
                          {/* Bouton Matin */}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-full justify-start text-xs font-medium text-muted-foreground hover:bg-muted/50"
                            onClick={() => handleDayClick(date, 'matin', siteId, siteName)}
                          >
                            <Plus className="h-3 w-3 mr-1" />
                            Matin
                          </Button>
                          
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
                                  <div className="flex items-center justify-between gap-1">
                                    <div className="flex items-center gap-1 flex-1 min-w-0">
                                      <User className="h-3 w-3 text-primary flex-shrink-0" />
                                      <span className="font-medium text-xs line-clamp-2">{p.secretaire_nom}</span>
                                    </div>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setDialogContext({
                                          date,
                                          periode: 'matin',
                                          site_id: siteId,
                                          site_nom: siteName,
                                          secretaire_id: p.secretaire_id || undefined,
                                          secretaire_nom: p.secretaire_nom,
                                        });
                                        setManageDialogOpen(true);
                                      }}
                                      className="p-1 hover:bg-accent rounded transition-colors"
                                      title="Gérer ce créneau"
                                    >
                                      <Edit2 className="h-3 w-3 text-muted-foreground" />
                                    </button>
                                  </div>
                                  <button
                                    onClick={() => handleRespClick(p, date, 'matin', siteName)}
                                    className="flex gap-1 mt-1 hover:opacity-80 transition-opacity"
                                  >
                                    {p.is_1r && (
                                      <Badge variant="outline" className="text-[10px] px-1 py-0 bg-blue-50 text-blue-700 border-blue-300 cursor-pointer">
                                        1R
                                      </Badge>
                                    )}
                                    {p.is_2f && (
                                      <Badge variant="outline" className="text-[10px] px-1 py-0 bg-green-50 text-green-700 border-green-300 cursor-pointer">
                                        2F
                                      </Badge>
                                    )}
                                    {p.is_3f && (
                                      <Badge variant="outline" className="text-[10px] px-1 py-0 bg-purple-50 text-purple-700 border-purple-300 cursor-pointer">
                                        3F
                                      </Badge>
                                    )}
                                    {!p.is_1r && !p.is_2f && !p.is_3f && (
                                      <Badge variant="outline" className="text-[10px] px-1 py-0 text-muted-foreground cursor-pointer">
                                        1
                                      </Badge>
                                    )}
                                  </button>
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
                          
                          {/* Bouton Après-midi */}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-full justify-start text-xs font-medium text-muted-foreground hover:bg-muted/50"
                            onClick={() => handleDayClick(date, 'apres_midi', siteId, siteName)}
                          >
                            <Plus className="h-3 w-3 mr-1" />
                            Après-midi
                          </Button>
                          
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
                                  <div className="flex items-center justify-between gap-1">
                                    <div className="flex items-center gap-1 flex-1 min-w-0">
                                      <User className="h-3 w-3 text-primary flex-shrink-0" />
                                      <span className="font-medium text-xs line-clamp-2">{p.secretaire_nom}</span>
                                    </div>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setDialogContext({
                                          date,
                                          periode: 'apres_midi',
                                          site_id: siteId,
                                          site_nom: siteName,
                                          secretaire_id: p.secretaire_id || undefined,
                                          secretaire_nom: p.secretaire_nom,
                                        });
                                        setManageDialogOpen(true);
                                      }}
                                      className="p-1 hover:bg-accent rounded transition-colors"
                                      title="Gérer ce créneau"
                                    >
                                      <Edit2 className="h-3 w-3 text-muted-foreground" />
                                    </button>
                                  </div>
                                  <button
                                    onClick={() => handleRespClick(p, date, 'apres_midi', siteName)}
                                    className="flex gap-1 mt-1 hover:opacity-80 transition-opacity"
                                  >
                                    {p.is_1r && (
                                      <Badge variant="outline" className="text-[10px] px-1 py-0 bg-blue-50 text-blue-700 border-blue-300 cursor-pointer">
                                        1R
                                      </Badge>
                                    )}
                                    {p.is_2f && (
                                      <Badge variant="outline" className="text-[10px] px-1 py-0 bg-green-50 text-green-700 border-green-300 cursor-pointer">
                                        2F
                                      </Badge>
                                    )}
                                    {p.is_3f && (
                                      <Badge variant="outline" className="text-[10px] px-1 py-0 bg-purple-50 text-purple-700 border-purple-300 cursor-pointer">
                                        3F
                                      </Badge>
                                    )}
                                    {!p.is_1r && !p.is_2f && !p.is_3f && (
                                      <Badge variant="outline" className="text-[10px] px-1 py-0 text-muted-foreground cursor-pointer">
                                        1
                                      </Badge>
                                    )}
                                  </button>
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

      {/* Dialogs */}
      {dialogContext && (
        <ManagePersonnelDialog
          open={manageDialogOpen}
          onOpenChange={setManageDialogOpen}
          context={dialogContext}
          onSuccess={fetchSitePlanning}
        />
      )}

      {respAssignment && (
        <EditResponsibilitesDialog
          open={editRespDialogOpen}
          onOpenChange={setEditRespDialogOpen}
          assignment={respAssignment}
          onSuccess={fetchSitePlanning}
        />
      )}
    </div>
  );
}
