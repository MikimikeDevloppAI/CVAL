import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Calendar as CalendarIcon, ChevronDown, ChevronUp, Users } from 'lucide-react';
import { format, startOfWeek, endOfWeek, eachDayOfInterval, addWeeks } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

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

export function OptimizePlanningDialog({ open, onOpenChange }: OptimizePlanningDialogProps) {
  const [selectedDates, setSelectedDates] = useState<Date[]>([]);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [selectedWeek, setSelectedWeek] = useState<Date | null>(null);
  const [flexibleSecretaries, setFlexibleSecretaries] = useState<FlexibleSecretary[]>([]);
  const { toast } = useToast();

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

  // When week is selected, auto-select all days
  const handleWeekSelect = (date: Date | undefined) => {
    if (!date) {
      setSelectedWeek(null);
      setSelectedDates([]);
      return;
    }

    const weekStart = startOfWeek(date, { locale: fr, weekStartsOn: 1 });
    const weekEnd = endOfWeek(date, { locale: fr, weekStartsOn: 1 });
    const daysInWeek = eachDayOfInterval({ start: weekStart, end: weekEnd });

    setSelectedWeek(weekStart);
    setSelectedDates(daysInWeek);
    setIsAdvancedOpen(false);
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
      // Format dates to YYYY-MM-DD
      const dates = selectedDates
        .map(d => format(d, 'yyyy-MM-dd'))
        .sort();

      console.log('🚀 Lancement optimisation MILP v2 pour:', dates);

      // First optimize flexible secretaries
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

      // Then optimize regular assignments
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
        setSelectedWeek(null);
        setIsAdvancedOpen(false);
        
        // Refresh the page to show updated planning
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
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarIcon className="h-5 w-5" />
            Planifier les secrétaires
          </DialogTitle>
          <DialogDescription>
            Sélectionnez une semaine pour planifier automatiquement les secrétaires flexibles et optimiser les assignations.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Week Selector */}
          <div className="space-y-4">
            <div>
              <Label className="text-base font-semibold">Sélection de la semaine</Label>
              <p className="text-sm text-muted-foreground">
                Choisissez une semaine pour sélectionner automatiquement tous les jours
              </p>
            </div>

            <div className="flex justify-center">
              <Calendar
                mode="single"
                selected={selectedWeek || undefined}
                onSelect={handleWeekSelect}
                locale={fr}
                className="rounded-md border"
              />
            </div>
          </div>

          {/* Flexible Secretaries Info */}
          {flexibleSecretaries.length > 0 && (
            <div className="p-4 bg-muted/50 rounded-lg border">
              <div className="flex items-center gap-2 mb-3">
                <Users className="h-5 w-5 text-primary" />
                <h3 className="text-sm font-semibold">Secrétaires flexibles ({flexibleSecretaries.length})</h3>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {flexibleSecretaries.map(sec => (
                  <div key={sec.id} className="text-sm flex items-center justify-between p-2 bg-background rounded">
                    <span>{sec.first_name} {sec.name}</span>
                    <span className="text-xs text-muted-foreground">{sec.pourcentage_temps}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Advanced Day Selection */}
          <Collapsible open={isAdvancedOpen} onOpenChange={setIsAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="w-full flex items-center justify-between">
                <span className="text-sm font-medium">Sélection avancée (jours individuels)</span>
                {isAdvancedOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pt-4">
              <div className="flex justify-center">
                <Calendar
                  mode="multiple"
                  selected={selectedDates}
                  onSelect={(dates) => {
                    setSelectedDates(dates || []);
                    setSelectedWeek(null);
                  }}
                  locale={fr}
                  className="rounded-md border"
                />
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Selected Dates Display */}
          {selectedDates.length > 0 && (
            <div className="p-4 bg-primary/5 rounded-lg border border-primary/20">
              <p className="text-sm font-medium mb-2">
                {selectedWeek 
                  ? `Semaine du ${format(selectedWeek, 'dd MMMM yyyy', { locale: fr })}`
                  : `Dates sélectionnées (${selectedDates.length})`
                }
              </p>
              <div className="flex flex-wrap gap-2">
                {selectedDates
                  .sort((a, b) => a.getTime() - b.getTime())
                  .map((date, idx) => (
                    <span
                      key={idx}
                      className="px-3 py-1.5 bg-primary/10 text-primary rounded-md text-xs font-medium"
                    >
                      {format(date, 'EEE dd/MM', { locale: fr })}
                    </span>
                  ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                onOpenChange(false);
                setSelectedDates([]);
                setSelectedWeek(null);
                setIsAdvancedOpen(false);
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
