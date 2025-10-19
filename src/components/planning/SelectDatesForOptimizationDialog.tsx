import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Calendar, Loader2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SelectDatesForOptimizationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  weekDays: Date[];
  onOptimize: (selectedDates: string[], regenerateAll: boolean) => void;
  isOptimizing: boolean;
}

export function SelectDatesForOptimizationDialog({
  open,
  onOpenChange,
  weekDays,
  onOptimize,
  isOptimizing,
}: SelectDatesForOptimizationDialogProps) {
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [selectAll, setSelectAll] = useState(true);
  const [optimizationMode, setOptimizationMode] = useState<'non-validated' | 'all'>('non-validated');

  // Initialiser avec tous les jours (lundi à dimanche) sélectionnés quand le dialog s'ouvre
  useEffect(() => {
    if (open && weekDays.length > 0) {
      setSelectedDates(weekDays.map(d => format(d, 'yyyy-MM-dd')));
      setSelectAll(true);
      setOptimizationMode('non-validated'); // Reset to default mode
    }
  }, [open, weekDays]);

  const handleToggleDate = (date: string) => {
    const newDates = selectedDates.includes(date)
      ? selectedDates.filter(d => d !== date)
      : [...selectedDates, date];
    
    setSelectedDates(newDates);
    
    // Si tous les jours sont sélectionnés, cocher "Toute la semaine"
    if (newDates.length === weekDays.length) {
      setSelectAll(true);
    } else {
      setSelectAll(false);
    }
  };

  const handleSelectAll = (checked: boolean) => {
    setSelectAll(checked);
    if (checked) {
      // Sélectionner tous les jours (lundi à dimanche)
      setSelectedDates(weekDays.map(d => format(d, 'yyyy-MM-dd')));
    } else {
      setSelectedDates([]);
    }
  };

  const handleNext = () => {
    if (selectedDates.length === 0) return;
    onOptimize(selectedDates, optimizationMode === 'all');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Sélectionner les jours à réoptimiser
          </DialogTitle>
          <DialogDescription>
            Choisissez le mode d'optimisation et les jours de la semaine à réoptimiser.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Mode d'optimisation */}
          <div className="space-y-3 pb-4 border-b">
            <Label className="text-sm font-semibold">Mode d'optimisation</Label>
            <RadioGroup 
              value={optimizationMode}
              onValueChange={(value) => setOptimizationMode(value as 'non-validated' | 'all')}
            >
              <div className="flex items-center space-x-2 p-3 rounded-lg border hover:bg-accent transition-colors">
                <RadioGroupItem value="non-validated" id="non-validated" />
                <label htmlFor="non-validated" className="flex-1 cursor-pointer">
                  <div className="text-sm font-medium">
                    Optimiser uniquement les non validées
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Recommandé - Préserve les assignations validées ✓
                  </div>
                </label>
              </div>
              <div className="flex items-center space-x-2 p-3 rounded-lg border hover:bg-accent transition-colors border-destructive/50">
                <RadioGroupItem value="all" id="all" />
                <label htmlFor="all" className="flex-1 cursor-pointer">
                  <div className="text-sm font-medium flex items-center gap-1">
                    <AlertTriangle className="h-4 w-4 text-destructive" />
                    Régénérer tout le planning
                  </div>
                  <div className="text-xs text-destructive">
                    Supprime TOUTES les assignations (validées incluses)
                  </div>
                </label>
              </div>
            </RadioGroup>
          </div>

          {/* Sélection des jours */}
          <div className="flex items-center space-x-2 pb-4 border-b">
            <Checkbox
              id="select-all"
              checked={selectAll}
              onCheckedChange={handleSelectAll}
            />
            <label
              htmlFor="select-all"
              className="text-sm font-medium leading-none cursor-pointer"
            >
              Toute la semaine
            </label>
          </div>

          <div className="space-y-3">
            {weekDays.map((day) => {
                const dateStr = format(day, 'yyyy-MM-dd');
                const isSelected = selectedDates.includes(dateStr);
                const dayOfWeek = day.getDay();
                const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                
                return (
                  <div
                    key={dateStr}
                    className={cn(
                      "flex items-center space-x-2 p-3 rounded-lg border hover:bg-accent transition-colors",
                      isWeekend && "bg-muted/50"
                    )}
                  >
                    <Checkbox
                      id={dateStr}
                      checked={isSelected}
                      onCheckedChange={() => handleToggleDate(dateStr)}
                    />
                    <label
                      htmlFor={dateStr}
                      className="flex-1 text-sm font-medium leading-none cursor-pointer"
                    >
                      {format(day, 'EEEE d MMMM', { locale: fr })}
                      {isWeekend && <span className="ml-2 text-xs text-muted-foreground">(week-end)</span>}
                    </label>
                  </div>
                );
              })}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isOptimizing}
          >
            Annuler
          </Button>
          <Button
            onClick={handleNext}
            disabled={selectedDates.length === 0 || isOptimizing}
          >
            {isOptimizing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Optimisation...
              </>
            ) : (
              <>Suivant ({selectedDates.length} jour{selectedDates.length > 1 ? 's' : ''})</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}