import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ChevronLeft, ChevronRight, Plus, Trash2, Calendar as CalendarIcon } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { format, eachDayOfInterval, startOfMonth, endOfMonth, getDay, addMonths, subMonths, startOfWeek, endOfWeek, isSameWeek } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';

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
  demi_journee: 'matin' | 'apres_midi' | 'toute_journee';
  medecin_id: string | null;
  secretaire_id: string | null;
  type: string;
  motif?: string;
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
      // Fetch médecins actifs
      const { data: medData } = await supabase
        .from('medecins')
        .select('id, first_name, name')
        .eq('actif', true)
        .order('first_name');

      // Fetch secrétaires actifs
      const { data: secData } = await supabase
        .from('secretaires')
        .select('id, first_name, name')
        .eq('actif', true)
        .order('first_name');

      // Fetch sites
      const { data: sitesData } = await supabase
        .from('sites')
        .select('id, nom')
        .eq('actif', true)
        .order('nom');

      // Fetch jours fériés
      const { data: feriesData } = await supabase
        .from('jours_feries')
        .select('date')
        .eq('actif', true);

      const startDate = formatDate(startOfMonth(currentDate));
      const endDate = formatDate(endOfMonth(currentDate));

      // Fetch besoins effectifs (médecins)
      const { data: besoinsData } = await supabase
        .from('besoin_effectif')
        .select('id, date, medecin_id, site_id, demi_journee, sites(nom)')
        .gte('date', startDate)
        .lte('date', endDate)
        .eq('actif', true)
        .not('medecin_id', 'is', null);

      // Fetch capacités effectives (secrétaires)
      const { data: capacitesData } = await supabase
        .from('capacite_effective')
        .select('id, date, secretaire_id, site_id, demi_journee, sites(nom)')
        .gte('date', startDate)
        .lte('date', endDate)
        .eq('actif', true)
        .not('secretaire_id', 'is', null);

      // Fetch absences
      const { data: absencesData } = await supabase
        .from('absences')
        .select('id, date_debut, date_fin, demi_journee, medecin_id, secretaire_id, type, motif')
        .or(`date_debut.lte.${endDate},date_fin.gte.${startDate}`)
        .eq('statut', 'approuve');

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

  const handlePrevMonth = () => {
    setCurrentDate(prev => subMonths(prev, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(prev => addMonths(prev, 1));
  };

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

  const getColorForPeriod = (period: 'matin' | 'apres_midi' | 'toute_journee') => {
    if (period === 'toute_journee') return 'bg-primary';
    if (period === 'matin') return 'bg-blue-500';
    return 'bg-orange-500';
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

  const isHoliday = (dateStr: string) => {
    return joursFeries.includes(dateStr);
  };

  // Vue absences par semaine
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

  const getAbsencesForWeek = (weekStart: Date) => {
    const weekEnd = endOfWeek(weekStart, { locale: fr });
    const weekStartStr = formatDate(weekStart);
    const weekEndStr = formatDate(weekEnd);

    const weekAbsences = absences.filter(a => {
      return a.date_debut <= weekEndStr && a.date_fin >= weekStartStr;
    });

    const medecinAbsences = weekAbsences.filter(a => a.medecin_id);
    const secretaireAbsences = weekAbsences.filter(a => a.secretaire_id);

    return {
      medecins: medecinAbsences,
      secretaires: secretaireAbsences,
      totalMedecins: medecinAbsences.length,
      totalSecretaires: secretaireAbsences.length
    };
  };

  const getAbsenceDetails = (absence: Absence) => {
    const days = eachDayOfInterval({
      start: new Date(absence.date_debut),
      end: new Date(absence.date_fin)
    });

    return days.map(d => {
      const dateStr = formatDate(d);
      let periodLabel = '';
      
      if (absence.demi_journee === 'toute_journee') {
        periodLabel = 'Journée complète';
      } else if (absence.demi_journee === 'matin') {
        periodLabel = 'Matin';
      } else {
        periodLabel = 'Après-midi';
      }

      return `${format(d, 'EEEE d MMMM', { locale: fr })} (${periodLabel})`;
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">Calendrier Global</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="calendar" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="calendar">Calendrier</TabsTrigger>
            <TabsTrigger value="absences">Absences</TabsTrigger>
          </TabsList>

          <TabsContent value="calendar" className="space-y-4">
            {/* Navigation mois */}
            <div className="flex items-center justify-between">
              <Button variant="outline" size="sm" onClick={handlePrevMonth}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <h3 className="text-lg font-semibold">
                {format(currentDate, 'MMMM yyyy', { locale: fr })}
              </h3>
              <Button variant="outline" size="sm" onClick={handleNextMonth}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            {loading ? (
              <div className="text-center py-8">Chargement...</div>
            ) : (
              <div className="space-y-6">
                {/* Section Médecins */}
                <div>
                  <h4 className="font-semibold text-lg mb-3 flex items-center gap-2">
                    <Badge variant="outline">Médecins</Badge>
                  </h4>
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-muted">
                        <tr>
                          <th className="sticky left-0 z-10 bg-muted border-r p-2 text-left min-w-[150px]">
                            Médecin
                          </th>
                          {days.map(day => (
                            <th
                              key={day.dateStr}
                              className={cn(
                                "p-1 text-center min-w-[80px] border-l",
                                (isWeekend(day.dateStr) || isHoliday(day.dateStr)) && "bg-muted/50"
                              )}
                            >
                              <div className="font-medium">
                                {format(day.date, 'EEE', { locale: fr })}
                              </div>
                              <div className="text-muted-foreground">
                                {format(day.date, 'd')}
                              </div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {medecins.map(medecin => (
                          <tr key={medecin.id} className="border-t hover:bg-muted/30">
                            <td className="sticky left-0 z-10 bg-background border-r p-2 font-medium">
                              Dr {medecin.first_name} {medecin.name}
                            </td>
                            {days.map(day => {
                              const besoinsDay = getBesoinsForMedecinAndDate(medecin.id, day.dateStr);
                              const absence = getAbsenceForPersonAndDate(medecin.id, day.dateStr, 'medecin');
                              
                              return (
                                <td
                                  key={day.dateStr}
                                  className={cn(
                                    "p-1 text-center border-l",
                                    (isWeekend(day.dateStr) || isHoliday(day.dateStr)) && "bg-muted/20"
                                  )}
                                >
                                  {absence ? (
                                    <div className="bg-red-100 text-red-800 rounded px-1 py-0.5 text-[10px]">
                                      Absent
                                    </div>
                                  ) : (
                                    <div className="space-y-0.5">
                                      {besoinsDay.map(besoin => (
                                        <div
                                          key={besoin.id}
                                          className={cn(
                                            "rounded px-1 py-0.5 text-white text-[10px] truncate",
                                            getColorForPeriod(besoin.demi_journee)
                                          )}
                                          title={`${besoin.sites?.nom} - ${getPeriodLabel(besoin.demi_journee)}`}
                                        >
                                          {besoin.sites?.nom?.substring(0, 8)}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Section Assistants médicaux */}
                <div>
                  <h4 className="font-semibold text-lg mb-3 flex items-center gap-2">
                    <Badge variant="outline">Assistants médicaux</Badge>
                  </h4>
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-muted">
                        <tr>
                          <th className="sticky left-0 z-10 bg-muted border-r p-2 text-left min-w-[150px]">
                            Assistant
                          </th>
                          {days.map(day => (
                            <th
                              key={day.dateStr}
                              className={cn(
                                "p-1 text-center min-w-[80px] border-l",
                                (isWeekend(day.dateStr) || isHoliday(day.dateStr)) && "bg-muted/50"
                              )}
                            >
                              <div className="font-medium">
                                {format(day.date, 'EEE', { locale: fr })}
                              </div>
                              <div className="text-muted-foreground">
                                {format(day.date, 'd')}
                              </div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {secretaires.map(secretaire => (
                          <tr key={secretaire.id} className="border-t hover:bg-muted/30">
                            <td className="sticky left-0 z-10 bg-background border-r p-2 font-medium">
                              {secretaire.first_name} {secretaire.name}
                            </td>
                            {days.map(day => {
                              const capacitesDay = getCapacitesForSecretaireAndDate(secretaire.id, day.dateStr);
                              const absence = getAbsenceForPersonAndDate(secretaire.id, day.dateStr, 'secretaire');
                              
                              return (
                                <td
                                  key={day.dateStr}
                                  className={cn(
                                    "p-1 text-center border-l",
                                    (isWeekend(day.dateStr) || isHoliday(day.dateStr)) && "bg-muted/20"
                                  )}
                                >
                                  {absence ? (
                                    <div className="bg-red-100 text-red-800 rounded px-1 py-0.5 text-[10px]">
                                      Absent
                                    </div>
                                  ) : (
                                    <div className="space-y-0.5">
                                      {capacitesDay.map(capacite => (
                                        <div
                                          key={capacite.id}
                                          className={cn(
                                            "rounded px-1 py-0.5 text-white text-[10px] truncate",
                                            getColorForPeriod(capacite.demi_journee)
                                          )}
                                          title={`${capacite.sites?.nom} - ${getPeriodLabel(capacite.demi_journee)}`}
                                        >
                                          {capacite.sites?.nom?.substring(0, 8)}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Légende */}
                <div className="flex items-center gap-4 text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-primary"></div>
                    <span>Journée complète</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-blue-500"></div>
                    <span>Matin</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-orange-500"></div>
                    <span>Après-midi</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-red-100 border border-red-300"></div>
                    <span>Absence</span>
                  </div>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="absences" className="space-y-4">
            {/* Navigation mois */}
            <div className="flex items-center justify-between">
              <Button variant="outline" size="sm" onClick={handlePrevMonth}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <h3 className="text-lg font-semibold">
                {format(currentDate, 'MMMM yyyy', { locale: fr })}
              </h3>
              <Button variant="outline" size="sm" onClick={handleNextMonth}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            {loading ? (
              <div className="text-center py-8">Chargement...</div>
            ) : (
              <div className="space-y-3">
                {getWeeksInMonth().map((weekStart, idx) => {
                  const weekData = getAbsencesForWeek(weekStart);
                  const weekEnd = endOfWeek(weekStart, { locale: fr });
                  
                  if (weekData.totalMedecins === 0 && weekData.totalSecretaires === 0) {
                    return null;
                  }

                  return (
                    <div key={idx} className="border rounded-lg p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="font-semibold">
                          Semaine du {format(weekStart, 'd MMM', { locale: fr })} au {format(weekEnd, 'd MMM', { locale: fr })}
                        </h4>
                        <div className="flex items-center gap-3 text-sm">
                          <Badge variant="destructive">
                            {weekData.totalMedecins} médecin{weekData.totalMedecins > 1 ? 's' : ''}
                          </Badge>
                          <Badge variant="destructive">
                            {weekData.totalSecretaires} assistant{weekData.totalSecretaires > 1 ? 's' : ''}
                          </Badge>
                        </div>
                      </div>

                      {/* Médecins absents */}
                      {weekData.medecins.length > 0 && (
                        <div>
                          <h5 className="text-sm font-medium mb-2">Médecins</h5>
                          <div className="space-y-2">
                            {weekData.medecins.map(absence => (
                              <HoverCard key={absence.id}>
                                <HoverCardTrigger asChild>
                                  <div className="flex items-center justify-between p-2 bg-red-50 rounded cursor-pointer hover:bg-red-100 transition-colors">
                                    <span className="text-sm">{getPersonName(absence)}</span>
                                    <Badge variant="outline">{absence.type}</Badge>
                                  </div>
                                </HoverCardTrigger>
                                <HoverCardContent className="w-80">
                                  <div className="space-y-2">
                                    <h6 className="font-semibold">{getPersonName(absence)}</h6>
                                    <div className="text-sm space-y-1">
                                      <p className="font-medium">Dates d'absence:</p>
                                      {getAbsenceDetails(absence).map((detail, i) => (
                                        <p key={i} className="text-muted-foreground">• {detail}</p>
                                      ))}
                                    </div>
                                    {absence.motif && (
                                      <div className="text-sm">
                                        <p className="font-medium">Motif:</p>
                                        <p className="text-muted-foreground">{absence.motif}</p>
                                      </div>
                                    )}
                                  </div>
                                </HoverCardContent>
                              </HoverCard>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Assistants absents */}
                      {weekData.secretaires.length > 0 && (
                        <div>
                          <h5 className="text-sm font-medium mb-2">Assistants médicaux</h5>
                          <div className="space-y-2">
                            {weekData.secretaires.map(absence => (
                              <HoverCard key={absence.id}>
                                <HoverCardTrigger asChild>
                                  <div className="flex items-center justify-between p-2 bg-red-50 rounded cursor-pointer hover:bg-red-100 transition-colors">
                                    <span className="text-sm">{getPersonName(absence)}</span>
                                    <Badge variant="outline">{absence.type}</Badge>
                                  </div>
                                </HoverCardTrigger>
                                <HoverCardContent className="w-80">
                                  <div className="space-y-2">
                                    <h6 className="font-semibold">{getPersonName(absence)}</h6>
                                    <div className="text-sm space-y-1">
                                      <p className="font-medium">Dates d'absence:</p>
                                      {getAbsenceDetails(absence).map((detail, i) => (
                                        <p key={i} className="text-muted-foreground">• {detail}</p>
                                      ))}
                                    </div>
                                    {absence.motif && (
                                      <div className="text-sm">
                                        <p className="font-medium">Motif:</p>
                                        <p className="text-muted-foreground">{absence.motif}</p>
                                      </div>
                                    )}
                                  </div>
                                </HoverCardContent>
                              </HoverCard>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {getWeeksInMonth().every(week => {
                  const data = getAbsencesForWeek(week);
                  return data.totalMedecins === 0 && data.totalSecretaires === 0;
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
  );
}
