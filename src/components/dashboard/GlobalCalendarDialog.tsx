import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { format, eachDayOfInterval, startOfMonth, endOfMonth, getDay, addMonths, subMonths, startOfWeek, endOfWeek } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MedecinActionsDialog } from './MedecinActionsDialog';
import { SecretaireActionsDialog } from './SecretaireActionsDialog';

interface GlobalCalendarDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface Medecin {
  id: string;
  first_name: string;
  name: string;
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

interface BesoinEffectif {
  id: string;
  date: string;
  medecin_id: string;
  site_id: string;
  demi_journee: 'toute_journee' | 'matin' | 'apres_midi';
  sites?: {
    nom: string;
  };
}

interface CapaciteEffective {
  id: string;
  date: string;
  secretaire_id: string;
  site_id: string;
  demi_journee: 'toute_journee' | 'matin' | 'apres_midi';
  besoin_operation_id?: string | null;
  sites?: {
    nom: string;
  };
}

interface Absence {
  id: string;
  date_debut: string;
  date_fin: string;
  demi_journee: 'matin' | 'apres_midi' | 'toute_journee' | null;
  medecin_id: string | null;
  secretaire_id: string | null;
  type: string;
  motif?: string;
  statut?: string;
}

export function GlobalCalendarDialog({ open, onOpenChange }: GlobalCalendarDialogProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [medecins, setMedecins] = useState<Medecin[]>([]);
  const [secretaires, setSecretaires] = useState<Secretaire[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [besoins, setBesoins] = useState<BesoinEffectif[]>([]);
  const [capacites, setCapacites] = useState<CapaciteEffective[]>([]);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [loading, setLoading] = useState(false);
  const [joursFeries, setJoursFeries] = useState<string[]>([]);
  const [medecinActionsDialog, setMedecinActionsDialog] = useState<{
    open: boolean;
    medecinId: string;
    medecinNom: string;
    medecinPrenom: string;
    date: string;
    siteId: string;
    periode: 'matin' | 'apres_midi' | 'journee';
  } | null>(null);
  const [secretaireActionsDialog, setSecretaireActionsDialog] = useState<{
    open: boolean;
    secretaireId: string;
    secretaireNom: string;
    secretairePrenom: string;
    date: string;
    siteId: string;
    periode: 'matin' | 'apres_midi' | 'journee';
    besoinOperationId?: string | null;
  } | null>(null);
  const [addBesoinDialog, setAddBesoinDialog] = useState<{
    open: boolean;
    medecinId: string;
    medecinNom: string;
    medecinPrenom: string;
    date: string;
  } | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<'matin' | 'apres_midi' | 'toute_journee'>('toute_journee');
  const [selectedSiteId, setSelectedSiteId] = useState<string>('');
  const [selectedTypeInterventionId, setSelectedTypeInterventionId] = useState<string>('');
  const [typesIntervention, setTypesIntervention] = useState<{ id: string; nom: string }[]>([]);
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
      const { data: medData } = await supabase
        .from('medecins')
        .select('id, first_name, name')
        .eq('actif', true)
        .order('first_name');

      const { data: secData } = await supabase
        .from('secretaires')
        .select('id, first_name, name')
        .eq('actif', true)
        .order('first_name');

      const { data: sitesData } = await supabase
        .from('sites')
        .select('id, nom')
        .eq('actif', true)
        .order('nom');

      const { data: typesInterventionData } = await supabase
        .from('types_intervention')
        .select('id, nom')
        .eq('actif', true)
        .order('nom');

      const { data: feriesData } = await supabase
        .from('jours_feries')
        .select('date')
        .eq('actif', true);

      const startDate = formatDate(startOfMonth(currentDate));
      const endDate = formatDate(endOfMonth(currentDate));

      const { data: besoinsData } = await supabase
        .from('besoin_effectif')
        .select('id, date, medecin_id, site_id, demi_journee, sites(nom)')
        .gte('date', startDate)
        .lte('date', endDate)
        .eq('actif', true)
        .not('medecin_id', 'is', null);

      const { data: capacitesData } = await supabase
        .from('capacite_effective')
        .select('id, date, secretaire_id, site_id, demi_journee, besoin_operation_id, sites(nom)')
        .gte('date', startDate)
        .lte('date', endDate)
        .eq('actif', true)
        .not('secretaire_id', 'is', null);

      const { data: absencesData } = await supabase
        .from('absences')
        .select('id, date_debut, date_fin, demi_journee, medecin_id, secretaire_id, type, motif')
        .or(`date_debut.lte.${endDate},date_fin.gte.${startDate}`);

      setMedecins(medData || []);
      setSecretaires(secData || []);
      setSites(sitesData || []);
      setTypesIntervention(typesInterventionData || []);
      setBesoins(besoinsData || []);
      setCapacites(capacitesData || []);
      setAbsences(absencesData || []);
      setJoursFeries(feriesData?.map(f => f.date) || []);
      
      console.log('Calendrier par site - Debug:', {
        sites: sitesData?.length,
        besoins: besoinsData?.length,
        capacites: capacitesData?.length,
        medecins: medData?.length,
        secretaires: secData?.length,
        sampleBesoin: besoinsData?.[0],
        sampleCapacite: capacitesData?.[0]
      });
    } catch (error) {
      console.error('Error fetching data:', error);
      toast({
        variant: 'destructive',
        title: 'Erreur',
        description: 'Impossible de charger les données',
      });
    } finally {
      setLoading(false);
    }
  };

  const handlePrevMonth = () => setCurrentDate(prev => subMonths(prev, 1));
  const handleNextMonth = () => setCurrentDate(prev => addMonths(prev, 1));
  
  const handleMonthChange = (value: string) => {
    const [year, month] = value.split('-').map(Number);
    setCurrentDate(new Date(year, month, 1));
  };

  const getAvailableMonths = () => {
    const months = [];
    const selectedDate = currentDate;
    const selectedYear = selectedDate.getFullYear();
    const selectedMonth = selectedDate.getMonth();
    
    // 12 mois précédents (du plus ancien au plus récent)
    for (let i = 12; i >= 1; i--) {
      const date = new Date(selectedYear, selectedMonth - i, 1);
      months.push({
        value: `${date.getFullYear()}-${date.getMonth()}`,
        label: format(date, 'MMMM yyyy', { locale: fr }),
        isCurrent: false
      });
    }
    
    // Mois sélectionné
    months.push({
      value: `${selectedYear}-${selectedMonth}`,
      label: format(selectedDate, 'MMMM yyyy', { locale: fr }),
      isCurrent: true
    });
    
    // 12 mois suivants
    for (let i = 1; i <= 12; i++) {
      const date = new Date(selectedYear, selectedMonth + i, 1);
      months.push({
        value: `${date.getFullYear()}-${date.getMonth()}`,
        label: format(date, 'MMMM yyyy', { locale: fr }),
        isCurrent: false
      });
    }
    
    return months;
  };

  const currentMonthValue = `${currentDate.getFullYear()}-${currentDate.getMonth()}`;

  const getDaysInMonth = () => {
    const start = startOfMonth(currentDate);
    const end = endOfMonth(currentDate);
    const days = eachDayOfInterval({ start, end });
    return days.map(d => ({
      date: d,
      dateStr: formatDate(d),
      dayOfWeek: getDay(d)
    }));
  };

  const getBesoinsForMedecinAndDate = (medecinId: string, dateStr: string) => {
    return besoins.filter(b => b.medecin_id === medecinId && b.date === dateStr);
  };

  const getCapacitesForSecretaireAndDate = (secretaireId: string, dateStr: string) => {
    return capacites.filter(c => c.secretaire_id === secretaireId && c.date === dateStr);
  };

  const getAbsenceForPersonAndDate = (personId: string, dateStr: string, type: 'medecin' | 'secretaire') => {
    return absences.find(a => {
      const matchPerson = type === 'medecin' ? a.medecin_id === personId : a.secretaire_id === personId;
      return matchPerson && dateStr >= a.date_debut && dateStr <= a.date_fin;
    });
  };

  const getAbsenceLabel = (type: string) => {
    const labels: Record<string, string> = {
      'conges': 'Congés',
      'maladie': 'Maladie',
      'formation': 'Formation',
      'autre': 'Autre'
    };
    return labels[type] || type;
  };

  const formatSiteName = (siteName: string) => {
    if (siteName.startsWith('Clinique La Vallée')) {
      const parts = siteName.split(' - ');
      return parts.length > 1 ? parts[1] : siteName;
    }
    return siteName;
  };

  const mergeAssignments = (assignments: (BesoinEffectif | CapaciteEffective)[]) => {
    const bySite: Record<string, { matin: boolean; apresMidi: boolean; siteNom: string }> = {};
    
    assignments.forEach(a => {
      const siteNom = a.sites?.nom || '';
      if (!bySite[a.site_id]) {
        bySite[a.site_id] = { matin: false, apresMidi: false, siteNom };
      }
      if (a.demi_journee === 'toute_journee') {
        bySite[a.site_id].matin = true;
        bySite[a.site_id].apresMidi = true;
      } else if (a.demi_journee === 'matin') {
        bySite[a.site_id].matin = true;
      } else if (a.demi_journee === 'apres_midi') {
        bySite[a.site_id].apresMidi = true;
      }
    });

    // Convert to array - if both matin and après-midi for same site, merge into toute_journee
    const result = Object.entries(bySite).map(([siteId, data]) => ({
      siteId,
      siteNom: data.siteNom,
      period: (data.matin && data.apresMidi) ? 'toute_journee' : data.matin ? 'matin' : 'apres_midi'
    }));
    
    // Sort: matin first, then apres_midi, then toute_journee
    return result.sort((a, b) => {
      const order = { 'matin': 1, 'apres_midi': 2, 'toute_journee': 3 };
      return order[a.period] - order[b.period];
    });
  };

  const getColorForPeriod = (period: 'matin' | 'apres_midi' | 'toute_journee') => {
    if (period === 'toute_journee') return 'bg-green-500';
    if (period === 'matin') return 'bg-blue-500';
    return 'bg-yellow-500';
  };

  const getPeriodLabel = (period: 'matin' | 'apres_midi' | 'toute_journee') => {
    if (period === 'toute_journee') return 'Journée';
    if (period === 'matin') return 'Matin';
    return 'Après-midi';
  };

  const isWeekend = (dateStr: string) => {
    const date = new Date(dateStr);
    const day = date.getDay();
    return day === 0 || day === 6;
  };

  const isHoliday = (dateStr: string) => joursFeries.includes(dateStr);

  const getWeeksInMonth = () => {
    const start = startOfMonth(currentDate);
    const end = endOfMonth(currentDate);
    const weeks: Date[] = [];
    let current = startOfWeek(start, { locale: fr });
    
    while (current <= end) {
      weeks.push(current);
      current = new Date(current);
      current.setDate(current.getDate() + 7);
    }
    
    return weeks;
  };

  const getAbsencesGroupedByPersonForWeek = (weekStart: Date) => {
    const weekEnd = endOfWeek(weekStart, { locale: fr });
    const weekStartStr = formatDate(weekStart);
    const weekEndStr = formatDate(weekEnd);

    const weekAbsences = absences.filter(a => a.date_debut <= weekEndStr && a.date_fin >= weekStartStr);
    
    // Grouper par personne
    const grouped: Record<string, Absence[]> = {};
    
    weekAbsences.forEach(absence => {
      const key = absence.medecin_id || absence.secretaire_id || 'unknown';
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(absence);
    });

    return grouped;
  };

  const getAbsenceDetails = (absences: Absence[]) => {
    return absences.map(absence => {
      const dateDebut = new Date(absence.date_debut);
      const dateFin = new Date(absence.date_fin);
      
      let periodLabel = '';
      if (absence.demi_journee === 'toute_journee' || !absence.demi_journee) {
        periodLabel = 'Journée complète';
      } else if (absence.demi_journee === 'matin') {
        periodLabel = 'Matin';
      } else {
        periodLabel = 'Après-midi';
      }

      const isSameDay = absence.date_debut === absence.date_fin;
      const dateStr = isSameDay 
        ? `${format(dateDebut, 'd MMM', { locale: fr })} (${periodLabel})`
        : `${format(dateDebut, 'd MMM', { locale: fr })} - ${format(dateFin, 'd MMM', { locale: fr })} (${periodLabel})`;

      return {
        dateStr,
        type: getAbsenceLabel(absence.type),
        statut: absence.statut
      };
    });
  };

  const getPersonName = (absence: Absence) => {
    if (absence.medecin_id) {
      const medecin = medecins.find(m => m.id === absence.medecin_id);
      return medecin ? `Dr ${medecin.first_name} ${medecin.name}` : 'Médecin inconnu';
    }
    if (absence.secretaire_id) {
      const secretaire = secretaires.find(s => s.id === absence.secretaire_id);
      return secretaire ? `${secretaire.first_name} ${secretaire.name}` : 'Assistant inconnu';
    }
    return 'Inconnu';
  };

  const days = getDaysInMonth();

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[98vw] max-h-[95vh] flex flex-col overflow-hidden z-50">
        <DialogHeader>
          <DialogTitle className="text-2xl">Calendrier Global</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="calendar" className="flex flex-col flex-1 overflow-hidden">
          <TabsList className="grid w-full grid-cols-3 flex-shrink-0">
            <TabsTrigger value="calendar">Calendrier</TabsTrigger>
            <TabsTrigger value="sites">Calendrier par site</TabsTrigger>
            <TabsTrigger value="absences">Absences</TabsTrigger>
          </TabsList>

          <TabsContent value="calendar" className="flex flex-col flex-1 overflow-hidden mt-4">
            <div className="flex items-center justify-between flex-shrink-0 mb-4 bg-muted/30 rounded-full p-2 border shadow-sm">
              <Button 
                variant="ghost" 
                size="icon"
                onClick={handlePrevMonth}
                className="h-9 w-9 rounded-full hover:bg-primary hover:text-primary-foreground transition-all"
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <Select value={currentMonthValue} onValueChange={handleMonthChange}>
                <SelectTrigger className="w-[240px] h-9 font-semibold text-base border-0 hover:bg-muted/50 transition-all rounded-full bg-transparent focus:ring-0 focus:ring-offset-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-50 max-h-[300px] overflow-y-auto">
                  {getAvailableMonths().map(month => (
                    <SelectItem 
                      key={month.value} 
                      value={month.value}
                      className="font-medium"
                    >
                      {month.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button 
                variant="ghost" 
                size="icon"
                onClick={handleNextMonth}
                className="h-9 w-9 rounded-full hover:bg-primary hover:text-primary-foreground transition-all"
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
            </div>

            {loading ? (
              <div className="text-center py-8">Chargement...</div>
            ) : (
              <>
                <div className="border rounded-lg flex-1 overflow-auto">
                  <div className="min-w-max">
                    {/* En-tête des dates - sticky pour tout le calendrier */}
                    <div className="sticky top-0 z-30 bg-muted border-b">
                      <div className="flex">
                        <div className="sticky left-0 z-40 bg-muted border-r p-2 min-w-[150px] flex items-center">
                          <span className="font-medium text-xs">Personne</span>
                        </div>
                        {days.map(day => (
                          <div
                            key={day.dateStr}
                            className={cn(
                              "p-1 text-center min-w-[80px] border-l",
                              isWeekend(day.dateStr) && "bg-muted/50",
                              isHoliday(day.dateStr) && "bg-red-50 dark:bg-red-950/20"
                            )}
                          >
                            <div className="font-medium text-xs">
                              {format(day.date, 'EEE', { locale: fr })}
                            </div>
                            <div className={cn(
                              "text-muted-foreground text-xs",
                              isHoliday(day.dateStr) && "text-red-600 dark:text-red-400 font-semibold"
                            )}>
                              {format(day.date, 'd')}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                        {/* Section Médecins */}
                        <div className="mb-6">
                          <h4 className="font-semibold text-sm mb-0 flex items-center gap-2 px-2 py-2 bg-background border-b sticky left-0 z-20">
                            <Badge variant="outline">Médecins</Badge>
                          </h4>
                          <div>
                            {medecins.map(medecin => (
                              <div key={medecin.id} className="flex border-b hover:bg-muted/30 min-h-[40px]">
                                <div className="sticky left-0 z-10 bg-background border-r p-2 min-w-[150px] text-xs font-medium flex items-center">
                                  Dr {medecin.first_name} {medecin.name}
                                </div>
                                {days.map(day => {
                                  const besoinsDay = getBesoinsForMedecinAndDate(medecin.id, day.dateStr);
                                  const absence = getAbsenceForPersonAndDate(medecin.id, day.dateStr, 'medecin');
                                  const merged = mergeAssignments(besoinsDay);
                                  const isWeekendDay = isWeekend(day.dateStr);
                                  const showAbsence = absence && !isWeekendDay;
                                  
                                   return (
                                     <div
                                      key={day.dateStr}
                                      className={cn(
                                        "p-1 text-center border-l min-w-[80px] flex items-center justify-center relative group",
                                        isWeekend(day.dateStr) && "bg-muted/20",
                                        isHoliday(day.dateStr) && "bg-red-50 dark:bg-red-950/20",
                                        showAbsence && "bg-muted/20",
                                        !showAbsence && merged.length === 0 && !isWeekendDay && !isHoliday(day.dateStr) && "bg-amber-50"
                                      )}
                                    >
                                      {showAbsence ? (
                                        <div className="bg-red-100 text-red-800 rounded px-1 py-0.5 text-[10px]" title={absence.motif || ''}>
                                          {getAbsenceLabel(absence.type)}
                                        </div>
                                       ) : merged.length > 0 ? (
                                        <div className="space-y-0.5 w-full">
                                          {merged.map((item, idx) => {
                                            return (
                                              <div
                                                key={idx}
                                                className={cn(
                                                  "rounded px-1 py-0.5 text-white text-[10px] truncate cursor-pointer hover:opacity-80 transition-opacity",
                                                  getColorForPeriod(item.period as any)
                                                )}
                                                title={`${item.siteNom} - ${getPeriodLabel(item.period as any)}`}
                                                onClick={() => {
                                                  setMedecinActionsDialog({
                                                    open: true,
                                                    medecinId: medecin.id,
                                                    medecinNom: medecin.name,
                                                    medecinPrenom: medecin.first_name,
                                                    date: day.dateStr,
                                                    siteId: item.siteId,
                                                    periode: (item.period === 'toute_journee' ? 'journee' : item.period) as 'matin' | 'apres_midi' | 'journee'
                                                  });
                                                }}
                                              >
                                                {formatSiteName(item.siteNom || '')?.substring(0, 8)}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      ) : null}
                                      
                                      {/* Bouton + pour ajouter un besoin */}
                                      {!showAbsence && !isWeekendDay && !isHoliday(day.dateStr) && (merged.length === 0 || merged[0].period !== 'toute_journee') && (
                                        <button
                                          className="absolute top-0.5 right-0.5 h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity bg-primary hover:bg-primary/90 text-primary-foreground rounded-sm flex items-center justify-center z-10 cursor-pointer"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setAddBesoinDialog({
                                              open: true,
                                              medecinId: medecin.id,
                                              medecinNom: medecin.name,
                                              medecinPrenom: medecin.first_name,
                                              date: day.dateStr
                                            });
                                          }}
                                        >
                                          <Plus className="h-2.5 w-2.5" />
                                        </button>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            ))}
                          </div>
                        </div>

                    {/* Section Assistants médicaux */}
                    <div>
                      <h4 className="font-semibold text-sm mb-0 flex items-center gap-2 px-2 py-2 bg-background border-b border-t sticky left-0 z-20">
                        <Badge variant="outline">Assistants médicaux</Badge>
                      </h4>
                      <div>
                        {secretaires.map(secretaire => (
                          <div key={secretaire.id} className="flex border-b hover:bg-muted/30 min-h-[40px]">
                            <div className="sticky left-0 z-10 bg-background border-r p-2 min-w-[150px] text-xs font-medium flex items-center">
                              {secretaire.first_name} {secretaire.name}
                            </div>
                                {days.map(day => {
                                  const capacitesDay = getCapacitesForSecretaireAndDate(secretaire.id, day.dateStr);
                                  const absence = getAbsenceForPersonAndDate(secretaire.id, day.dateStr, 'secretaire');
                                  const merged = mergeAssignments(capacitesDay);
                                  const isWeekendDay = isWeekend(day.dateStr);
                                  const showAbsence = absence && !isWeekendDay;
                                  
                                   return (
                                     <div
                                       key={day.dateStr}
                                       className={cn(
                                         "p-1 text-center border-l min-w-[80px] flex items-center justify-center",
                                         isWeekend(day.dateStr) && "bg-muted/20",
                                         isHoliday(day.dateStr) && "bg-red-50 dark:bg-red-950/20",
                                         showAbsence && "bg-muted/20",
                                         !showAbsence && merged.length === 0 && !isWeekendDay && !isHoliday(day.dateStr) && "bg-amber-50"
                                       )}
                                     >
                                      {showAbsence ? (
                                        <div className="bg-red-100 text-red-800 rounded px-1 py-0.5 text-[10px]" title={absence.motif || ''}>
                                          {getAbsenceLabel(absence.type)}
                                        </div>
                                      ) : merged.length > 0 ? (
                                        <div className="space-y-0.5 w-full">
                                          {merged.map((item, idx) => {
                                            // Find the original capacite to get besoinOperationId
                                            const originalCapacite = capacitesDay.find(c => c.site_id === item.siteId);
                                            return (
                                              <div
                                                key={idx}
                                                className={cn(
                                                  "rounded px-1 py-0.5 text-white text-[10px] truncate cursor-pointer hover:opacity-80 transition-opacity",
                                                  getColorForPeriod(item.period as any)
                                                )}
                                                title={`${item.siteNom} - ${getPeriodLabel(item.period as any)}`}
                                                onClick={() => {
                                                  setSecretaireActionsDialog({
                                                    open: true,
                                                    secretaireId: secretaire.id,
                                                    secretaireNom: secretaire.name,
                                                    secretairePrenom: secretaire.first_name,
                                                    date: day.dateStr,
                                                    siteId: item.siteId,
                                                    periode: (item.period === 'toute_journee' ? 'journee' : item.period) as 'matin' | 'apres_midi' | 'journee',
                                                    besoinOperationId: (originalCapacite as any)?.besoin_operation_id || null
                                                  });
                                                }}
                                              >
                                                {formatSiteName(item.siteNom || '')?.substring(0, 8)}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      ) : null}
                                    </div>
                                  );
                                })}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4 text-xs flex-shrink-0 pt-4 border-t mt-4">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-green-500"></div>
                    <span>Journée complète</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-blue-500"></div>
                    <span>Matin</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-yellow-500"></div>
                    <span>Après-midi</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-red-100 border border-red-300"></div>
                    <span>Absence</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-amber-50 border"></div>
                    <span>Aucune assignation</span>
                  </div>
                  </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="sites" className="flex flex-col flex-1 overflow-hidden mt-4">
            <div className="flex items-center justify-between flex-shrink-0 mb-4 bg-muted/30 rounded-full p-2 border shadow-sm">
              <Button 
                variant="ghost" 
                size="icon"
                onClick={handlePrevMonth}
                className="h-9 w-9 rounded-full hover:bg-primary hover:text-primary-foreground transition-all"
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <Select value={currentMonthValue} onValueChange={handleMonthChange}>
                <SelectTrigger className="w-[240px] h-9 font-semibold text-base border-0 hover:bg-muted/50 transition-all rounded-full bg-transparent focus:ring-0 focus:ring-offset-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-50 max-h-[300px] overflow-y-auto">
                  {getAvailableMonths().map(month => (
                    <SelectItem 
                      key={month.value} 
                      value={month.value}
                      className="font-medium"
                    >
                      {month.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button 
                variant="ghost" 
                size="icon"
                onClick={handleNextMonth}
                className="h-9 w-9 rounded-full hover:bg-primary hover:text-primary-foreground transition-all"
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
            </div>

            {loading ? (
              <div className="text-center py-8">Chargement...</div>
            ) : (
              <>
                  <div className="border rounded-lg flex-1 overflow-auto relative">
                    <table className="w-full border-collapse">
                      <thead className="sticky top-0 z-30 bg-background shadow-sm">
                        <tr>
                          <th className="sticky left-0 z-40 bg-background border-r border-b p-2 min-w-[200px] text-left">
                            <span className="font-medium text-xs">Site / Type</span>
                          </th>
                          {days.map(day => (
                            <th
                              key={day.dateStr}
                              className={cn(
                                "p-1 text-center min-w-[100px] border-l border-b",
                                isWeekend(day.dateStr) && "bg-muted/50",
                                isHoliday(day.dateStr) && "bg-red-50 dark:bg-red-950/20"
                              )}
                            >
                              <div className="font-medium text-xs">
                                {format(day.date, 'EEE', { locale: fr })}
                              </div>
                              <div className={cn(
                                "text-muted-foreground text-xs",
                                isHoliday(day.dateStr) && "text-red-600 dark:text-red-400 font-semibold"
                              )}>
                                {format(day.date, 'd')}
                              </div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sites.map((site, siteIndex) => (
                          <>
                            {/* En-tête du site */}
                            <tr key={`${site.id}-header`} className={cn(
                              "bg-muted/50",
                              siteIndex > 0 && "border-t-2 border-border"
                            )}>
                              <td 
                                className="sticky left-0 z-30 bg-muted/50 p-2 border-r min-w-[200px]"
                              >
                                <div className="text-sm font-semibold">{site.nom}</div>
                              </td>
                              <td colSpan={days.length} className="bg-muted/50"></td>
                            </tr>
                            
                            {/* Ligne Médecins */}
                            <tr key={`${site.id}-medecins`} className="border-b hover:bg-muted/30">
                              <td className="sticky left-0 z-20 bg-background border-r p-2 min-w-[200px]">
                                <div className="text-xs font-medium text-muted-foreground pl-4">Médecins</div>
                              </td>
                              {days.map(day => {
                                const besoinsDay = besoins.filter(b => 
                                  b.date === day.dateStr && 
                                  b.site_id === site.id
                                );
                                
                                // Grouper par médecin et tracker leurs périodes
                                const medecinsPeriodes = new Map<string, { matin: boolean; apresMidi: boolean; nom: string; prenom: string }>();
                                besoinsDay.forEach(besoin => {
                                  if (besoin.medecin_id) {
                                    const medecin = medecins.find(m => m.id === besoin.medecin_id);
                                    if (medecin) {
                                      const existing = medecinsPeriodes.get(besoin.medecin_id) || { 
                                        matin: false, 
                                        apresMidi: false, 
                                        nom: medecin.name,
                                        prenom: medecin.first_name
                                      };
                                      if (besoin.demi_journee === 'matin' || besoin.demi_journee === 'toute_journee') {
                                        existing.matin = true;
                                      }
                                      if (besoin.demi_journee === 'apres_midi' || besoin.demi_journee === 'toute_journee') {
                                        existing.apresMidi = true;
                                      }
                                      medecinsPeriodes.set(besoin.medecin_id, existing);
                                    }
                                  }
                                });

                                return (
                                  <td
                                    key={day.dateStr}
                                    className={cn(
                                      "p-1 text-center min-w-[100px] border-l align-top",
                                      isWeekend(day.dateStr) && "bg-muted/50",
                                      isHoliday(day.dateStr) && "bg-red-50 dark:bg-red-950/20"
                                    )}
                                  >
                                    <div className="space-y-0.5">
                                      {Array.from(medecinsPeriodes.entries())
                                        .sort(([idA, infoA], [idB, infoB]) => {
                                          // Fonction pour déterminer l'ordre de couleur (vert=1, bleu=2, jaune=3)
                                          const getColorOrder = (info: { matin: boolean; apresMidi: boolean }) => {
                                            if (info.matin && info.apresMidi) return 1; // Vert (journée complète)
                                            if (info.matin) return 2; // Bleu (matin)
                                            return 3; // Jaune (après-midi)
                                          };
                                          
                                          const orderA = getColorOrder(infoA);
                                          const orderB = getColorOrder(infoB);
                                          
                                          // D'abord trier par couleur
                                          if (orderA !== orderB) return orderA - orderB;
                                          
                                          // Ensuite par ordre alphabétique (nom complet)
                                          const nomCompletA = `${infoA.prenom} ${infoA.nom}`.toLowerCase();
                                          const nomCompletB = `${infoB.prenom} ${infoB.nom}`.toLowerCase();
                                          return nomCompletA.localeCompare(nomCompletB);
                                        })
                                        .map(([medecinId, info]) => {
                                        const absence = getAbsenceForPersonAndDate(medecinId, day.dateStr, 'medecin');
                                        const showAbsence = absence && !isWeekend(day.dateStr);

                                        const periodeLabel = info.matin && info.apresMidi ? 'Journée complète' : info.matin ? 'Matin' : 'Après-midi';
                                        const periodeValue = info.matin && info.apresMidi ? 'journee' : info.matin ? 'matin' : 'apres_midi';
                                        const bgColor = info.matin && info.apresMidi ? 'bg-green-500' : info.matin ? 'bg-blue-500' : 'bg-yellow-500';
                                        
                                        return (
                                          <div
                                            key={medecinId}
                                            className={cn(
                                              "rounded px-1 py-0.5 text-white text-[10px] truncate cursor-pointer hover:opacity-80 transition-opacity",
                                              showAbsence ? "bg-red-100 !text-red-800 border border-red-300" : bgColor
                                            )}
                                            title={`${info.prenom} ${info.nom} - ${periodeLabel}`}
                                            onClick={() => {
                                              setMedecinActionsDialog({
                                                open: true,
                                                medecinId: medecinId,
                                                medecinNom: info.nom,
                                                medecinPrenom: info.prenom,
                                                date: day.dateStr,
                                                siteId: site.id,
                                                periode: periodeValue as 'matin' | 'apres_midi' | 'journee'
                                              });
                                            }}
                                          >
                                            {info.prenom} {info.nom}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </td>
                                );
                              })}
                            </tr>
                            
                            {/* Ligne Assistants */}
                            <tr key={`${site.id}-assistants`} className="border-b hover:bg-muted/30">
                              <td className="sticky left-0 z-20 bg-background border-r p-2 min-w-[200px]">
                                <div className="text-xs font-medium text-muted-foreground pl-4">Assistants</div>
                              </td>
                              {days.map(day => {
                                const capacitesDay = capacites.filter(c => 
                                  c.date === day.dateStr && 
                                  c.site_id === site.id
                                );
                                
                                // Grouper par secrétaire et tracker leurs périodes
                                const secretairesPeriodes = new Map<string, { matin: boolean; apresMidi: boolean; nom: string; prenom: string; besoinOperationId?: string | null }>();
                                capacitesDay.forEach(capacite => {
                                  if (capacite.secretaire_id) {
                                    const secretaire = secretaires.find(s => s.id === capacite.secretaire_id);
                                    if (secretaire) {
                                      const existing = secretairesPeriodes.get(capacite.secretaire_id) || { 
                                        matin: false, 
                                        apresMidi: false, 
                                        nom: secretaire.name,
                                        prenom: secretaire.first_name,
                                        besoinOperationId: capacite.besoin_operation_id
                                      };
                                      if (capacite.demi_journee === 'matin' || capacite.demi_journee === 'toute_journee') {
                                        existing.matin = true;
                                      }
                                      if (capacite.demi_journee === 'apres_midi' || capacite.demi_journee === 'toute_journee') {
                                        existing.apresMidi = true;
                                      }
                                      // Keep first besoin_operation_id found
                                      if (!existing.besoinOperationId && capacite.besoin_operation_id) {
                                        existing.besoinOperationId = capacite.besoin_operation_id;
                                      }
                                      secretairesPeriodes.set(capacite.secretaire_id, existing);
                                    }
                                  }
                                });

                                return (
                                  <td
                                    key={day.dateStr}
                                    className={cn(
                                      "p-1 text-center min-w-[100px] border-l border-t align-top",
                                      isWeekend(day.dateStr) && "bg-muted/50",
                                      isHoliday(day.dateStr) && "bg-red-50 dark:bg-red-950/20"
                                    )}
                                  >
                                    <div className="space-y-0.5">
                                      {Array.from(secretairesPeriodes.entries())
                                        .sort(([idA, infoA], [idB, infoB]) => {
                                          // Fonction pour déterminer l'ordre de couleur (vert=1, bleu=2, jaune=3)
                                          const getColorOrder = (info: { matin: boolean; apresMidi: boolean }) => {
                                            if (info.matin && info.apresMidi) return 1; // Vert (journée complète)
                                            if (info.matin) return 2; // Bleu (matin)
                                            return 3; // Jaune (après-midi)
                                          };
                                          
                                          const orderA = getColorOrder(infoA);
                                          const orderB = getColorOrder(infoB);
                                          
                                          // D'abord trier par couleur
                                          if (orderA !== orderB) return orderA - orderB;
                                          
                                          // Ensuite par ordre alphabétique (nom complet)
                                          const nomCompletA = `${infoA.prenom} ${infoA.nom}`.toLowerCase();
                                          const nomCompletB = `${infoB.prenom} ${infoB.nom}`.toLowerCase();
                                          return nomCompletA.localeCompare(nomCompletB);
                                        })
                                        .map(([secretaireId, info]) => {
                                        const absence = getAbsenceForPersonAndDate(secretaireId, day.dateStr, 'secretaire');
                                        const showAbsence = absence && !isWeekend(day.dateStr);

                                        const periodeLabel = info.matin && info.apresMidi ? 'Journée complète' : info.matin ? 'Matin' : 'Après-midi';
                                        const periodeValue = info.matin && info.apresMidi ? 'journee' : info.matin ? 'matin' : 'apres_midi';
                                        const bgColor = info.matin && info.apresMidi ? 'bg-green-500' : info.matin ? 'bg-blue-500' : 'bg-yellow-500';
                                        
                                        return (
                                          <div
                                            key={secretaireId}
                                            className={cn(
                                              "rounded px-1 py-0.5 text-white text-[10px] truncate cursor-pointer hover:opacity-80 transition-opacity",
                                              showAbsence ? "bg-red-100 !text-red-800 border border-red-300" : bgColor
                                            )}
                                            title={`${info.prenom} ${info.nom} - ${periodeLabel}`}
                                            onClick={() => {
                                              setSecretaireActionsDialog({
                                                open: true,
                                                secretaireId: secretaireId,
                                                secretaireNom: info.nom,
                                                secretairePrenom: info.prenom,
                                                date: day.dateStr,
                                                siteId: site.id,
                                                periode: periodeValue as 'matin' | 'apres_midi' | 'journee',
                                                besoinOperationId: info.besoinOperationId
                                              });
                                            }}
                                          >
                                            {info.prenom} {info.nom}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </td>
                                );
                              })}
                            </tr>
                          </>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  
                  <div className="flex items-center gap-4 text-xs flex-shrink-0 pt-4 border-t mt-4">
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded bg-green-500"></div>
                      <span>Journée entière</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded bg-blue-500"></div>
                      <span>Matin</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded bg-yellow-500"></div>
                      <span>Après-midi</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded bg-red-100 border border-red-300"></div>
                      <span>Absence</span>
                    </div>
                  </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="absences" className="flex flex-col flex-1 overflow-hidden mt-4">
            <div className="flex items-center justify-between flex-shrink-0 mb-6 bg-muted/30 rounded-full p-2 border shadow-sm">
              <Button 
                variant="ghost" 
                size="icon"
                onClick={handlePrevMonth}
                className="h-9 w-9 rounded-full hover:bg-primary hover:text-primary-foreground transition-all"
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <Select value={currentMonthValue} onValueChange={handleMonthChange}>
                <SelectTrigger className="w-[240px] h-9 font-semibold text-base border-0 hover:bg-muted/50 transition-all rounded-full bg-transparent focus:ring-0 focus:ring-offset-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-50 max-h-[300px] overflow-y-auto">
                  {getAvailableMonths().map(month => (
                    <SelectItem 
                      key={month.value} 
                      value={month.value}
                      className="font-medium"
                    >
                      {month.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button 
                variant="ghost" 
                size="icon"
                onClick={handleNextMonth}
                className="h-9 w-9 rounded-full hover:bg-primary hover:text-primary-foreground transition-all"
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
            </div>

            {loading ? (
              <div className="text-center py-8">Chargement...</div>
            ) : (
              <div className="flex-1 overflow-y-auto">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {getWeeksInMonth().map((weekStart, idx) => {
                  const grouped = getAbsencesGroupedByPersonForWeek(weekStart);
                  const weekEnd = endOfWeek(weekStart, { locale: fr });
                  
                  const medecinKeys = Object.keys(grouped).filter(key => 
                    grouped[key].some(a => a.medecin_id === key)
                  );
                  const secretaireKeys = Object.keys(grouped).filter(key => 
                    grouped[key].some(a => a.secretaire_id === key)
                  );
                  
                  if (medecinKeys.length === 0 && secretaireKeys.length === 0) {
                    return null;
                  }

                  return (
                    <div key={idx} className="border rounded-lg p-4 space-y-4 shadow-sm hover:shadow-md transition-shadow bg-card">
                      <div className="flex items-center justify-between pb-3 border-b">
                        <h4 className="font-semibold text-base">
                          Du {format(weekStart, 'd MMM', { locale: fr })} au {format(weekEnd, 'd MMM', { locale: fr })}
                        </h4>
                        <div className="flex items-center gap-2 text-sm">
                          <Badge variant="destructive" className="flex items-center gap-1">
                            <span className="font-semibold">{medecinKeys.length}</span>
                            <span>médecin{medecinKeys.length > 1 ? 's' : ''}</span>
                          </Badge>
                          <Badge variant="destructive" className="flex items-center gap-1">
                            <span className="font-semibold">{secretaireKeys.length}</span>
                            <span>assistant{secretaireKeys.length > 1 ? 's' : ''}</span>
                          </Badge>
                        </div>
                      </div>

                      {medecinKeys.length > 0 && (
                        <div>
                          <h5 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">Médecins</h5>
                          <div className="space-y-2">
                            {medecinKeys.map(medecinId => {
                              const medecinAbsences = grouped[medecinId];
                              const details = getAbsenceDetails(medecinAbsences);
                              
                              // Calculer la période totale et le nombre de jours
                              const dateDebuts = medecinAbsences.map(a => new Date(a.date_debut));
                              const dateFins = medecinAbsences.map(a => new Date(a.date_fin));
                              const minDate = new Date(Math.min(...dateDebuts.map(d => d.getTime())));
                              const maxDate = new Date(Math.max(...dateFins.map(d => d.getTime())));
                              const nombreJours = Math.ceil((maxDate.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
                              
                              return (
                                <div key={medecinId} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 hover:border-primary/30 transition-all group">
                                  <div className="flex flex-col gap-1.5">
                                    <span className="text-sm font-semibold group-hover:text-primary transition-colors">{getPersonName(medecinAbsences[0])}</span>
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs text-muted-foreground font-medium">
                                        Du {format(minDate, 'd MMM', { locale: fr })} au {format(maxDate, 'd MMM', { locale: fr })}
                                      </span>
                                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                        {nombreJours} jour{nombreJours > 1 ? 's' : ''}
                                      </Badge>
                                    </div>
                                  </div>
                                  <Badge variant="outline" className="text-xs bg-background shadow-sm">
                                    {getAbsenceLabel(medecinAbsences[0].type)}
                                  </Badge>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {secretaireKeys.length > 0 && (
                        <div>
                          <h5 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">Assistants médicaux</h5>
                          <div className="space-y-2">
                            {secretaireKeys.map(secretaireId => {
                              const secretaireAbsences = grouped[secretaireId];
                              const details = getAbsenceDetails(secretaireAbsences);
                              
                              // Calculer la période totale et le nombre de jours
                              const dateDebuts = secretaireAbsences.map(a => new Date(a.date_debut));
                              const dateFins = secretaireAbsences.map(a => new Date(a.date_fin));
                              const minDate = new Date(Math.min(...dateDebuts.map(d => d.getTime())));
                              const maxDate = new Date(Math.max(...dateFins.map(d => d.getTime())));
                              const nombreJours = Math.ceil((maxDate.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
                              
                              return (
                                <div key={secretaireId} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 hover:border-primary/30 transition-all group">
                                  <div className="flex flex-col gap-1.5">
                                    <span className="text-sm font-semibold group-hover:text-primary transition-colors">{getPersonName(secretaireAbsences[0])}</span>
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs text-muted-foreground font-medium">
                                        Du {format(minDate, 'd MMM', { locale: fr })} au {format(maxDate, 'd MMM', { locale: fr })}
                                      </span>
                                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                        {nombreJours} jour{nombreJours > 1 ? 's' : ''}
                                      </Badge>
                                    </div>
                                  </div>
                                  <Badge variant="outline" className="text-xs bg-background shadow-sm">
                                    {getAbsenceLabel(secretaireAbsences[0].type)}
                                  </Badge>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                </div>

                {getWeeksInMonth().every(week => {
                  const grouped = getAbsencesGroupedByPersonForWeek(week);
                  return Object.keys(grouped).length === 0;
                }) && (
                  <div className="text-center py-8 text-muted-foreground">
                    Aucune absence ce mois-ci
                  </div>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>

    {/* Add Besoin Dialog */}
    {addBesoinDialog && (
      <Dialog open={addBesoinDialog.open} onOpenChange={(open) => !open && setAddBesoinDialog(null)}>
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
                    <SelectValue placeholder="Sélectionner un type d'intervention" />
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
              <Button variant="outline" onClick={() => setAddBesoinDialog(null)}>
                Annuler
              </Button>
              <Button onClick={async () => {
                if (!selectedSiteId) {
                  toast({
                    variant: 'destructive',
                    title: 'Erreur',
                    description: 'Veuillez sélectionner un site',
                  });
                  return;
                }

                try {
                  const isBlocSite = sites.find(s => s.id === selectedSiteId)?.nom.includes('Bloc opératoire');
                  
                  if (selectedPeriod === 'toute_journee') {
                    // Créer deux besoins pour toute la journée
                    const { error: errorMatin } = await supabase
                      .from('besoin_effectif')
                      .insert({
                        date: addBesoinDialog!.date,
                        medecin_id: addBesoinDialog!.medecinId,
                        site_id: selectedSiteId,
                        demi_journee: 'matin',
                        type: isBlocSite ? 'bloc_operatoire' : 'medecin',
                        type_intervention_id: isBlocSite ? selectedTypeInterventionId : null,
                      });

                    if (errorMatin) throw errorMatin;

                    const { error: errorApresMidi } = await supabase
                      .from('besoin_effectif')
                      .insert({
                        date: addBesoinDialog!.date,
                        medecin_id: addBesoinDialog!.medecinId,
                        site_id: selectedSiteId,
                        demi_journee: 'apres_midi',
                        type: isBlocSite ? 'bloc_operatoire' : 'medecin',
                        type_intervention_id: isBlocSite ? selectedTypeInterventionId : null,
                      });

                    if (errorApresMidi) throw errorApresMidi;
                  } else {
                    const { error } = await supabase
                      .from('besoin_effectif')
                      .insert({
                        date: addBesoinDialog!.date,
                        medecin_id: addBesoinDialog!.medecinId,
                        site_id: selectedSiteId,
                        demi_journee: selectedPeriod,
                        type: isBlocSite ? 'bloc_operatoire' : 'medecin',
                        type_intervention_id: isBlocSite ? selectedTypeInterventionId : null,
                      });

                    if (error) throw error;
                  }

                  toast({
                    title: 'Succès',
                    description: 'Besoin ajouté avec succès',
                  });

                  setAddBesoinDialog(null);
                  setSelectedPeriod('toute_journee');
                  setSelectedSiteId('');
                  setSelectedTypeInterventionId('');
                  fetchData();
                } catch (error) {
                  console.error('Error adding besoin:', error);
                  toast({
                    variant: 'destructive',
                    title: 'Erreur',
                    description: 'Impossible d\'ajouter le besoin',
                  });
                }
              }}>
                Ajouter
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    )}

    {medecinActionsDialog && (
      <MedecinActionsDialog
        open={medecinActionsDialog.open}
        onOpenChange={(open) => {
          if (!open) {
            setMedecinActionsDialog(null);
          }
        }}
        medecinId={medecinActionsDialog.medecinId}
        medecinNom={medecinActionsDialog.medecinNom}
        medecinPrenom={medecinActionsDialog.medecinPrenom}
        date={medecinActionsDialog.date}
        siteId={medecinActionsDialog.siteId}
        periode={medecinActionsDialog.periode}
        onRefresh={fetchData}
      />
    )}

    {secretaireActionsDialog && (
      <SecretaireActionsDialog
        open={secretaireActionsDialog.open}
        onOpenChange={(open) => {
          if (!open) {
            setSecretaireActionsDialog(null);
          }
        }}
        secretaireId={secretaireActionsDialog.secretaireId}
        secretaireNom={`${secretaireActionsDialog.secretairePrenom} ${secretaireActionsDialog.secretaireNom}`}
        date={secretaireActionsDialog.date}
        siteId={secretaireActionsDialog.siteId}
        periode={secretaireActionsDialog.periode}
        besoinOperationId={secretaireActionsDialog.besoinOperationId}
        onRefresh={fetchData}
      />
    )}
  </>
  );
}
