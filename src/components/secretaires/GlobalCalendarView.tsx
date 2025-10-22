import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { ChevronLeft, ChevronRight, Plus, X, Download, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { format, eachDayOfInterval } from 'date-fns';
import { fr } from 'date-fns/locale';
import * as XLSX from 'xlsx';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface GlobalCalendarViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface Secretaire {
  id: string;
  first_name: string;
  name: string;
}

interface Site {
  id: string;
  nom: string;
}

interface CapaciteEffective {
  id: string;
  date: string;
  secretaire_id: string;
  site_id: string;
  demi_journee: 'toute_journee' | 'matin' | 'apres_midi';
  sites?: {
    nom: string;
  };
}

export function GlobalCalendarView({ open, onOpenChange }: GlobalCalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [secretaires, setSecretaires] = useState<Secretaire[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [capacites, setCapacites] = useState<CapaciteEffective[]>([]);
  const [loading, setLoading] = useState(false);
  const [addDialog, setAddDialog] = useState<{
    open: boolean;
    secretaireId: string;
    date: string;
  } | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<'matin' | 'apres_midi' | 'toute_journee'>('toute_journee');
  const [selectedSiteId, setSelectedSiteId] = useState<string>('');
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportStartDate, setExportStartDate] = useState<Date | undefined>(undefined);
  const [exportEndDate, setExportEndDate] = useState<Date | undefined>(undefined);
  const [deleteDialog, setDeleteDialog] = useState<{
    open: boolean;
    type: 'single' | 'merged';
    capaciteIds: string[];
    period: 'matin' | 'apres_midi' | 'toute_journee';
    siteName: string;
  } | null>(null);
  const [joursFeries, setJoursFeries] = useState<string[]>([]);
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
      // Fetch secretaires actives
      const { data: secData } = await supabase
        .from('secretaires')
        .select('id, first_name, name')
        .eq('actif', true)
        .order('first_name');

      if (secData) setSecretaires(secData);

      // Fetch sites
      const { data: sitesData } = await supabase
        .from('sites')
        .select('id, nom')
        .eq('actif', true)
        .order('nom');

      if (sitesData) {
        setSites(sitesData);
        // Set default site to "administratif" if available
        const adminSite = sitesData.find(s => s.nom.toLowerCase().includes('administratif'));
        if (adminSite && !selectedSiteId) {
          setSelectedSiteId(adminSite.id);
        }
      }

      // Fetch capacites for current month
      const startDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      const endDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

      const { data: capData } = await supabase
        .from('capacite_effective')
        .select('*, sites(nom)')
        .gte('date', formatDate(startDate))
        .lte('date', formatDate(endDate))
        .order('date');

      if (capData) setCapacites(capData);

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

  const getCapacitesForSecretaireAndDate = (secretaireId: string, day: number) => {
    const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
    const dateStr = formatDate(date);
    return capacites.filter(c => c.secretaire_id === secretaireId && c.date === dateStr);
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

  const getPeriodLabel = (demiJournee: string) => {
    switch (demiJournee) {
      case 'toute_journee':
        return 'Journée';
      case 'matin':
        return 'Matin';
      case 'apres_midi':
        return 'AM';
      default:
        return '';
    }
  };

  const handleOpenDeleteDialog = (cap: any) => {
    setDeleteDialog({
      open: true,
      type: cap.capaciteIds.length > 1 ? 'merged' : 'single',
      capaciteIds: cap.capaciteIds,
      period: cap.demi_journee,
      siteName: cap.sites?.nom || 'Site non défini'
    });
  };

  const handleDeleteCapacites = async (idsToDelete: string[]) => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('capacite_effective')
        .delete()
        .in('id', idsToDelete);

      if (error) throw error;

      toast({
        title: 'Succès',
        description: `${idsToDelete.length} capacité(s) supprimée(s)`,
      });

      setDeleteDialog(null);
      fetchData();
    } catch (error) {
      console.error('Erreur:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible de supprimer les capacités',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAddCapacite = async () => {
    if (!addDialog || !selectedSiteId) {
      toast({
        title: 'Erreur',
        description: 'Veuillez sélectionner un site',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('capacite_effective')
        .insert({
          date: addDialog.date,
          secretaire_id: addDialog.secretaireId,
          site_id: selectedSiteId,
          demi_journee: selectedPeriod,
          actif: true,
        });

      if (error) throw error;

      toast({
        title: 'Succès',
        description: 'Capacité ajoutée',
      });

      setAddDialog(null);
      setSelectedPeriod('toute_journee');
      // Reset to admin site
      const adminSite = sites.find(s => s.nom.toLowerCase().includes('administratif'));
      if (adminSite) {
        setSelectedSiteId(adminSite.id);
      }
      fetchData();
    } catch (error) {
      console.error('Erreur:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible d\'ajouter la capacité',
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
      // Fetch all secretaries
      const { data: secData } = await supabase
        .from('secretaires')
        .select('id, first_name, name')
        .eq('actif', true)
        .order('first_name');

      // Fetch capacites with site information for the selected date range
      const { data: capData } = await supabase
        .from('capacite_effective')
        .select('*, sites(nom)')
        .gte('date', formatDate(exportStartDate))
        .lte('date', formatDate(exportEndDate))
        .order('date');

      if (!secData || !capData) {
        throw new Error('Impossible de récupérer les données');
      }

      // Generate all days in the range
      const allDays = eachDayOfInterval({ start: exportStartDate, end: exportEndDate });

      // Create header row with dates
      const headerRow = ['Secrétaire', 'Période', ...allDays.map(d => format(d, 'dd/MM/yyyy (EEE)', { locale: fr }))];

      // Create data rows - 2 rows per secretary (matin, après-midi)
      const dataRows: any[] = [];
      
      secData.forEach(sec => {
        const fullName = `${sec.first_name} ${sec.name}`;
        
        // Row for "Matin"
        const matinRow = [fullName, 'Matin'];
        allDays.forEach(day => {
          const dateStr = formatDate(day);
          const matinCaps = capData.filter(c => 
            c.secretaire_id === sec.id && 
            c.date === dateStr && 
            (c.demi_journee === 'matin' || c.demi_journee === 'toute_journee')
          );
          
          if (matinCaps.length === 0) {
            matinRow.push('');
          } else {
            const sites = matinCaps.map(c => c.sites?.nom || 'Site non défini').join(', ');
            matinRow.push(sites);
          }
        });
        dataRows.push(matinRow);
        
        // Row for "Après-midi"
        const apresRow = [fullName, 'Après-midi'];
        allDays.forEach(day => {
          const dateStr = formatDate(day);
          const apresCaps = capData.filter(c => 
            c.secretaire_id === sec.id && 
            c.date === dateStr && 
            (c.demi_journee === 'apres_midi' || c.demi_journee === 'toute_journee')
          );
          
          if (apresCaps.length === 0) {
            apresRow.push('');
          } else {
            const sites = apresCaps.map(c => c.sites?.nom || 'Site non défini').join(', ');
            apresRow.push(sites);
          }
        });
        dataRows.push(apresRow);
      });

      // Create worksheet
      const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);

      // Set column widths
      const colWidths = [{ wch: 25 }, { wch: 12 }, ...allDays.map(() => ({ wch: 18 }))];
      ws['!cols'] = colWidths;

      // Create workbook
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Planning');

      // Generate filename
      const filename = `planning_secretaires_${format(exportStartDate, 'yyyy-MM-dd')}_${format(exportEndDate, 'yyyy-MM-dd')}.xlsx`;

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
                <span className="text-muted-foreground font-normal">Assistant Médical</span>
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
            <div className="min-w-max">
              {/* Header with days - STICKY */}
              <div className="grid gap-1 mb-2 sticky top-0 bg-background z-20 pb-2 border-b" style={{ gridTemplateColumns: `180px repeat(${days.length}, 60px)` }}>
                <div className="font-bold text-sm py-2 px-2 sticky left-0 bg-background z-10 border-r">
                  Secrétaire
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

              {/* Secretaires rows */}
              {secretaires.map((secretaire, secIndex) => (
                <div
                  key={secretaire.id}
                  className={`grid gap-1 mb-0.5 hover:bg-accent/20 py-0.5 ${secIndex % 2 === 0 ? 'bg-muted/40' : 'bg-muted/10'}`}
                  style={{ gridTemplateColumns: `180px repeat(${days.length}, 60px)` }}
                >
                  <div className={`font-medium text-xs py-1 px-2 sticky left-0 z-10 border-r ${secIndex % 2 === 0 ? 'bg-muted' : 'bg-background'}`}>
                    <div className="flex flex-col leading-tight">
                      <span className="text-[10px] text-muted-foreground">{secretaire.first_name}</span>
                      <span className="truncate">{secretaire.name}</span>
                    </div>
                  </div>
                  {days.map((dayInfo, index) => {
                    const day = dayInfo.day;
                    const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
                    const dateStr = formatDate(date);
                    const capacitesDay = getCapacitesForSecretaireAndDate(secretaire.id, day);
                    const isWeekendDay = isWeekend(dayInfo);
                    const isHolidayDay = isHoliday(day);

                    // Regrouper matin et après-midi si les deux sont présents ET même site
                    const hasMatin = capacitesDay.some(c => c.demi_journee === 'matin');
                    const hasApresMidi = capacitesDay.some(c => c.demi_journee === 'apres_midi');
                    const capacitesToDisplay = [];

                    if (hasMatin && hasApresMidi) {
                      const matinCap = capacitesDay.find(c => c.demi_journee === 'matin');
                      const apresMidiCap = capacitesDay.find(c => c.demi_journee === 'apres_midi');
                      
                      // Fusionner uniquement si même site
                      if (matinCap?.site_id === apresMidiCap?.site_id) {
                        capacitesToDisplay.push({
                          id: 'merged',
                          demi_journee: 'toute_journee',
                          sites: matinCap?.sites,
                          site_id: matinCap?.site_id,
                          capaciteIds: [matinCap.id, apresMidiCap.id]
                        });
                      } else {
                        // Sites différents, afficher séparément
                        if (matinCap) {
                          capacitesToDisplay.push({
                            id: matinCap.id,
                            demi_journee: matinCap.demi_journee,
                            sites: matinCap.sites,
                            site_id: matinCap.site_id,
                            capaciteIds: [matinCap.id]
                          });
                        }
                        if (apresMidiCap) {
                          capacitesToDisplay.push({
                            id: apresMidiCap.id,
                            demi_journee: apresMidiCap.demi_journee,
                            sites: apresMidiCap.sites,
                            site_id: apresMidiCap.site_id,
                            capaciteIds: [apresMidiCap.id]
                          });
                        }
                      }
                    } else {
                      // Afficher les périodes séparément
                      capacitesDay.forEach(cap => {
                        capacitesToDisplay.push({
                          id: cap.id,
                          demi_journee: cap.demi_journee,
                          sites: cap.sites,
                          site_id: cap.site_id,
                          capaciteIds: [cap.id]
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
                        {capacitesToDisplay.length > 0 ? (
                          <div className="flex flex-col h-full relative">
                            {capacitesToDisplay.map((cap) => (
                              <div
                                key={cap.id}
                                className={`text-[8px] flex-1 w-full leading-none text-center flex items-center justify-center ${getColorForPeriod(
                                  cap.demi_journee
                                )}`}
                                title={cap.sites?.nom}
                              >
                                <div className="truncate font-semibold px-1">
                                  {cap.sites?.nom || 'Site non défini'}
                                </div>
                              </div>
                            ))}
                            <button
                              className="absolute top-0.5 right-0.5 h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-sm flex items-center justify-center z-10 cursor-pointer disabled:opacity-50"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenDeleteDialog(capacitesToDisplay[0]);
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
                            onClick={() => setAddDialog({ open: true, secretaireId: secretaire.id, date: dateStr })}
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
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Capacite Dialog */}
      {addDialog && (
        <Dialog open={addDialog.open} onOpenChange={(open) => !open && setAddDialog(null)}>
          <DialogContent className="z-50 bg-background">
            <DialogHeader>
              <DialogTitle>Ajouter une période</DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Site</label>
                <Select value={selectedSiteId} onValueChange={setSelectedSiteId}>
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Sélectionner un site" />
                  </SelectTrigger>
                  <SelectContent className="z-50 bg-background">
                    {sites.map((site) => (
                      <SelectItem key={site.id} value={site.id}>
                        {site.nom}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Période</label>
                <Select value={selectedPeriod} onValueChange={(v: any) => setSelectedPeriod(v)}>
                  <SelectTrigger className="bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-50 bg-background">
                    <SelectItem value="toute_journee">Toute la journée</SelectItem>
                    <SelectItem value="matin">Matin</SelectItem>
                    <SelectItem value="apres_midi">Après-midi</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setAddDialog(null)}>
                  Annuler
                </Button>
                <Button onClick={handleAddCapacite} disabled={loading}>
                  Ajouter
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Delete Confirmation Dialog */}
      {deleteDialog && (
        <Dialog open={deleteDialog.open} onOpenChange={(open) => !open && setDeleteDialog(null)}>
          <DialogContent className="z-50 bg-background">
            <DialogHeader>
              <DialogTitle>
                {deleteDialog.type === 'merged' ? 'Supprimer les capacités' : 'Confirmer la suppression'}
              </DialogTitle>
            </DialogHeader>

            {deleteDialog.type === 'merged' ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Que souhaitez-vous supprimer pour <span className="font-semibold">{deleteDialog.siteName}</span> ?
                </p>

                <div className="flex flex-col gap-2">
                  <Button 
                    variant="destructive" 
                    onClick={() => handleDeleteCapacites(deleteDialog.capaciteIds)}
                    disabled={loading}
                    className="w-full"
                  >
                    Toute la journée
                  </Button>
                  <Button 
                    variant="outline" 
                    onClick={() => handleDeleteCapacites([deleteDialog.capaciteIds[0]])}
                    disabled={loading}
                    className="w-full"
                  >
                    Matin uniquement
                  </Button>
                  <Button 
                    variant="outline" 
                    onClick={() => handleDeleteCapacites([deleteDialog.capaciteIds[1]])}
                    disabled={loading}
                    className="w-full"
                  >
                    Après-midi uniquement
                  </Button>
                  <Button 
                    variant="ghost" 
                    onClick={() => setDeleteDialog(null)}
                    className="w-full"
                  >
                    Annuler
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Êtes-vous sûr de vouloir supprimer la capacité du{' '}
                  <span className="font-semibold">
                    {deleteDialog.period === 'matin' ? 'Matin' : 'Après-midi'}
                  </span>{' '}
                  pour <span className="font-semibold">{deleteDialog.siteName}</span> ?
                </p>

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setDeleteDialog(null)}>
                    Annuler
                  </Button>
                  <Button 
                    variant="destructive" 
                    onClick={() => handleDeleteCapacites(deleteDialog.capaciteIds)}
                    disabled={loading}
                  >
                    Supprimer
                  </Button>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
      )}

      {/* Export Excel Dialog */}
      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Exporter en Excel</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Date de début</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !exportStartDate && "text-muted-foreground"
                    )}
                  >
                    {exportStartDate ? format(exportStartDate, 'PPP', { locale: fr }) : 'Sélectionner une date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={exportStartDate}
                    onSelect={setExportStartDate}
                    locale={fr}
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Date de fin</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !exportEndDate && "text-muted-foreground"
                    )}
                  >
                    {exportEndDate ? format(exportEndDate, 'PPP', { locale: fr }) : 'Sélectionner une date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={exportEndDate}
                    onSelect={setExportEndDate}
                    locale={fr}
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setExportDialogOpen(false)}>
                Annuler
              </Button>
              <Button onClick={handleExportExcel} disabled={loading || !exportStartDate || !exportEndDate}>
                {loading ? 'Export en cours...' : 'Exporter'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
