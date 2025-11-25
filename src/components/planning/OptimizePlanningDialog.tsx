import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Calendar as CalendarIcon, ChevronDown, ChevronUp, Users, Check } from 'lucide-react';
import { format, startOfWeek, endOfWeek, eachDayOfInterval, addWeeks, isSameDay, isWithinInterval } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface OptimizePlanningDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface FlexibleSecretary {
  id: string;
  name: string;
  first_name: string;
  pourcentage_temps: number;
}

interface WeekData {
  weekStart: Date;
  weekEnd: Date;
  days: Date[];
  label: string;
}

interface Absence {
  secretaire_id: string;
  date_debut: string;
  date_fin: string;
  demi_journee?: string;
}

interface Holiday {
  date: string;
}

export function OptimizePlanningDialog({ open, onOpenChange }: OptimizePlanningDialogProps) {
  const [selectedDates, setSelectedDates] = useState<Date[]>([]);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [expandedWeeks, setExpandedWeeks] = useState<Set<number>>(new Set());
  const [weeks, setWeeks] = useState<WeekData[]>([]);
  const [flexibleSecretaries, setFlexibleSecretaries] = useState<FlexibleSecretary[]>([]);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [capacities, setCapacities] = useState<any[]>([]);
  
  // Map<weekIndex, Map<secretaireId, joursRequis>>
  const [weekAssignments, setWeekAssignments] = useState<Map<number, Map<string, number>>>(new Map());
  
  const { toast } = useToast();

  // Generate 52 weeks starting from max(today, Dec 8 2025)
  useEffect(() => {
    const today = new Date();
    const dec8_2025 = new Date('2025-12-08');
    const startDate = today > dec8_2025 ? today : dec8_2025;
    
    const generatedWeeks: WeekData[] = [];

    for (let i = 0; i < 52; i++) {
      const weekDate = addWeeks(startDate, i);
      const weekStart = startOfWeek(weekDate, { locale: fr, weekStartsOn: 1 });
      const weekEnd = endOfWeek(weekDate, { locale: fr, weekStartsOn: 1 });
      const days = eachDayOfInterval({ start: weekStart, end: weekEnd });

      generatedWeeks.push({
        weekStart,
        weekEnd,
        days,
        label: `Semaine du ${format(weekStart, 'dd MMM', { locale: fr })} au ${format(weekEnd, 'dd MMM yyyy', { locale: fr })}`
      });
    }

    setWeeks(generatedWeeks);
  }, []);

  // Load data when dialog opens
  useEffect(() => {
    if (open) {
      loadData();
    }
  }, [open]);

  // Auto-update weekAssignments when selectedDates change
  useEffect(() => {
    if (flexibleSecretaries.length === 0 || weeks.length === 0) return;

    const newWeekAssignments = new Map<number, Map<string, number>>();

    weeks.forEach((week, weekIndex) => {
      const hasSelectedDays = week.days.some(day => 
        selectedDates.some(selected => isSameDay(selected, day))
      );

      if (hasSelectedDays) {
        const weekAssignmentsMap = new Map<string, number>();
        flexibleSecretaries.forEach(sec => {
          const suggestedDays = calculateSuggestedDays(sec, week);
          weekAssignmentsMap.set(sec.id, suggestedDays);
        });
        newWeekAssignments.set(weekIndex, weekAssignmentsMap);
      }
    });

    setWeekAssignments(newWeekAssignments);
  }, [selectedDates, flexibleSecretaries, capacities, holidays, absences]);

  const loadData = async () => {
    try {
      // Load flexible secretaries
      const { data: secData, error: secError } = await supabase
        .from('secretaires')
        .select('id, name, first_name, pourcentage_temps')
        .eq('actif', true)
        .eq('horaire_flexible', true)
        .gt('pourcentage_temps', 0)
        .order('name');

      if (secError) throw secError;
      setFlexibleSecretaries(secData || []);

      // Load absences for flexible secretaries
      if (secData && secData.length > 0) {
        const { data: absData, error: absError } = await supabase
          .from('absences')
          .select('secretaire_id, date_debut, date_fin, demi_journee')
          .in('secretaire_id', secData.map(s => s.id))
          .eq('type_personne', 'secretaire')
          .in('statut', ['approuve', 'en_attente']);

        if (absError) throw absError;
        setAbsences(absData || []);
      }

      // Load holidays
      const { data: holData, error: holError } = await supabase
        .from('jours_feries')
        .select('date')
        .eq('actif', true);

      if (holError) throw holError;
      setHolidays(holData || []);

      // Load existing capacities for flexible secretaries
      if (secData && secData.length > 0) {
        const { data: capData, error: capError } = await supabase
          .from('capacite_effective')
          .select('secretaire_id, date, demi_journee, actif, site_id')
          .in('secretaire_id', secData.map(s => s.id))
          .eq('actif', true);

        if (capError) throw capError;
        setCapacities(capData || []);
      }

    } catch (error) {
      console.error('Error loading data:', error);
    }
  };

  // Calculate available days for a secretary in a specific week
  const calculateAvailableDays = (secretary: FlexibleSecretary, week: WeekData): number => {
    const weekDays = week.days.filter(day => {
      const dayOfWeek = day.getDay();
      return dayOfWeek !== 0 && dayOfWeek !== 6; // Only weekdays
    });

    // Use a Set to track unique unavailable days (holiday OR absence)
    const unavailableDays = new Set<string>();

    // Add holidays to unavailable days
    weekDays.forEach(day => {
      const dateStr = format(day, 'yyyy-MM-dd');
      if (holidays.some(h => h.date === dateStr)) {
        unavailableDays.add(dateStr);
      }
    });

    // Add absences to unavailable days (will not double-count if already a holiday)
    const secAbsences = absences.filter(a => a.secretaire_id === secretary.id);
    
    weekDays.forEach(day => {
      const dateStr = format(day, 'yyyy-MM-dd');
      
      for (const absence of secAbsences) {
        // Use date strings for comparison to avoid timezone issues
        if (dateStr >= absence.date_debut && dateStr <= absence.date_fin) {
          // Check if it's a full day absence or toute_journee
          if (!absence.demi_journee || absence.demi_journee === 'toute_journee') {
            // Full day absence - add to set (no double counting)
            unavailableDays.add(dateStr);
            break;
          }
          // If demi_journee is 'matin' or 'apres_midi', it's a partial day
          // For simplicity, we don't count partial absences as unavailable
          // The MILP will handle the detailed assignment
        }
      }
    });

    return Math.max(0, weekDays.length - unavailableDays.size);
  };

  // Get detailed information for a secretary in a week
  const getSecretaryWeekDetails = (secretary: FlexibleSecretary, week: WeekData) => {
    const weekDays = week.days.filter(day => {
      const dayOfWeek = day.getDay();
      return dayOfWeek !== 0 && dayOfWeek !== 6; // Only weekdays
    });

    let holidaysCount = 0;
    let absencesCount = 0;
    let daysWorkedOutsideSelection = 0;
    const holidayDates: string[] = [];
    const absenceDates: string[] = [];

    const selectedInWeek = weekDays.filter(day => 
      selectedDates.some(selected => isSameDay(selected, day))
    );
    const nonSelectedInWeek = weekDays.filter(day => 
      !selectedDates.some(selected => isSameDay(selected, day))
    );

    // Count holidays
    weekDays.forEach(day => {
      const dateStr = format(day, 'yyyy-MM-dd');
      if (holidays.some(h => h.date === dateStr)) {
        holidaysCount++;
        holidayDates.push(format(day, 'dd/MM'));
      }
    });

    // Count absences (full-day only)
    const secAbsences = absences.filter(a => a.secretaire_id === secretary.id);
    weekDays.forEach(day => {
      const dateStr = format(day, 'yyyy-MM-dd');
      
      for (const absence of secAbsences) {
        // Use date strings for comparison to avoid timezone issues
        if (dateStr >= absence.date_debut && dateStr <= absence.date_fin) {
          // Check if it's a full day absence or toute_journee
          if (!absence.demi_journee || absence.demi_journee === 'toute_journee') {
            absencesCount++;
            absenceDates.push(format(day, 'dd/MM'));
            break;
          }
          // If demi_journee is 'matin' or 'apres_midi', it's a partial day
          // For simplicité, on ne compte pas les demi-journées ici
        }
      }
    });

    // Count days worked outside selection (full days)
    for (const day of nonSelectedInWeek) {
      const dateStr = format(day, 'yyyy-MM-dd');
      const hasMatin = capacities.some(
        cap => cap.secretaire_id === secretary.id && 
               cap.date === dateStr && 
               cap.demi_journee === 'matin' &&
               cap.actif
      );
      const hasApresMidi = capacities.some(
        cap => cap.secretaire_id === secretary.id && 
               cap.date === dateStr && 
               cap.demi_journee === 'apres_midi' &&
               cap.actif
      );
      
      if (hasMatin && hasApresMidi) {
        daysWorkedOutsideSelection++;
      }
    }

    return {
      holidaysCount,
      absencesCount,
      daysWorkedOutsideSelection,
      hasPartialSelection: selectedInWeek.length > 0 && selectedInWeek.length < weekDays.length,
      holidayDates,
      absenceDates,
    };
  };
  // Calculate suggested days for a secretary in a week
  const calculateSuggestedDays = (secretary: FlexibleSecretary, week: WeekData): number => {
    const weekDays = week.days.filter(day => {
      const dayOfWeek = day.getDay();
      return dayOfWeek !== 0 && dayOfWeek !== 6; // Only weekdays
    });

    // Use a Set to track unique unavailable days (holiday OR absence)
    const unavailableDays = new Set<string>();

    // Add holidays to unavailable days
    weekDays.forEach(day => {
      const dateStr = format(day, 'yyyy-MM-dd');
      if (holidays.some(h => h.date === dateStr)) {
        unavailableDays.add(dateStr);
      }
    });

    // Add absences to unavailable days (will not double-count if already a holiday)
    const secAbsences = absences.filter(a => a.secretaire_id === secretary.id);
    
    weekDays.forEach(day => {
      const dateStr = format(day, 'yyyy-MM-dd');
      
      for (const absence of secAbsences) {
        // Use date strings for comparison to avoid timezone issues
        if (dateStr >= absence.date_debut && dateStr <= absence.date_fin) {
          // Check if it's a full day absence or toute_journee
          if (!absence.demi_journee || absence.demi_journee === 'toute_journee') {
            // Full day absence - add to set (no double counting)
            unavailableDays.add(dateStr);
            break;
          }
        }
      }
    });

    // Formula: taux_activité * (5 - jours_indisponibles)
    const joursDisponibles = Math.max(0, 5 - unavailableDays.size);
    const joursRequis = Math.max(0, Math.round((secretary.pourcentage_temps / 100) * joursDisponibles));
    
    if (joursDisponibles === 0) {
      return 0;
    }

    // Check if this is a partial week selection
    const selectedInWeek = weekDays.filter(day => 
      selectedDates.some(selected => isSameDay(selected, day))
    );
    const nonSelectedInWeek = weekDays.filter(day => 
      !selectedDates.some(selected => isSameDay(selected, day))
    );

    // If partial week, count existing capacities on non-selected days
    if (selectedInWeek.length > 0 && selectedInWeek.length < weekDays.length) {
      // Count full days already worked on non-selected days
      let daysAlreadyWorked = 0;
      
      for (const day of nonSelectedInWeek) {
        const dateStr = format(day, 'yyyy-MM-dd');
        const hasMatin = capacities.some(
          cap => cap.secretaire_id === secretary.id && 
                 cap.date === dateStr && 
                 cap.demi_journee === 'matin' &&
                 cap.actif
        );
        const hasApresMidi = capacities.some(
          cap => cap.secretaire_id === secretary.id && 
                 cap.date === dateStr && 
                 cap.demi_journee === 'apres_midi' &&
                 cap.actif
        );
        
        // Count as full day if both periods are present
        if (hasMatin && hasApresMidi) {
          daysAlreadyWorked++;
        }
      }
      
      // Suggest: max(0, min(joursRequis - daysAlreadyWorked, joursDisponibles))
      const result = Math.max(0, Math.min(joursRequis - daysAlreadyWorked, joursDisponibles));
      return result;
    }
    
    // Full week selection: return joursRequis
    return joursRequis;
  };

  // When a week is toggled, calculate assignments for all secretaries
  const toggleWeek = (weekIndex: number) => {
    const week = weeks[weekIndex];
    const allSelected = week.days.every(day => 
      selectedDates.some(selected => isSameDay(selected, day))
    );

    if (allSelected) {
      // Deselect all days of this week
      setSelectedDates(prev => 
        prev.filter(date => !week.days.some(day => isSameDay(day, date)))
      );
      
      // Remove assignments for this week
      setWeekAssignments(prev => {
        const newMap = new Map(prev);
        newMap.delete(weekIndex);
        return newMap;
      });
    } else {
      // Select all days of this week
      const newDates = [...selectedDates];
      week.days.forEach(day => {
        if (!newDates.some(d => isSameDay(d, day))) {
          newDates.push(day);
        }
      });
      setSelectedDates(newDates);

      // Calculate assignments for this week
      const weekAssignmentsMap = new Map<string, number>();
      flexibleSecretaries.forEach(sec => {
        const suggestedDays = calculateSuggestedDays(sec, week);
        weekAssignmentsMap.set(sec.id, suggestedDays);
      });

      setWeekAssignments(prev => {
        const newMap = new Map(prev);
        newMap.set(weekIndex, weekAssignmentsMap);
        return newMap;
      });
    }
  };

  const toggleDay = (day: Date, weekIndex: number) => {
    const isSelected = selectedDates.some(d => isSameDay(d, day));
    
    if (isSelected) {
      setSelectedDates(prev => prev.filter(d => !isSameDay(d, day)));
    } else {
      setSelectedDates(prev => [...prev, day]);
    }
    
    // Recalculate assignments for affected week
    const week = weeks[weekIndex];
    const weekAssignmentsMap = new Map<string, number>();
    flexibleSecretaries.forEach(sec => {
      const suggestedDays = calculateSuggestedDays(sec, week);
      weekAssignmentsMap.set(sec.id, suggestedDays);
    });

    setWeekAssignments(prev => {
      const newMap = new Map(prev);
      newMap.set(weekIndex, weekAssignmentsMap);
      return newMap;
    });
  };

  const toggleWeekExpanded = (weekIndex: number) => {
    setExpandedWeeks(prev => {
      const newSet = new Set(prev);
      if (newSet.has(weekIndex)) {
        newSet.delete(weekIndex);
      } else {
        newSet.add(weekIndex);
      }
      return newSet;
    });
  };

  const updateSecretaryDays = (weekIndex: number, secretaireId: string, days: number) => {
    setWeekAssignments(prev => {
      const newMap = new Map(prev);
      const weekMap = newMap.get(weekIndex) || new Map();
      weekMap.set(secretaireId, days);
      newMap.set(weekIndex, weekMap);
      return newMap;
    });
  };

  const isWeekFullySelected = (week: WeekData) => {
    return week.days.every(day => 
      selectedDates.some(selected => isSameDay(selected, day))
    );
  };

  const isWeekPartiallySelected = (week: WeekData) => {
    const selectedCount = week.days.filter(day => 
      selectedDates.some(selected => isSameDay(selected, day))
    ).length;
    return selectedCount > 0 && selectedCount < week.days.length;
  };

  const handleOptimize = async () => {
    if (selectedDates.length === 0) {
      toast({
        title: "Aucune date sélectionnée",
        description: "Veuillez sélectionner au moins une date à planifier.",
        variant: "destructive"
      });
      return;
    }

    setIsOptimizing(true);

    try {
      const dates = selectedDates
        .map(d => format(d, 'yyyy-MM-dd'))
        .sort();

      // Prepare secretary assignments by combining all weeks
      const allAssignments = new Map<string, number>();
      
      for (const [weekIndex, weekMap] of weekAssignments.entries()) {
        for (const [secId, days] of weekMap.entries()) {
          const current = allAssignments.get(secId) || 0;
          allAssignments.set(secId, current + days);
        }
      }

      const secretaryAssignmentsArray = Array.from(allAssignments.entries()).map(([id, days]) => ({
        secretaire_id: id,
        jours_requis: days
      }));

      const weekStart = dates[0];
      const weekEnd = dates[dates.length - 1];

      const { data: flexData, error: flexError } = await supabase.functions.invoke('optimize-planning-milp-flexible', {
        body: { 
          week_start: weekStart,
          week_end: weekEnd,
          selected_dates: dates,
          secretary_assignments: secretaryAssignmentsArray
        }
      });

      if (flexError) {
        console.error('Error optimizing flexible secretaries:', flexError);
      }

      const { data, error } = await supabase.functions.invoke('optimize-secretary-assignments-v2', {
        body: { 
          dates,
          useWeeklyOptimization: true  // 🆕 Active l'optimisation hebdomadaire globale
        }
      });

      if (error) throw error;

      if (data.success) {
        toast({
          title: "Planification terminée",
          description: `${data.daily_results?.length || data.results?.length || 0} jour(s) optimisé(s) avec succès.`,
        });
        
        // Rafraîchir les vues matérialisées
        const { error: refreshError } = await supabase.functions.invoke('refresh-besoins-view');
        if (refreshError) {
          console.error('⚠️ Erreur lors du refresh des vues:', refreshError);
        }
        
        onOpenChange(false);
        setSelectedDates([]);
        setWeekAssignments(new Map());
        setExpandedWeeks(new Set());
        
        setTimeout(() => window.location.reload(), 1000);
      } else {
        throw new Error('Échec de l\'optimisation');
      }
    } catch (error: any) {
      console.error('Erreur optimisation:', error);
      toast({
        title: "Erreur lors de la planification",
        description: error.message || "Une erreur est survenue",
        variant: "destructive"
      });
    } finally {
      setIsOptimizing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarIcon className="h-5 w-5" />
            Planifier les secrétaires
          </DialogTitle>
          <DialogDescription>
            Sélectionnez une ou plusieurs semaines et configurez les assignations des secrétaires flexibles.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden">
          <ScrollArea className="h-[600px] pr-4">
            <div className="space-y-2">
              {weeks.map((week, index) => {
                const isExpanded = expandedWeeks.has(index);
                const isFullySelected = isWeekFullySelected(week);
                const isPartiallySelected = isWeekPartiallySelected(week);
                const weekAssignmentsForWeek = weekAssignments.get(index);

                return (
                  <div key={index} className="border rounded-lg overflow-hidden">
                    {/* Week Header */}
                    <div
                      className={cn(
                        "flex items-center justify-between p-3 cursor-pointer transition-colors",
                        isFullySelected && "bg-primary/10 border-l-4 border-l-primary",
                        isPartiallySelected && "bg-primary/5 border-l-4 border-l-primary/50",
                        !isFullySelected && !isPartiallySelected && "hover:bg-muted/50"
                      )}
                      onClick={() => toggleWeek(index)}
                    >
                      <div className="flex items-center gap-3 flex-1">
                        <div className={cn(
                          "h-5 w-5 rounded border-2 flex items-center justify-center",
                          isFullySelected && "bg-primary border-primary",
                          isPartiallySelected && "bg-primary/50 border-primary/50"
                        )}>
                          {isFullySelected && <Check className="h-3 w-3 text-white" />}
                          {isPartiallySelected && <span className="text-white text-xs">−</span>}
                        </div>
                        <span className="text-sm font-medium">{week.label}</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleWeekExpanded(index);
                        }}
                      >
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </Button>
                    </div>

                    {/* Flexible Secretaries for this week */}
                    {(isFullySelected || isPartiallySelected) && weekAssignmentsForWeek && (
                      <div className="px-3 pb-3 bg-muted/10 border-t">
                        <div className="flex items-center gap-2 py-2">
                          <Users className="h-4 w-4 text-primary" />
                          <span className="text-xs font-semibold text-muted-foreground">Secrétaires flexibles</span>
                        </div>
                        <div className="space-y-2">
                           {flexibleSecretaries.map(sec => {
                            const assignedDays = weekAssignmentsForWeek.get(sec.id) || 0;
                            const availableDays = calculateAvailableDays(sec, week);
                            const suggestedDays = calculateSuggestedDays(sec, week);
                            const details = getSecretaryWeekDetails(sec, week);

                            return (
                              <div key={sec.id} className="p-2 bg-background rounded border text-xs space-y-1">
                                <div className="flex items-center justify-between">
                                  <span className="font-medium">
                                    {sec.first_name} {sec.name}
                                  </span>
                                  <span className="text-muted-foreground text-[10px]">
                                    {details.holidaysCount > 0 && `${details.holidaysCount}j férié (${details.holidayDates.join(', ')}) • `}
                                    {details.absencesCount > 0 && `${details.absencesCount}j congé (${details.absenceDates.join(', ')}) • `}
                                    {details.hasPartialSelection && details.daysWorkedOutsideSelection > 0 && 
                                      `${details.daysWorkedOutsideSelection}j déjà • `}
                                    {availableDays}j dispo
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Label htmlFor={`days-${index}-${sec.id}`} className="text-xs text-muted-foreground whitespace-nowrap">
                                    Jours:
                                  </Label>
                                  <input
                                    id={`days-${index}-${sec.id}`}
                                    type="number"
                                    min="0"
                                    max={availableDays}
                                    value={assignedDays}
                                    onChange={(e) => updateSecretaryDays(index, sec.id, parseInt(e.target.value) || 0)}
                                    className="flex-1 h-7 px-2 text-xs border rounded focus:outline-none focus:ring-2 focus:ring-primary/50"
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                  {assignedDays !== suggestedDays && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 text-xs"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        updateSecretaryDays(index, sec.id, suggestedDays);
                                      }}
                                    >
                                      Suggéré: {suggestedDays}
                                    </Button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Days List (expandable) */}
                    {isExpanded && (
                      <div className="p-3 pt-0 space-y-1 bg-muted/20">
                        {week.days.map((day, dayIndex) => {
                          const isSelected = selectedDates.some(d => isSameDay(d, day));
                          const dateStr = format(day, 'yyyy-MM-dd');
                          const isHoliday = holidays.some(h => h.date === dateStr);
                          
                          return (
                            <div
                              key={dayIndex}
                              className={cn(
                                "flex items-center gap-3 p-2 rounded cursor-pointer transition-colors",
                                isSelected && "bg-primary/10",
                                !isSelected && "hover:bg-muted/50"
                              )}
                              onClick={() => toggleDay(day, index)}
                            >
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() => toggleDay(day, index)}
                                onClick={(e) => e.stopPropagation()}
                              />
                              <span className="text-sm">
                                {format(day, 'EEEE dd MMMM', { locale: fr })}
                                {isHoliday && <span className="ml-2 text-xs text-muted-foreground">(férié)</span>}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </div>

        <div className="flex justify-between items-center pt-4 border-t">
          <div className="text-sm text-muted-foreground">
            {selectedDates.length} jour{selectedDates.length > 1 ? 's' : ''} sélectionné{selectedDates.length > 1 ? 's' : ''}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                onOpenChange(false);
                setSelectedDates([]);
                setWeekAssignments(new Map());
                setExpandedWeeks(new Set());
              }}
              disabled={isOptimizing}
            >
              Annuler
            </Button>
            <Button
              onClick={handleOptimize}
              disabled={isOptimizing || selectedDates.length === 0}
            >
              {isOptimizing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Optimisation en cours...
                </>
              ) : (
                <>
                  <CalendarIcon className="h-4 w-4" />
                  Planifier
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
