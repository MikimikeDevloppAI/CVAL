import { useState, useEffect, memo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Building2, User, ChevronDown, Loader2, Plus, Edit2, X, CheckCircle } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useToast } from '@/hooks/use-toast';
import { CompactBlocOperatoirePlanningView } from './CompactBlocOperatoirePlanningView';
import { UnsatisfiedNeedsReport } from './UnsatisfiedNeedsReport';
import { ManagePersonnelDialog } from './ManagePersonnelDialog';
import { EditResponsibilitesDialog } from './EditResponsibilitesDialog';
import { DeleteAssignmentDialog } from './DeleteAssignmentDialog';
import { AssignToUnsatisfiedNeedDialog } from './AssignToUnsatisfiedNeedDialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

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
    validated?: boolean;
  }[];
  type_assignation?: 'site' | 'administratif';
}

export function SitePlanningView({ startDate, endDate }: SitePlanningViewProps) {
  const [loading, setLoading] = useState(true);
  const [siteBesoins, setSiteBesoins] = useState<SiteBesoinsData[]>([]);
  const [expandedSites, setExpandedSites] = useState<Set<string>>(new Set());
  const [manageDialogOpen, setManageDialogOpen] = useState(false);
  const [editRespDialogOpen, setEditRespDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [dialogContext, setDialogContext] = useState<any>(null);
  const [respAssignment, setRespAssignment] = useState<any>(null);
  const [assignmentToDelete, setAssignmentToDelete] = useState<{ id: string; nom: string } | null>(null);
  const [assignmentNeed, setAssignmentNeed] = useState<any>(null);
  const { toast } = useToast();

  useEffect(() => {
    let mounted = true;
    
    const fetchData = async () => {
      if (mounted) {
        await fetchSitePlanning();
      }
    };
    
    fetchData();

    // Real-time subscription for personnel assignments
    const personnelChannel = supabase
      .channel('site-personnel-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'planning_genere_personnel'
        },
        () => {
          if (mounted) {
            fetchSitePlanning();
          }
        }
      )
      .subscribe();
    
    return () => {
      mounted = false;
      supabase.removeChannel(personnelChannel);
    };
  }, [startDate, endDate]);

  const fetchSitePlanning = async () => {
    try {
      setLoading(true);

      // ÉTAPE A: Récupérer les besoins de sites avec les détails des médecins et sites (exclure le bloc opératoire)
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
        toast({ title: "Erreur", description: "Impossible de charger les besoins", variant: "destructive" });
        return;
      }

      // Filtrer pour exclure le site "Bloc opératoire" (affiché séparément au-dessus)
      const besoins = (allBesoins || []).filter(b => 
        !b.sites?.nom?.toLowerCase().includes('bloc opératoire') &&
        !b.sites?.nom?.toLowerCase().includes('bloc operatoire')
      );

      // ÉTAPE B: Construire baseGroups à partir des besoins
      const baseGroups = new Map<string, SiteBesoinsData>();

      for (const besoin of besoins || []) {
        // Déterminer les périodes (split toute_journee en matin + après-midi)
        const periodes: Array<'matin' | 'apres_midi'> = 
          besoin.demi_journee === 'toute_journee' 
            ? ['matin', 'apres_midi'] 
            : [besoin.demi_journee as 'matin' | 'apres_midi'];

        for (const periode of periodes) {
          const key = `${besoin.site_id}_${besoin.date}_${periode}`;

          // Créer l'entrée si elle n'existe pas encore
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
              medecins_noms: [],
              personnel: []
            });
          }

          const group = baseGroups.get(key)!;

          // Incrémenter le besoin en secrétaires (on somme d'abord, on arrondit après)
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

      // ÉTAPE C: Récupérer les assignations de sites et les fusionner
      const { data: planningSites, error: planningError } = await supabase
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

      if (planningError) {
        console.error('Error fetching site planning:', planningError);
        toast({ title: "Erreur", description: "Impossible de charger le planning des sites", variant: "destructive" });
        return;
      }

      // Fusionner les assignations dans baseGroups
      for (const assignment of planningSites || []) {
        const key = `${assignment.site_id}_${assignment.date}_${assignment.periode}`;

        // Si le groupe n'existe pas (cas rare: assignation sans besoin), le créer
        if (!baseGroups.has(key)) {
          baseGroups.set(key, {
            id: key,
            date: assignment.date,
            periode: assignment.periode,
            site_id: assignment.site_id || '',
            site_nom: assignment.sites?.nom || 'Site inconnu',
            site_fermeture: assignment.sites?.fermeture || false,
            nombre_secretaires_requis: 0,
            medecins_ids: [],
            medecins_noms: [],
            personnel: []
          });
        }

        // Ajouter le personnel
        if (assignment.secretaire_id && assignment.secretaires) {
          baseGroups.get(key)!.personnel.push({
            id: assignment.id,
            secretaire_id: assignment.secretaire_id,
            secretaire_nom: `${assignment.secretaires.first_name} ${assignment.secretaires.name}`,
            ordre: assignment.ordre,
            type_assignation: 'site',
            is_1r: assignment.is_1r || false,
            is_2f: assignment.is_2f || false,
            is_3f: assignment.is_3f || false,
            validated: assignment.validated || false
          });
        }
      }

      // ÉTAPE D: Récupérer les assignations administratives (inchangé)
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

      // Grouper les assignations administratives par (date, periode)
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
        
        // Ajouter le personnel
        if (assignment.secretaire_id && assignment.secretaires) {
          groupedAdmin.get(key)!.personnel.push({
            id: assignment.id,
            secretaire_id: assignment.secretaire_id,
            secretaire_nom: `${assignment.secretaires.first_name} ${assignment.secretaires.name}`,
            ordre: assignment.ordre,
            type_assignation: 'administratif',
            is_1r: assignment.is_1r || false,
            is_2f: assignment.is_2f || false,
            is_3f: assignment.is_3f || false,
            validated: assignment.validated || false
          });
        }
      }

      // ÉTAPE E: Concaténer tous les groupes
      setSiteBesoins([...Array.from(baseGroups.values()), ...Array.from(groupedAdmin.values())]);

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
    setAssignmentNeed({
      date,
      periode,
      site_id: siteId,
      site_nom: siteName,
      type: 'site' as const,
    });
    setAssignDialogOpen(true);
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

  const handleDeleteClick = (assignmentId: string, secretaryName: string) => {
    setAssignmentToDelete({
      id: assignmentId,
      nom: secretaryName,
    });
    setDeleteDialogOpen(true);
  };

  const handleValidationToggle = async (assignmentId: string, validated: boolean) => {
    try {
      const { error } = await supabase
        .from('planning_genere_personnel')
        .update({ validated })
        .eq('id', assignmentId);

      if (error) throw error;
      
      toast({
        title: validated ? "Assignation validée" : "Validation retirée",
        description: "Le changement a été enregistré",
      });
    } catch (error) {
      console.error('Error updating validation:', error);
      toast({
        title: "Erreur",
        description: "Impossible de modifier la validation",
        variant: "destructive",
      });
    }
  };

  const handleValidateDay = async (date: string, siteId: string) => {
    const assignmentsToValidate = siteBesoins
      .filter(b => b.date === date && b.site_id === siteId)
      .flatMap(b => b.personnel.map(p => p.id));

    if (assignmentsToValidate.length === 0) return;

    try {
      const { error } = await supabase
        .from('planning_genere_personnel')
        .update({ validated: true })
        .in('id', assignmentsToValidate);

      if (error) throw error;
      
      toast({
        title: "Journée validée",
        description: `${assignmentsToValidate.length} assignation(s) validée(s)`,
      });
    } catch (error) {
      console.error('Error validating day:', error);
      toast({
        title: "Erreur",
        description: "Impossible de valider la journée",
        variant: "destructive",
      });
    }
  };

  const handleValidateSite = async (siteId: string) => {
    const assignmentsToValidate = siteBesoins
      .filter(b => b.site_id === siteId)
      .flatMap(b => b.personnel.map(p => p.id));

    if (assignmentsToValidate.length === 0) return;

    try {
      const { error } = await supabase
        .from('planning_genere_personnel')
        .update({ validated: true })
        .in('id', assignmentsToValidate);

      if (error) throw error;
      
      toast({
        title: "Site validé",
        description: `${assignmentsToValidate.length} assignation(s) validée(s) pour toute la semaine`,
      });
    } catch (error) {
      console.error('Error validating site:', error);
      toast({
        title: "Erreur",
        description: "Impossible de valider le site",
        variant: "destructive",
      });
    }
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
                  <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleValidateSite(siteId)}
                      className="h-8"
                    >
                      <CheckCircle className="h-4 w-4 mr-2 text-green-600" />
                      Valider site
                    </Button>
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
                        <div className="bg-muted/30 px-3 py-2 border-b">
                          <div className="flex items-center justify-between">
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
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleValidateDay(date, siteId);
                              }}
                              className="h-7 w-7 p-0"
                              title="Valider toute la journée"
                            >
                              <CheckCircle className="h-4 w-4 text-green-600" />
                            </Button>
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
                                <div key={idx} className="border rounded-lg p-2 bg-card group">
                                  <div className="flex items-center justify-between gap-1">
                                    <div className="flex items-center gap-1 flex-1 min-w-0">
                                      <Checkbox
                                        checked={p.validated || false}
                                        onCheckedChange={(checked) => handleValidationToggle(p.id, checked as boolean)}
                                        onClick={(e) => e.stopPropagation()}
                                        className="mr-1"
                                      />
                                      <User className="h-3 w-3 text-primary flex-shrink-0" />
                                      <span className="font-medium text-xs">{p.secretaire_nom}</span>
                                      {p.validated && (
                                        <CheckCircle className="h-3 w-3 text-green-600 flex-shrink-0" />
                                      )}
                                    </div>
                                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
                                            assignment_id: p.id,
                                          });
                                          setManageDialogOpen(true);
                                        }}
                                        className="p-1 hover:bg-accent rounded transition-colors"
                                        title="Modifier"
                                      >
                                        <Edit2 className="h-3 w-3 text-primary" />
                                      </button>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleDeleteClick(p.id, p.secretaire_nom);
                                        }}
                                        className="p-1 hover:bg-accent rounded transition-colors"
                                        title="Supprimer"
                                      >
                                        <X className="h-3 w-3 text-destructive" />
                                      </button>
                                    </div>
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
                                <div key={idx} className="border rounded-lg p-2 bg-card group">
                                  <div className="flex items-center justify-between gap-1">
                                    <div className="flex items-center gap-1 flex-1 min-w-0">
                                      <Checkbox
                                        checked={p.validated || false}
                                        onCheckedChange={(checked) => handleValidationToggle(p.id, checked as boolean)}
                                        onClick={(e) => e.stopPropagation()}
                                        className="mr-1"
                                      />
                                      <User className="h-3 w-3 text-primary flex-shrink-0" />
                                      <span className="font-medium text-xs">{p.secretaire_nom}</span>
                                      {p.validated && (
                                        <CheckCircle className="h-3 w-3 text-green-600 flex-shrink-0" />
                                      )}
                                    </div>
                                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
                                            assignment_id: p.id,
                                          });
                                          setManageDialogOpen(true);
                                        }}
                                        className="p-1 hover:bg-accent rounded transition-colors"
                                        title="Modifier"
                                      >
                                        <Edit2 className="h-3 w-3 text-primary" />
                                      </button>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleDeleteClick(p.id, p.secretaire_nom);
                                        }}
                                        className="p-1 hover:bg-accent rounded transition-colors"
                                        title="Supprimer"
                                      >
                                        <X className="h-3 w-3 text-destructive" />
                                      </button>
                                    </div>
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

      {assignmentToDelete && (
        <DeleteAssignmentDialog
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          assignmentId={assignmentToDelete.id}
          secretaryName={assignmentToDelete.nom}
          onSuccess={() => {
            fetchSitePlanning();
            setAssignmentToDelete(null);
          }}
        />
      )}

      {assignmentNeed && (
        <AssignToUnsatisfiedNeedDialog
          open={assignDialogOpen}
          onOpenChange={setAssignDialogOpen}
          need={assignmentNeed}
          onSuccess={fetchSitePlanning}
        />
      )}
    </div>
  );
}
