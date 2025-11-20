import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ChevronLeft, ChevronRight, Plus, Stethoscope, User } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { format, eachDayOfInterval, startOfMonth, endOfMonth, getDay, addMonths, subMonths, startOfWeek, endOfWeek } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MedecinActionsDialog } from './MedecinActionsDialog';
import { SecretaireActionsDialog } from './SecretaireActionsDialog';
import { AddMedecinToDayDialog } from './AddMedecinToDayDialog';
import { ReassignMedecinDialog } from './ReassignMedecinDialog';
import { AddSecretaireToDayDialog } from './AddSecretaireToDayDialog';
import { ReassignSecretaireDialog } from './ReassignSecretaireDialog';

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
  planning_genere_bloc_operatoire?: Array<{
    salle_assignee: string | null;
    salles_operation?: {
      name: string;
    } | null;
  }>;
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
  planning_genere_bloc_operatoire?: {
    salle_assignee: string | null;
    salles_operation?: {
      name: string;
    } | null;
  } | null;
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
  const [addMedecinDialog, setAddMedecinDialog] = useState({
    open: false,
    date: '',
    siteId: '',
  });

  const [reassignMedecinDialog, setReassignMedecinDialog] = useState({
    open: false,
    date: '',
    siteId: '',
    siteName: '',
  });

  const [addSecretaireDialog, setAddSecretaireDialog] = useState({
    open: false,
    date: '',
    siteId: '',
    siteName: '',
  });

  const [reassignSecretaireDialog, setReassignSecretaireDialog] = useState({
    open: false,
    date: '',
    siteId: '',
    siteName: '',
  });
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
        .select(`
          id, 
          date, 
          medecin_id, 
          site_id, 
          demi_journee, 
          sites(nom),
          planning_genere_bloc_operatoire(
            salle_assignee,
            salles_operation:salle_assignee(name)
          )
        `)
        .gte('date', startDate)
        .lte('date', endDate)
        .eq('actif', true)
        .not('medecin_id', 'is', null);

      const { data: capacitesData } = await supabase
        .from('capacite_effective')
        .select(`
          id, 
          date, 
          secretaire_id, 
          site_id, 
          demi_journee, 
          besoin_operation_id, 
          sites(nom),
          planning_genere_bloc_operatoire:planning_genere_bloc_operatoire_id(
            salle_assignee,
            salles_operation:salle_assignee(name)
          )
        `)
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
      'autre': 'Autre',
      'conge_maternite': 'Maternité'
    };
    return labels[type] || type;
  };

  const formatSiteName = (siteName: string) => {
    let formatted = siteName;
    
    // Retirer le préfixe "Clinique La Vallée" si présent
    if (formatted.startsWith('Clinique La Vallée')) {
      const parts = formatted.split(' - ');
      formatted = parts.length > 1 ? parts[1] : formatted;
    }
    
    // Appliquer les abréviations
    formatted = formatted
      .replace(/Vieille ville.*/gi, 'Gastro')
      .replace(/Angiologie/gi, 'Angio')
      .replace(/Dermatologie/gi, 'Dermato');
    
    return formatted;
  };

  const formatSiteNameWithSalle = (siteName: string, salleName?: string | null): string => {
    // Si la salle est "Bloc Gastroentérologie", afficher "Gastro" au lieu de "Bloc"
    if (salleName && salleName.toLowerCase().includes('gastro')) {
      return 'Gastro';
    }
    
    // Sinon, appliquer la logique normale
    return formatSiteName(siteName);
  };

  // Helper pour réaffecter le site si c'est une opération gastro
  const getEffectiveSiteId = (originalSiteId: string, salleName?: string | null): string => {
    // Si la salle est "Bloc Gastroentérologie", retourner le site Vieille ville Gastro
    if (salleName && salleName.toLowerCase().includes('gastro')) {
      const gastroSite = sites.find(s => s.nom.toLowerCase().includes('vieille') && s.nom.toLowerCase().includes('gastro'));
      if (gastroSite) {
        return gastroSite.id;
      }
    }
    return originalSiteId;
  };

  const mergeAssignments = (assignments: (BesoinEffectif | CapaciteEffective)[]) => {
    const bySite: Record<string, { 
      matin: boolean; 
      apresMidi: boolean; 
      siteNom: string;
      salleName?: string | null;
    }> = {};
    
    assignments.forEach(a => {
      const siteNom = a.sites?.nom || '';
      
      // Récupérer le nom de la salle si elle existe
      let salleName: string | null = null;
      if ('planning_genere_bloc_operatoire' in a) {
        const besoin = a as BesoinEffectif;
        // Pour les médecins, planning_genere_bloc_operatoire est un array
        if (besoin.planning_genere_bloc_operatoire && besoin.planning_genere_bloc_operatoire.length > 0) {
          const bloc = besoin.planning_genere_bloc_operatoire[0];
          salleName = bloc.salles_operation?.name || null;
        }
      } else if ('planning_genere_bloc_operatoire_id' in a) {
        const capacite = a as CapaciteEffective;
        // Pour les secrétaires, planning_genere_bloc_operatoire est un objet
        if (capacite.planning_genere_bloc_operatoire) {
          salleName = capacite.planning_genere_bloc_operatoire.salles_operation?.name || null;
        }
      }
      
      if (!bySite[a.site_id]) {
        bySite[a.site_id] = { matin: false, apresMidi: false, siteNom, salleName };
      }
      
      // Si on a une salle, la mettre à jour
      if (salleName && !bySite[a.site_id].salleName) {
        bySite[a.site_id].salleName = salleName;
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
      salleName: data.salleName,
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

        <Tabs defaultValue="calendar" className="flex flex-col flex-1 overflow-hidden">
          <TabsList className="grid w-full grid-cols-3 flex-shrink-0 h-9">
            <TabsTrigger value="calendar" className="h-7 text-sm">Calendrier</TabsTrigger>
            <TabsTrigger value="sites" className="h-7 text-sm">Calendrier par site</TabsTrigger>
            <TabsTrigger value="absences" className="h-7 text-sm">Absences</TabsTrigger>
          </TabsList>

          <TabsContent value="calendar" className="flex flex-col flex-1 overflow-hidden mt-2">
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
                                                {formatSiteNameWithSalle(item.siteNom || '', item.salleName)?.substring(0, 8)}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      ) : null}
                                      
                                      {/* Bouton + pour ajouter un besoin - désactivé dans l'onglet Calendrier principal */}
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
                                                {formatSiteNameWithSalle(item.siteNom || '', item.salleName)?.substring(0, 8)}
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

          <TabsContent value="sites" className="flex flex-col flex-1 overflow-hidden mt-2">
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
                      <thead className="sticky top-0 z-30 bg-muted shadow-sm border-b">
                        <tr>
                          <th className="sticky left-0 z-40 bg-muted border-r p-2 min-w-[200px] text-left">
                            <span className="font-medium text-xs">Site / Type</span>
                          </th>
                          {days.map(day => (
                            <th
                              key={day.dateStr}
                              className={cn(
                                "p-1 text-center min-w-[100px] border-l",
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
                                const besoinsDay = besoins.filter(b => {
                                  if (b.date !== day.dateStr) return false;
                                  
                                  // Récupérer le nom de la salle
                                  let salleName: string | null = null;
                                  if (b.planning_genere_bloc_operatoire && b.planning_genere_bloc_operatoire.length > 0) {
                                    salleName = b.planning_genere_bloc_operatoire[0].salles_operation?.name || null;
                                  }
                                  
                                  // Comparer avec le site effectif (réaffecté si gastro)
                                  const effectiveSiteId = getEffectiveSiteId(b.site_id, salleName);
                                  return effectiveSiteId === site.id;
                                });
                                
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
                                      "p-1 text-center min-w-[100px] border-l align-top relative group",
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
                                    {/* Bouton + pour ajouter un médecin */}
                                    {!isWeekend(day.dateStr) && !isHoliday(day.dateStr) && (
                                      <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                          <Button
                                            size="icon"
                                            variant="ghost"
                                            className="absolute top-0.5 right-0.5 h-5 w-5 rounded-sm bg-primary/10 hover:bg-primary hover:text-primary-foreground opacity-0 group-hover:opacity-100 transition-all shadow-sm z-10"
                                            onClick={(e) => e.stopPropagation()}
                                          >
                                            <Plus className="h-3 w-3" />
                                          </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="w-56 z-[100]">
                                          <DropdownMenuItem
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setAddMedecinDialog({
                                                open: true,
                                                date: day.dateStr,
                                                siteId: site.id,
                                              });
                                            }}
                                          >
                                            <Stethoscope className="h-4 w-4 mr-2" />
                                            Ajouter un médecin sans créneau
                                          </DropdownMenuItem>
                                          <DropdownMenuItem
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setReassignMedecinDialog({
                                                open: true,
                                                date: day.dateStr,
                                                siteId: site.id,
                                                siteName: site.nom,
                                              });
                                            }}
                                          >
                                            <Stethoscope className="h-4 w-4 mr-2" />
                                            Réaffecter depuis un autre site
                                          </DropdownMenuItem>
                                        </DropdownMenuContent>
                                      </DropdownMenu>
                                    )}
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
                                const capacitesDay = capacites.filter(c => {
                                  if (c.date !== day.dateStr) return false;
                                  
                                  // Récupérer le nom de la salle
                                  let salleName: string | null = null;
                                  if (c.planning_genere_bloc_operatoire) {
                                    salleName = c.planning_genere_bloc_operatoire.salles_operation?.name || null;
                                  }
                                  
                                  // Comparer avec le site effectif (réaffecté si gastro)
                                  const effectiveSiteId = getEffectiveSiteId(c.site_id, salleName);
                                  return effectiveSiteId === site.id;
                                });
                                
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
                                      "p-1 text-center min-w-[100px] border-l border-t align-top relative group",
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
                                    {/* Bouton + pour ajouter un assistant */}
                                    {!isWeekend(day.dateStr) && !isHoliday(day.dateStr) && (
                                      <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                          <Button
                                            size="icon"
                                            variant="ghost"
                                            className="absolute top-0.5 right-0.5 h-5 w-5 rounded-sm bg-primary/10 hover:bg-primary hover:text-primary-foreground opacity-0 group-hover:opacity-100 transition-all shadow-sm z-10"
                                            onClick={(e) => e.stopPropagation()}
                                          >
                                            <Plus className="h-3 w-3" />
                                          </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="w-56 z-[100]">
                                          <DropdownMenuItem
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setAddSecretaireDialog({
                                                open: true,
                                                date: day.dateStr,
                                                siteId: site.id,
                                                siteName: site.nom,
                                              });
                                            }}
                                          >
                                            <User className="h-4 w-4 mr-2" />
                                            Ajouter quelqu'un sans créneau
                                          </DropdownMenuItem>
                                          <DropdownMenuItem
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setReassignSecretaireDialog({
                                                open: true,
                                                date: day.dateStr,
                                                siteId: site.id,
                                                siteName: site.nom,
                                              });
                                            }}
                                          >
                                            <Stethoscope className="h-4 w-4 mr-2" />
                                            Réaffecter depuis un autre site
                                          </DropdownMenuItem>
                                        </DropdownMenuContent>
                                      </DropdownMenu>
                                    )}
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

          <TabsContent value="absences" className="flex flex-col flex-1 overflow-hidden mt-2">
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

    {/* Dialogs */}
    <AddMedecinToDayDialog
      open={addMedecinDialog.open}
      onOpenChange={(open) => setAddMedecinDialog({ ...addMedecinDialog, open })}
      date={addMedecinDialog.date}
      siteId={addMedecinDialog.siteId}
      onSuccess={() => {
        setAddMedecinDialog({ open: false, date: '', siteId: '' });
        fetchData();
      }}
    />

    <ReassignMedecinDialog
      open={reassignMedecinDialog.open}
      onOpenChange={(open) => setReassignMedecinDialog({ ...reassignMedecinDialog, open })}
      date={reassignMedecinDialog.date}
      targetSiteId={reassignMedecinDialog.siteId}
      targetSiteName={reassignMedecinDialog.siteName}
      onSuccess={() => {
        setReassignMedecinDialog({ open: false, date: '', siteId: '', siteName: '' });
        fetchData();
      }}
    />

    <AddSecretaireToDayDialog
      open={addSecretaireDialog.open}
      onOpenChange={(open) => setAddSecretaireDialog({ ...addSecretaireDialog, open })}
      date={addSecretaireDialog.date}
      siteId={addSecretaireDialog.siteId}
      siteName={addSecretaireDialog.siteName}
      onSuccess={() => {
        setAddSecretaireDialog({ open: false, date: '', siteId: '', siteName: '' });
        fetchData();
      }}
    />

    <ReassignSecretaireDialog
      open={reassignSecretaireDialog.open}
      onOpenChange={(open) => setReassignSecretaireDialog({ ...reassignSecretaireDialog, open })}
      date={reassignSecretaireDialog.date}
      targetSiteId={reassignSecretaireDialog.siteId}
      targetSiteName={reassignSecretaireDialog.siteName}
      onSuccess={() => {
        setReassignSecretaireDialog({ open: false, date: '', siteId: '', siteName: '' });
        fetchData();
      }}
    />

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
