import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Calendar as CalendarIcon, ChevronDown, ChevronUp, Users, Check } from 'lucide-react';
import { format, startOfWeek, endOfWeek, eachDayOfInterval, addWeeks, isSameDay } from 'date-fns';
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

export function OptimizePlanningDialog({ open, onOpenChange }: OptimizePlanningDialogProps) {
  const [selectedDates, setSelectedDates] = useState<Date[]>([]);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [expandedWeeks, setExpandedWeeks] = useState<Set<number>>(new Set());
  const [weeks, setWeeks] = useState<WeekData[]>([]);
  const [flexibleSecretaries, setFlexibleSecretaries] = useState<FlexibleSecretary[]>([]);
  const { toast } = useToast();

  // Generate 12 weeks starting from current week
  useEffect(() => {
    const today = new Date();
    const generatedWeeks: WeekData[] = [];

    for (let i = 0; i < 12; i++) {
      const weekDate = addWeeks(today, i);
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

  // Load flexible secretaries
  useEffect(() => {
    if (open) {
      loadFlexibleSecretaries();
    }
  }, [open]);

  const loadFlexibleSecretaries = async () => {
    try {
      const { data, error } = await supabase
        .from('secretaires')
        .select('id, name, first_name, pourcentage_temps')
        .eq('actif', true)
        .eq('horaire_flexible', true)
        .gt('pourcentage_temps', 0)
        .order('name');

      if (error) throw error;
      setFlexibleSecretaries(data || []);
    } catch (error) {
      console.error('Error loading flexible secretaries:', error);
    }
  };

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
    } else {
      // Select all days of this week
      const newDates = [...selectedDates];
      week.days.forEach(day => {
        if (!newDates.some(d => isSameDay(d, day))) {
          newDates.push(day);
        }
      });
      setSelectedDates(newDates);
    }
  };

  const toggleDay = (day: Date) => {
    const isSelected = selectedDates.some(d => isSameDay(d, day));
    
    if (isSelected) {
      setSelectedDates(prev => prev.filter(d => !isSameDay(d, day)));
    } else {
      setSelectedDates(prev => [...prev, day]);
    }
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

      console.log('🚀 Lancement optimisation MILP v2 pour:', dates);

      const weekStart = dates[0];
      const weekEnd = dates[dates.length - 1];

      console.log('📅 Optimizing flexible secretaries for week:', weekStart, 'to', weekEnd);

      const { data: flexData, error: flexError } = await supabase.functions.invoke('optimize-planning-milp-flexible', {
        body: { 
          week_start: weekStart,
          week_end: weekEnd,
          selected_dates: dates
        }
      });

      if (flexError) {
        console.error('Error optimizing flexible secretaries:', flexError);
      } else {
        console.log('✅ Flexible secretaries optimized:', flexData);
      }

      const { data, error } = await supabase.functions.invoke('optimize-secretary-assignments-v2', {
        body: { dates }
      });

      if (error) throw error;

      if (data.success) {
        toast({
          title: "Planification terminée",
          description: `${data.daily_results?.length || data.results?.length || 0} jour(s) optimisé(s) avec succès.`,
        });
        
        onOpenChange(false);
        setSelectedDates([]);
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
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarIcon className="h-5 w-5" />
            Planifier les secrétaires
          </DialogTitle>
          <DialogDescription>
            Sélectionnez une ou plusieurs semaines pour planifier automatiquement les secrétaires flexibles.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden grid grid-cols-3 gap-6">
          {/* Week Selector - 2 columns */}
          <div className="col-span-2 flex flex-col">
            <div className="mb-4">
              <Label className="text-base font-semibold">Semaines disponibles</Label>
              <p className="text-sm text-muted-foreground">
                Cliquez sur une semaine pour sélectionner tous les jours, puis étendez pour personnaliser
              </p>
            </div>

            <ScrollArea className="flex-1 pr-4">
              <div className="space-y-2">
                {weeks.map((week, index) => {
                  const isExpanded = expandedWeeks.has(index);
                  const isFullySelected = isWeekFullySelected(week);
                  const isPartiallySelected = isWeekPartiallySelected(week);

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

                      {/* Days List */}
                      {isExpanded && (
                        <div className="p-3 pt-0 space-y-1 bg-muted/20">
                          {week.days.map((day, dayIndex) => {
                            const isSelected = selectedDates.some(d => isSameDay(d, day));
                            return (
                              <div
                                key={dayIndex}
                                className={cn(
                                  "flex items-center gap-3 p-2 rounded cursor-pointer transition-colors",
                                  isSelected && "bg-primary/10",
                                  !isSelected && "hover:bg-muted/50"
                                )}
                                onClick={() => toggleDay(day)}
                              >
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={() => toggleDay(day)}
                                  onClick={(e) => e.stopPropagation()}
                                />
                                <span className="text-sm">
                                  {format(day, 'EEEE dd MMMM', { locale: fr })}
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

          {/* Sidebar - 1 column */}
          <div className="flex flex-col gap-4">
            {/* Flexible Secretaries */}
            {flexibleSecretaries.length > 0 && (
              <div className="p-4 bg-muted/50 rounded-lg border">
                <div className="flex items-center gap-2 mb-3">
                  <Users className="h-5 w-5 text-primary" />
                  <h3 className="text-sm font-semibold">Secrétaires flexibles</h3>
                </div>
                <ScrollArea className="max-h-[200px]">
                  <div className="space-y-2">
                    {flexibleSecretaries.map(sec => (
                      <div key={sec.id} className="text-sm flex items-center justify-between p-2 bg-background rounded">
                        <span className="text-xs">{sec.first_name} {sec.name}</span>
                        <span className="text-xs font-medium text-primary">{sec.pourcentage_temps}%</span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            {/* Selected Summary */}
            {selectedDates.length > 0 && (
              <div className="p-4 bg-primary/5 rounded-lg border border-primary/20">
                <p className="text-sm font-semibold mb-2">
                  {selectedDates.length} jour{selectedDates.length > 1 ? 's' : ''} sélectionné{selectedDates.length > 1 ? 's' : ''}
                </p>
                <ScrollArea className="max-h-[200px]">
                  <div className="space-y-1">
                    {selectedDates
                      .sort((a, b) => a.getTime() - b.getTime())
                      .map((date, idx) => (
                        <div
                          key={idx}
                          className="text-xs px-2 py-1 bg-primary/10 text-primary rounded"
                        >
                          {format(date, 'EEE dd/MM', { locale: fr })}
                        </div>
                      ))}
                  </div>
                </ScrollArea>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              setSelectedDates([]);
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
      </DialogContent>
    </Dialog>
  );
}
