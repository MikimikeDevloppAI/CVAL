import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { ChevronLeft, ChevronRight, Plus, X, Download } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { format, eachDayOfInterval } from 'date-fns';
import { fr } from 'date-fns/locale';
import * as XLSX from 'xlsx';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

interface GlobalMedecinCalendarViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface Medecin {
  id: string;
  first_name: string;
  name: string;
  specialites?: {
    nom: string;
  };
}

interface Site {
  id: string;
  nom: string;
}

interface BesoinEffectif {
  id: string;
  date: string;
  medecin_id: string;
  site_id: string;
  demi_journee: 'toute_journee' | 'matin' | 'apres_midi';
  type_intervention_id?: string;
  sites?: {
    nom: string;
  };
  types_intervention?: {
    nom: string;
  };
}

interface TypeIntervention {
  id: string;
  nom: string;
}

export function GlobalMedecinCalendarView({ open, onOpenChange }: GlobalMedecinCalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [sites, setSites] = useState<Site[]>([]);
  const [medecins, setMedecins] = useState<Medecin[]>([]);
  const [besoins, setBesoins] = useState<BesoinEffectif[]>([]);
  const [typesIntervention, setTypesIntervention] = useState<TypeIntervention[]>([]);
  const [loading, setLoading] = useState(false);
  const [addDialog, setAddDialog] = useState<{
    open: boolean;
    medecinId: string;
    date: string;
  } | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<'matin' | 'apres_midi' | 'toute_journee'>('toute_journee');
  const [selectedSiteId, setSelectedSiteId] = useState<string>('');
  const [selectedTypeInterventionId, setSelectedTypeInterventionId] = useState<string>('');
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportStartDate, setExportStartDate] = useState<Date | undefined>(undefined);
  const [exportEndDate, setExportEndDate] = useState<Date | undefined>(undefined);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ 
    open: boolean; 
    besoinId: string;
    medecinName: string;
    date: string;
    period: string;
  } | null>(null);
  const [joursFeries, setJoursFeries] = useState<string[]>([]);
  const [editDialog, setEditDialog] = useState<{
    open: boolean;
    besoinIds: string[];
    medecinId: string;
    date: string;
  } | null>(null);
  const { toast } = useToast();

  const formatDate = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  useEffect(() => {
    if (open) {
      fetchData();
    }
  }, [open, currentDate]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch sites actifs
      const { data: sitesData } = await supabase
        .from('sites')
        .select('id, nom')
        .eq('actif', true)
        .order('nom');

      if (sitesData) setSites(sitesData);

      // Fetch medecins actifs
      const { data: medecinsData } = await supabase
        .from('medecins')
        .select('id, first_name, name, specialites(nom)')
        .eq('actif', true)
        .order('first_name');

      if (medecinsData) setMedecins(medecinsData);

      // Fetch types d'intervention
      const { data: typesData } = await supabase
        .from('types_intervention')
        .select('id, nom')
        .eq('actif', true)
        .order('nom');

      if (typesData) setTypesIntervention(typesData);

      // Fetch besoins for current month
      const startDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      const endDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

      const { data: besoinsData } = await supabase
        .from('besoin_effectif')
        .select('*, sites(nom), types_intervention(nom)')
        .eq('type', 'medecin')
        .gte('date', formatDate(startDate))
        .lte('date', formatDate(endDate))
        .order('date');

      if (besoinsData) setBesoins(besoinsData);

      // Fetch jours fériés
      const { data: feriesData } = await supabase
        .from('jours_feries')
        .select('date')
        .eq('actif', true)
        .gte('date', formatDate(startDate))
        .lte('date', formatDate(endDate));

      if (feriesData) {
        setJoursFeries(feriesData.map(f => f.date));
      }
    } catch (error) {
      console.error('Erreur:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible de charger les données',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handlePrevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1));
  };

  const getDaysInMonth = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();

    const days = [];
    for (let i = 1; i <= daysInMonth; i++) {
      const date = new Date(year, month, i);
      const dayOfWeek = date.getDay();
      const dayOfWeekAbbr = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'][dayOfWeek];
      days.push({ day: i, dayOfWeek: dayOfWeekAbbr });
    }
    return days;
  };

  // Grouper les médecins par site basé sur leurs besoins du mois
  const getMedecinsBySite = () => {
    const medecinsBySite: Record<string, Set<string>> = {};

    besoins.forEach(besoin => {
      const siteId = besoin.site_id;
      const medecinId = besoin.medecin_id;
      
      if (!medecinsBySite[siteId]) {
        medecinsBySite[siteId] = new Set();
      }
      medecinsBySite[siteId].add(medecinId);
    });

    return medecinsBySite;
  };

  const getBesoinsForMedecinAndDate = (medecinId: string, day: number, siteId: string) => {
    const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
    const dateStr = formatDate(date);
    const filteredBesoins = besoins.filter(b => 
      b.medecin_id === medecinId && 
      b.date === dateStr && 
      b.site_id === siteId
    );
    
    // Trier pour que le matin soit toujours au-dessus de l'après-midi
    return filteredBesoins.sort((a, b) => {
      const ordre = { 'matin': 1, 'apres_midi': 2, 'toute_journee': 3 };
      return (ordre[a.demi_journee] || 4) - (ordre[b.demi_journee] || 4);
    });
  };

  const getColorForPeriod = (demiJournee: string) => {
    switch (demiJournee) {
      case 'toute_journee':
        return 'bg-green-100 border-green-300 text-green-800';
      case 'matin':
        return 'bg-blue-100 border-blue-300 text-blue-800';
      case 'apres_midi':
        return 'bg-yellow-100 border-yellow-300 text-yellow-800';
      default:
        return 'bg-gray-100 border-gray-300 text-gray-800';
    }
  };

  const getPeriodLabel = (demiJournee: string, typeIntervention?: string) => {
    let label = '';
    switch (demiJournee) {
      case 'toute_journee':
        label = 'Toute la journée';
        break;
      case 'matin':
        label = 'Matin';
        break;
      case 'apres_midi':
        label = 'Après-midi';
        break;
      default:
        label = '';
    }
    
    if (typeIntervention) {
      return `${label} (${typeIntervention})`;
    }
    return label;
  };

  const handleDeleteBesoin = async () => {
    if (!deleteConfirmation) return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from('besoin_effectif')
        .delete()
        .eq('id', deleteConfirmation.besoinId);

      if (error) throw error;

      toast({
        title: 'Succès',
        description: 'Besoin supprimé',
      });

      setDeleteConfirmation(null);
      fetchData();
    } catch (error) {
      console.error('Erreur:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible de supprimer le besoin',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAddBesoin = async () => {
    if (!addDialog || !selectedSiteId) {
      toast({
        title: 'Erreur',
        description: 'Veuillez sélectionner un site',
        variant: 'destructive',
      });
      return;
    }

    // Check if bloc operatoire and no type intervention selected
    const isBlocOperatoire = sites.find(s => s.id === selectedSiteId)?.nom.includes('Bloc opératoire');
    if (isBlocOperatoire && !selectedTypeInterventionId) {
      toast({
        title: 'Erreur',
        description: 'Veuillez sélectionner un type d\'intervention pour le bloc opératoire',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('besoin_effectif')
        .insert({
          date: addDialog.date,
          medecin_id: addDialog.medecinId,
          site_id: selectedSiteId,
          demi_journee: selectedPeriod,
          type: 'medecin',
          type_intervention_id: selectedTypeInterventionId || null,
          actif: true,
        });

      if (error) throw error;

      toast({
        title: 'Succès',
        description: 'Besoin ajouté',
      });

      setAddDialog(null);
      setSelectedPeriod('toute_journee');
      setSelectedSiteId('');
      setSelectedTypeInterventionId('');
      fetchData();
    } catch (error) {
      console.error('Erreur:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible d\'ajouter le besoin',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const monthName = currentDate.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const days = getDaysInMonth();

  const isWeekend = (dayInfo: { day: number; dayOfWeek: string }) => {
    return dayInfo.dayOfWeek === 'Sam' || dayInfo.dayOfWeek === 'Dim';
  };

  const isHoliday = (day: number) => {
    const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
    const dateStr = formatDate(date);
    return joursFeries.includes(dateStr);
  };

  const medecinsBySiteMap = getMedecinsBySite();

  const handleExportExcel = async () => {
    if (!exportStartDate || !exportEndDate) {
      toast({
        title: 'Erreur',
        description: 'Veuillez sélectionner les dates de début et fin',
        variant: 'destructive',
      });
      return;
    }

    if (exportStartDate > exportEndDate) {
      toast({
        title: 'Erreur',
        description: 'La date de début doit être antérieure à la date de fin',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      // Fetch all data for the date range
      const { data: besoinsData } = await supabase
        .from('besoin_effectif')
        .select('*, medecins(first_name, name), sites(nom), types_intervention(nom)')
        .eq('type', 'medecin')
        .gte('date', formatDate(exportStartDate))
        .lte('date', formatDate(exportEndDate))
        .order('date');

      if (!besoinsData) {
        throw new Error('Impossible de récupérer les données');
      }

      // Generate all days in the range
      const allDays = eachDayOfInterval({ start: exportStartDate, end: exportEndDate });

      // Create workbook
      const wb = XLSX.utils.book_new();

      // Group besoins by site
      const besoinsBySite: Record<string, typeof besoinsData> = {};
      besoinsData.forEach(besoin => {
        const siteName = besoin.sites?.nom || 'Sans site';
        if (!besoinsBySite[siteName]) {
          besoinsBySite[siteName] = [];
        }
        besoinsBySite[siteName].push(besoin);
      });

      // Create a sheet for each site
      Object.entries(besoinsBySite).forEach(([siteName, siteBesoins]) => {
        // Get unique medecins for this site
        const medecinsInSite = new Map<string, { first_name: string; name: string }>();
        siteBesoins.forEach(besoin => {
          if (besoin.medecins && !medecinsInSite.has(besoin.medecin_id)) {
            medecinsInSite.set(besoin.medecin_id, besoin.medecins);
          }
        });

        // Create header row
        const headerRow = ['Médecin', 'Spécialité', ...allDays.map(d => format(d, 'dd/MM/yyyy (EEE)', { locale: fr }))];

        // Create data rows
        const dataRows = Array.from(medecinsInSite.entries()).map(([medecinId, medecin]) => {
          const medecinData = medecins.find(m => m.id === medecinId);
          const row = [
            `${medecin.first_name} ${medecin.name}`,
            medecinData?.specialites?.nom || ''
          ];

          allDays.forEach(day => {
            const dateStr = formatDate(day);
            const dayBesoins = siteBesoins.filter(b => b.medecin_id === medecinId && b.date === dateStr);

            if (dayBesoins.length === 0) {
              row.push('');
            } else {
              const periods = dayBesoins.map(b => {
                let periodStr = '';
                switch (b.demi_journee) {
                  case 'toute_journee': periodStr = 'Toute la journée'; break;
                  case 'matin': periodStr = 'Matin'; break;
                  case 'apres_midi': periodStr = 'Après-midi'; break;
                }
                if (b.types_intervention?.nom) {
                  periodStr += ` (${b.types_intervention.nom})`;
                }
                return periodStr;
              }).join(', ');
              row.push(periods);
            }
          });

          return row;
        });

        // Create worksheet
        const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);

        // Set column widths
        const colWidths = [{ wch: 25 }, { wch: 15 }, ...allDays.map(() => ({ wch: 15 }))];
        ws['!cols'] = colWidths;

        // Add sheet to workbook (limit sheet name to 31 chars)
        const sheetName = siteName.length > 31 ? siteName.substring(0, 28) + '...' : siteName;
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      });

      // Generate filename
      const filename = `planning_medecins_${format(exportStartDate, 'yyyy-MM-dd')}_${format(exportEndDate, 'yyyy-MM-dd')}.xlsx`;

      // Download
      XLSX.writeFile(wb, filename);

      toast({
        title: 'Succès',
        description: 'Le fichier Excel a été téléchargé',
      });

      setExportDialogOpen(false);
    } catch (error) {
      console.error('Erreur:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible d\'exporter le calendrier',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex flex-col gap-4 pb-4">
              <div className="flex items-center gap-3">
                <span className="bg-gradient-to-r from-primary to-primary/80 bg-clip-text text-transparent font-bold">
                  Calendrier mensuel
                </span>
                <Separator orientation="vertical" className="h-6" />
                <span className="text-muted-foreground font-normal">Médecins</span>
              </div>
              <div className="flex items-center justify-between gap-4 w-full">
                <div className="w-[140px]" />
                
                <div className="flex items-center gap-3">
                  <Button variant="outline" size="sm" onClick={handlePrevMonth} disabled={loading} className="hover:bg-primary/10">
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-base font-semibold capitalize min-w-[200px] text-center bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
                    {monthName}
                  </span>
                  <Button variant="outline" size="sm" onClick={handleNextMonth} disabled={loading} className="hover:bg-primary/10">
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
                
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => setExportDialogOpen(true)}
                  className="gap-2"
                >
                  <Download className="h-4 w-4" />
                  Exporter Excel
                </Button>
              </div>
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-auto">
            <div className="min-w-max space-y-6">
              {sites.map(site => {
                const medecinIds = medecinsBySiteMap[site.id] || new Set();
                if (medecinIds.size === 0) return null;

                const siteMedecins = medecins.filter(m => medecinIds.has(m.id));

                return (
                  <div key={site.id} className="space-y-2">
                    {/* Site Header */}
                    <div className="sticky top-0 bg-background z-20 pb-2 border-b-2 border-primary/20">
                      <h3 className="text-base font-bold text-primary">{site.nom}</h3>
                    </div>

                    {/* Days Header - STICKY */}
                    <div className="grid gap-1 mb-2 sticky top-10 bg-background z-10 pb-2 border-b" style={{ gridTemplateColumns: `180px repeat(${days.length}, 60px)` }}>
                      <div className="font-bold text-sm py-2 px-2 sticky left-0 bg-background z-10 border-r">
                        Médecin
                      </div>
                      {days.map((dayInfo, index) => (
                        <div
                          key={index}
                          className={`text-center font-bold text-xs py-2 rounded ${
                            isHoliday(dayInfo.day)
                              ? 'bg-red-100'
                              : isWeekend(dayInfo)
                              ? 'bg-accent/30'
                              : 'bg-primary/10'
                          }`}
                        >
                          <div className="text-sm">{dayInfo.day}</div>
                          <div className="text-[10px] text-muted-foreground">{dayInfo.dayOfWeek}</div>
                        </div>
                      ))}
                    </div>

                    {/* Medecins rows */}
                    {siteMedecins.map((medecin, medIndex) => (
                      <div
                        key={medecin.id}
                        className={`grid gap-1 mb-0.5 hover:bg-accent/20 py-0.5 ${medIndex % 2 === 0 ? 'bg-muted' : 'bg-card'}`}
                        style={{ gridTemplateColumns: `180px repeat(${days.length}, 60px)` }}
                      >
                        <div className={`font-medium text-xs py-1 px-2 sticky left-0 z-10 border-r ${medIndex % 2 === 0 ? 'bg-muted' : 'bg-card'}`}>
                          <div className="flex flex-col leading-tight">
                            <span className="text-[10px] text-muted-foreground">{medecin.first_name}</span>
                            <span className="truncate">{medecin.name}</span>
                          </div>
                        </div>
                        {days.map((dayInfo, index) => {
                          const day = dayInfo.day;
                          const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
                          const dateStr = formatDate(date);
                          const besoinsDay = getBesoinsForMedecinAndDate(medecin.id, day, site.id);
                          const isWeekendDay = isWeekend(dayInfo);
                          const isHolidayDay = isHoliday(day);

                          // Regrouper matin et après-midi si les deux sont présents ET même site
                          const hasMatin = besoinsDay.some(b => b.demi_journee === 'matin');
                          const hasApresMidi = besoinsDay.some(b => b.demi_journee === 'apres_midi');
                          const besoinsToDisplay = [];

                          if (hasMatin && hasApresMidi) {
                            const matinBesoin = besoinsDay.find(b => b.demi_journee === 'matin');
                            const apresMidiBesoin = besoinsDay.find(b => b.demi_journee === 'apres_midi');
                            
                            // Fusionner uniquement si même site
                            if (matinBesoin?.site_id === apresMidiBesoin?.site_id) {
                              besoinsToDisplay.push({
                                id: 'merged',
                                demi_journee: 'toute_journee',
                                sites: matinBesoin?.sites,
                                types_intervention: matinBesoin?.types_intervention,
                                site_id: matinBesoin?.site_id,
                                besoinIds: [matinBesoin.id, apresMidiBesoin.id]
                              });
                            } else {
                              // Sites différents, afficher séparément
                              if (matinBesoin) {
                                besoinsToDisplay.push({
                                  ...matinBesoin,
                                  besoinIds: [matinBesoin.id]
                                });
                              }
                              if (apresMidiBesoin) {
                                besoinsToDisplay.push({
                                  ...apresMidiBesoin,
                                  besoinIds: [apresMidiBesoin.id]
                                });
                              }
                            }
                          } else {
                            // Afficher les périodes séparément
                            besoinsDay.forEach(besoin => {
                              besoinsToDisplay.push({
                                ...besoin,
                                besoinIds: [besoin.id]
                              });
                            });
                          }

                          return (
                            <div
                              key={index}
                              className={`h-7 border rounded relative group overflow-hidden ${
                                isHolidayDay
                                  ? 'bg-red-50'
                                  : isWeekendDay
                                  ? 'bg-accent/5'
                                  : 'bg-card'
                              }`}
                            >
                              {besoinsToDisplay.length > 0 ? (
                                <div className="flex flex-col h-full relative">
                                  {besoinsToDisplay.map((besoin) => (
                                    <div
                                      key={besoin.id}
                                      className={`text-[8px] flex-1 w-full leading-none text-center flex items-center justify-center cursor-pointer ${getColorForPeriod(
                                        besoin.demi_journee
                                      )}`}
                                      title={`${besoin.sites?.nom}${besoin.types_intervention?.nom ? ' - ' + besoin.types_intervention.nom : ''}`}
                                      onClick={() => {
                                        const firstBesoin = besoins.find(b => b.id === besoin.besoinIds[0]);
                                        setSelectedSiteId(firstBesoin?.site_id || site.id);
                                        setSelectedPeriod(besoin.demi_journee as 'matin' | 'apres_midi' | 'toute_journee');
                                        setSelectedTypeInterventionId(firstBesoin?.type_intervention_id || '');
                                        setEditDialog({
                                          open: true,
                                          besoinIds: besoin.besoinIds,
                                          medecinId: medecin.id,
                                          date: dateStr,
                                        });
                                      }}
                                    >
                                      <div className="truncate font-semibold px-1">
                                        {getPeriodLabel(besoin.demi_journee, besoin.types_intervention?.nom)}
                                      </div>
                                    </div>
                                  ))}
                                  <button
                                    className="absolute top-0.5 right-0.5 h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-sm flex items-center justify-center z-10 cursor-pointer disabled:opacity-50"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const firstBesoin = besoinsToDisplay[0];
                                      const periodLabel = firstBesoin.demi_journee === 'toute_journee' 
                                        ? 'Toute la journée' 
                                        : firstBesoin.demi_journee === 'matin' 
                                        ? 'Matin' 
                                        : 'Après-midi';
                                      setDeleteConfirmation({ 
                                        open: true, 
                                        besoinId: firstBesoin.besoinIds[0],
                                        medecinName: `${medecin.first_name} ${medecin.name}`,
                                        date: format(new Date(dateStr), 'dd/MM/yyyy', { locale: fr }),
                                        period: periodLabel
                                      });
                                    }}
                                    disabled={loading}
                                  >
                                    <X className="h-2.5 w-2.5" />
                                  </button>
                                </div>
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-full w-full opacity-0 group-hover:opacity-100 transition-opacity p-0"
                                  onClick={() => {
                                    setSelectedSiteId(site.id);
                                    setAddDialog({ open: true, medecinId: medecin.id, date: dateStr });
                                  }}
                                  disabled={loading}
                                >
                                  <Plus className="h-3 w-3" />
                                </Button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Besoin Dialog */}
      {addDialog && (
        <Dialog open={addDialog.open} onOpenChange={(open) => !open && setAddDialog(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Ajouter un besoin</DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Période</label>
                <Select value={selectedPeriod} onValueChange={(v: any) => setSelectedPeriod(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="matin">Matin</SelectItem>
                    <SelectItem value="apres_midi">Après-midi</SelectItem>
                    <SelectItem value="toute_journee">Toute la journée</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Site</label>
                <Select value={selectedSiteId} onValueChange={setSelectedSiteId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner un site" />
                  </SelectTrigger>
                  <SelectContent>
                    {sites.map(site => (
                      <SelectItem key={site.id} value={site.id}>{site.nom}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedSiteId && sites.find(s => s.id === selectedSiteId)?.nom.includes('Bloc opératoire') && (
                <div>
                  <label className="text-sm font-medium mb-2 block">Type d'intervention</label>
                  <Select value={selectedTypeInterventionId} onValueChange={setSelectedTypeInterventionId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Sélectionner un type" />
                    </SelectTrigger>
                    <SelectContent>
                      {typesIntervention.map(type => (
                        <SelectItem key={type.id} value={type.id}>{type.nom}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setAddDialog(null)}>
                  Annuler
                </Button>
                <Button onClick={handleAddBesoin} disabled={loading}>
                  Ajouter
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteConfirmation?.open || false} onOpenChange={(open) => !open && setDeleteConfirmation(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer la suppression</AlertDialogTitle>
            <AlertDialogDescription>
              Êtes-vous sûr de vouloir supprimer ce besoin pour {deleteConfirmation?.medecinName} le {deleteConfirmation?.date} ({deleteConfirmation?.period}) ?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteBesoin} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Export Dialog */}
      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Exporter le calendrier</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Date de début</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !exportStartDate && "text-muted-foreground")}>
                    {exportStartDate ? format(exportStartDate, 'dd/MM/yyyy', { locale: fr }) : "Sélectionner une date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={exportStartDate} onSelect={setExportStartDate} initialFocus className="pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Date de fin</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !exportEndDate && "text-muted-foreground")}>
                    {exportEndDate ? format(exportEndDate, 'dd/MM/yyyy', { locale: fr }) : "Sélectionner une date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={exportEndDate} onSelect={setExportEndDate} initialFocus className="pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setExportDialogOpen(false)}>
                Annuler
              </Button>
              <Button onClick={handleExportExcel} disabled={loading}>
                <Download className="h-4 w-4 mr-2" />
                Exporter
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
