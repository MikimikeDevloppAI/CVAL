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
      const startDate = '2025-12-08';
      const fourWeeksLater = addWeeks(new Date(startDate), 4);
      const endDate = format(fourWeeksLater, 'yyyy-MM-dd');

      setDateRange({ start: startDate, end: endDate });

      // Créer 4 semaines à partir du 8 décembre 2025
      const weeksData: WeekData[] = [];
      const baseDate = new Date(startDate);
      for (let i = 0; i < 4; i++) {
        const weekStart = startOfWeek(addWeeks(baseDate, i), { locale: fr });
        const weekEnd = endOfWeek(addWeeks(baseDate, i), { locale: fr });
        const weekStartStr = format(weekStart, 'yyyy-MM-dd');
        const weekEndStr = format(weekEnd, 'yyyy-MM-dd');
        
        // Sommer les déficits depuis les 3 vues séparées (comme dans DashboardPage)
        const [sitesResult, blocResult, fermetureResult] = await Promise.all([
          supabase
            .from('besoins_sites_summary')
            .select('deficit')
            .gte('date', weekStartStr)
            .lte('date', weekEndStr)
            .gt('deficit', 0),
          supabase
            .from('besoins_bloc_operatoire_summary')
            .select('deficit')
            .gte('date', weekStartStr)
            .lte('date', weekEndStr)
            .gt('deficit', 0),
          supabase
            .from('besoins_fermeture_summary')
            .select('deficit')
            .gte('date', weekStartStr)
            .lte('date', weekEndStr)
            .gt('deficit', 0)
        ]);

        if (sitesResult.error) throw sitesResult.error;
        if (blocResult.error) throw blocResult.error;
        if (fermetureResult.error) throw fermetureResult.error;

        const sitesDeficit = sitesResult.data?.reduce((sum, row) => sum + (row.deficit || 0), 0) || 0;
        const blocDeficit = blocResult.data?.reduce((sum, row) => sum + (row.deficit || 0), 0) || 0;
        const fermetureDeficit = fermetureResult.data?.reduce((sum, row) => sum + (row.deficit || 0), 0) || 0;
        const totalManque = sitesDeficit + blocDeficit + fermetureDeficit;

        weeksData.push({
          weekStart: weekStartStr,
          weekEnd: weekEndStr,
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
                  • {totalManques}
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
                      isOpen={true}
                    />
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button onClick={() => onOpenChange(false)} variant="default">
            <X className="h-4 w-4 mr-2" />
            Fermer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
