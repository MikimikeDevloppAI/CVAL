import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Calendar as CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface OptimizePlanningDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function OptimizePlanningDialog({ open, onOpenChange }: OptimizePlanningDialogProps) {
  const [selectedDates, setSelectedDates] = useState<Date[]>([]);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const { toast } = useToast();

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
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarIcon className="h-5 w-5" />
            Planifier les secrétaires
          </DialogTitle>
          <DialogDescription>
            Sélectionnez les dates pour lesquelles vous souhaitez générer automatiquement la planification.
            L'algorithme MILP va optimiser l'assignation des secrétaires en fonction des besoins et des préférences.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="flex justify-center">
            <Calendar
              mode="multiple"
              selected={selectedDates}
              onSelect={(dates) => setSelectedDates(dates || [])}
              locale={fr}
              className="rounded-md border pointer-events-auto"
            />
          </div>

          {selectedDates.length > 0 && (
            <div className="p-4 bg-muted rounded-lg">
              <p className="text-sm font-medium mb-2">
                Dates sélectionnées ({selectedDates.length}) :
              </p>
              <div className="flex flex-wrap gap-2">
                {selectedDates
                  .sort((a, b) => a.getTime() - b.getTime())
                  .map((date, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-1 bg-primary/10 text-primary rounded text-xs font-medium"
                    >
                      {format(date, 'dd/MM/yyyy', { locale: fr })}
                    </span>
                  ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
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
