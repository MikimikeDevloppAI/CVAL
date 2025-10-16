import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Calendar, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SelectDatesForOptimizationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  weekDays: Date[];
  onOptimize: (selectedDates: string[]) => Promise<void>;
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

  // Initialiser avec tous les jours (lundi à dimanche) sélectionnés quand le dialog s'ouvre
  useEffect(() => {
    if (open && weekDays.length > 0) {
      setSelectedDates(weekDays.map(d => format(d, 'yyyy-MM-dd')));
      setSelectAll(true);
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

  const handleOptimize = async () => {
    if (selectedDates.length === 0) return;
    await onOptimize(selectedDates);
    onOpenChange(false);
    setSelectedDates([]);
    setSelectAll(true);
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
            Choisissez les jours de la semaine pour lesquels vous souhaitez réoptimiser le planning.
            Le planning sera remis en cours et le PDF supprimé.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">

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
            onClick={handleOptimize}
            disabled={selectedDates.length === 0 || isOptimizing}
          >
            {isOptimizing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Optimisation en cours...
              </>
            ) : (
              `Optimiser ${selectedDates.length} jour${selectedDates.length > 1 ? 's' : ''}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
