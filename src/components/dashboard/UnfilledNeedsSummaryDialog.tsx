import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RefreshCw, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { format, addWeeks, startOfWeek, endOfWeek } from "date-fns";
import { fr } from "date-fns/locale";
import { UnfilledNeedsPanel } from "./UnfilledNeedsPanel";
import { toast } from "sonner";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

interface UnfilledNeedsSummaryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => void;
}

interface WeekData {
  weekStart: string;
  weekEnd: string;
  weekLabel: string;
  totalManque: number;
}

export const UnfilledNeedsSummaryDialog = ({ open, onOpenChange, onRefresh }: UnfilledNeedsSummaryDialogProps) => {
  const [loading, setLoading] = useState(false);
  const [weeks, setWeeks] = useState<WeekData[]>([]);
  const [dateRange, setDateRange] = useState({ start: '', end: '' });

  const fetchUnfilledNeeds = async () => {
    setLoading(true);
    try {
      const today = new Date();
      const fourWeeksLater = addWeeks(today, 4);
      const startDate = format(today, 'yyyy-MM-dd');
      const endDate = format(fourWeeksLater, 'yyyy-MM-dd');

      setDateRange({ start: startDate, end: endDate });

      // Créer 4 semaines à partir d'aujourd'hui
      const weeksData: WeekData[] = [];
      for (let i = 0; i < 4; i++) {
        const weekStart = startOfWeek(addWeeks(today, i), { locale: fr });
        const weekEnd = endOfWeek(addWeeks(today, i), { locale: fr });
        
        // Fetch unfilled needs count for this week
        const { data, error } = await supabase.rpc('get_besoins_non_satisfaits_summary' as any, {
          p_date_debut: format(weekStart, 'yyyy-MM-dd'),
          p_date_fin: format(weekEnd, 'yyyy-MM-dd')
        });

        if (error) throw error;

        const totalManque = Array.isArray(data) 
          ? data.reduce((sum: number, need: any) => sum + (need.total_manque || 0), 0)
          : 0;

        weeksData.push({
          weekStart: format(weekStart, 'yyyy-MM-dd'),
          weekEnd: format(weekEnd, 'yyyy-MM-dd'),
          weekLabel: `Semaine du ${format(weekStart, 'dd MMM', { locale: fr })} au ${format(weekEnd, 'dd MMM', { locale: fr })}`,
          totalManque
        });
      }

      setWeeks(weeksData);
    } catch (error) {
      console.error('Error fetching unfilled needs:', error);
      toast.error('Erreur lors du chargement des besoins non satisfaits');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      fetchUnfilledNeeds();
    }
  }, [open]);

  const handleRefresh = async () => {
    await fetchUnfilledNeeds();
    onRefresh();
    toast.success('Données rafraîchies');
  };

  const totalManques = weeks.reduce((sum, w) => sum + w.totalManque, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-2xl">
            Besoins non satisfaits - 4 prochaines semaines
          </DialogTitle>
          {dateRange.start && (
            <p className="text-sm text-muted-foreground">
              Du {format(new Date(dateRange.start), 'dd MMMM yyyy', { locale: fr })} au{' '}
              {format(new Date(dateRange.end), 'dd MMMM yyyy', { locale: fr })}
              {totalManques > 0 && (
                <span className="ml-2 font-semibold text-destructive">
                  • {totalManques} manque{totalManques > 1 ? 's' : ''} total{totalManques > 1 ? 'aux' : ''}
                </span>
              )}
            </p>
          )}
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground">Chargement...</span>
            </div>
          ) : weeks.length === 0 || totalManques === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Aucun besoin non satisfait sur les 4 prochaines semaines 🎉
            </div>
          ) : (
            <Accordion type="multiple" className="space-y-2">
              {weeks.filter(w => w.totalManque > 0).map((week) => (
                <AccordionItem key={week.weekStart} value={week.weekStart} className="border rounded-lg">
                  <AccordionTrigger className="px-4 hover:no-underline">
                    <div className="flex items-center justify-between w-full pr-4">
                      <span className="font-semibold">{week.weekLabel}</span>
                      <span className="text-sm text-destructive font-medium">
                        {week.totalManque} manque{week.totalManque > 1 ? 's' : ''}
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pb-4">
                    <UnfilledNeedsPanel
                      startDate={week.weekStart}
                      endDate={week.weekEnd}
                      onRefresh={handleRefresh}
                    />
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button onClick={handleRefresh} disabled={loading} variant="outline">
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Rafraîchir
          </Button>
          <Button onClick={() => onOpenChange(false)} variant="default">
            <X className="h-4 w-4 mr-2" />
            Fermer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
