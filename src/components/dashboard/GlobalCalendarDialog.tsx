import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { format, eachDayOfInterval, startOfMonth, endOfMonth, getDay, addMonths, subMonths, startOfWeek, endOfWeek } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MedecinActionsDialog } from './MedecinActionsDialog';

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
        .select('id, date, secretaire_id, site_id, demi_journee, sites(nom)')
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
      setBesoins(besoinsData || []);
      setCapacites(capacitesData || []);
      setAbsences(absencesData || []);
      setJoursFeries(feriesData?.map(f => f.date) || []);
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
      <DialogContent className="max-w-[95vw] max-h-[90vh] flex flex-col overflow-hidden z-50">
        <DialogHeader>
          <DialogTitle className="text-2xl">Calendrier Global</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="calendar" className="flex flex-col flex-1 overflow-hidden">
          <TabsList className="grid w-full grid-cols-2 flex-shrink-0">
            <TabsTrigger value="calendar">Calendrier</TabsTrigger>
            <TabsTrigger value="absences">Absences</TabsTrigger>
          </TabsList>

          <TabsContent value="calendar" className="flex flex-col flex-1 overflow-hidden mt-4">
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
              <div className="flex flex-col flex-1 overflow-hidden">
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
                              (isWeekend(day.dateStr) || isHoliday(day.dateStr)) && "bg-muted/50"
                            )}
                          >
                            <div className="font-medium text-xs">
                              {format(day.date, 'EEE', { locale: fr })}
                            </div>
                            <div className="text-muted-foreground text-xs">
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
                                        "p-1 text-center border-l min-w-[80px] flex items-center justify-center",
                                        (isWeekend(day.dateStr) || isHoliday(day.dateStr)) && "bg-muted/20",
                                        showAbsence && "bg-muted/20",
                                        !showAbsence && merged.length === 0 && !isWeekendDay && "bg-amber-50"
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
                                        (isWeekend(day.dateStr) || isHoliday(day.dateStr)) && "bg-muted/20",
                                        showAbsence && "bg-muted/20",
                                        !showAbsence && merged.length === 0 && !isWeekendDay && "bg-amber-50"
                                      )}
                                    >
                                      {showAbsence ? (
                                        <div className="bg-red-100 text-red-800 rounded px-1 py-0.5 text-[10px]" title={absence.motif || ''}>
                                          {getAbsenceLabel(absence.type)}
                                        </div>
                                      ) : merged.length > 0 ? (
                                        <div className="space-y-0.5 w-full">
                                          {merged.map((item, idx) => (
                                            <div
                                              key={idx}
                                              className={cn(
                                                "rounded px-1 py-0.5 text-white text-[10px] truncate",
                                                getColorForPeriod(item.period as any)
                                              )}
                                              title={`${item.siteNom} - ${getPeriodLabel(item.period as any)}`}
                                            >
                                              {formatSiteName(item.siteNom || '')?.substring(0, 8)}
                                            </div>
                                          ))}
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
              </div>
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
  </>
  );
}
