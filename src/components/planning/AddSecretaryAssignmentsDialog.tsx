import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Loader2 } from 'lucide-react';

interface AddSecretaryAssignmentsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  secretaryId: string;
  secretaryName: string;
  startDate: Date;
  endDate: Date;
  existingAssignments: Array<{ dateStr: string; periode: 'matin' | 'apres_midi' }>;
  onSuccess: () => void;
}

interface AvailablePeriod {
  date: string;
  dateFormatted: string;
  periode: 'matin' | 'apres_midi';
  periodeLabel: string;
}

export function AddSecretaryAssignmentsDialog({
  open,
  onOpenChange,
  secretaryId,
  secretaryName,
  startDate,
  endDate,
  existingAssignments,
  onSuccess,
}: AddSecretaryAssignmentsDialogProps) {
  const [loading, setLoading] = useState(false);
  const [sites, setSites] = useState<Array<{ id: string; nom: string }>>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string>('');
  const [availablePeriods, setAvailablePeriods] = useState<AvailablePeriod[]>([]);
  const [selectedPeriods, setSelectedPeriods] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      fetchSites();
      generateAvailablePeriods();
    }
  }, [open, startDate, endDate, existingAssignments]);

  const fetchSites = async () => {
    try {
      // Get only sites assigned to this secretary
      const { data: secretarySites, error: ssError } = await supabase
        .from('secretaires_sites')
        .select(`
          sites!inner (
            id,
            nom,
            actif
          )
        `)
        .eq('secretaire_id', secretaryId);

      if (ssError) throw ssError;

      // Filter only active sites and extract them
      const activeSites = (secretarySites || [])
        .filter((ss: any) => ss.sites?.actif)
        .map((ss: any) => ss.sites)
        .sort((a: any, b: any) => a.nom.localeCompare(b.nom, 'fr'));

      setSites(activeSites);
    } catch (error) {
      console.error('Error fetching sites:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible de charger les sites',
        variant: 'destructive',
      });
    }
  };

  const generateAvailablePeriods = () => {
    const periods: AvailablePeriod[] = [];
    const existingSet = new Set(
      existingAssignments.map(a => `${a.dateStr}_${a.periode}`)
    );

    let currentDate = new Date(startDate);
    const endDateTime = new Date(endDate);

    while (currentDate <= endDateTime) {
      const dayOfWeek = currentDate.getDay();
      // Skip weekends
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        const dateStr = format(currentDate, 'yyyy-MM-dd');
        const dateFormatted = format(currentDate, 'EEEE d MMM', { locale: fr });

        // Check morning
        if (!existingSet.has(`${dateStr}_matin`)) {
          periods.push({
            date: dateStr,
            dateFormatted,
            periode: 'matin',
            periodeLabel: 'Matin',
          });
        }

        // Check afternoon
        if (!existingSet.has(`${dateStr}_apres_midi`)) {
          periods.push({
            date: dateStr,
            dateFormatted,
            periode: 'apres_midi',
            periodeLabel: 'Après-midi',
          });
        }
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }

    setAvailablePeriods(periods);
  };

  const togglePeriod = (key: string) => {
    setSelectedPeriods(prev => {
      const newSet = new Set(prev);
      if (newSet.has(key)) {
        newSet.delete(key);
      } else {
        newSet.add(key);
      }
      return newSet;
    });
  };

  const handleSubmit = async () => {
    if (!selectedSiteId) {
      toast({
        title: 'Erreur',
        description: 'Veuillez sélectionner un site',
        variant: 'destructive',
      });
      return;
    }

    if (selectedPeriods.size === 0) {
      toast({
        title: 'Erreur',
        description: 'Veuillez sélectionner au moins une période',
        variant: 'destructive',
      });
      return;
    }

    try {
      setLoading(true);

      // Prepare assignments
      const assignments = Array.from(selectedPeriods).map(key => {
        const [date, periode] = key.split('_');
        return {
          date,
          periode: periode as 'matin' | 'apres_midi',
          secretaire_id: secretaryId,
          site_id: selectedSiteId,
          type_assignation: 'site',
          is_1r: false,
          is_2f: false,
          is_3f: false,
          ordre: 1,
        };
      });

      const { error } = await supabase
        .from('planning_genere_personnel')
        .insert(assignments);

      if (error) throw error;

      toast({
        title: 'Succès',
        description: `${assignments.length} assignation(s) ajoutée(s) avec succès`,
      });

      onSuccess();
      onOpenChange(false);
    } catch (error) {
      console.error('Error adding assignments:', error);
      toast({
        title: 'Erreur',
        description: "Impossible d'ajouter les assignations",
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  // Group by date for better display
  const groupedPeriods = availablePeriods.reduce((acc, period) => {
    if (!acc[period.date]) {
      acc[period.date] = {
        dateFormatted: period.dateFormatted,
        periods: [],
      };
    }
    acc[period.date].periods.push(period);
    return acc;
  }, {} as Record<string, { dateFormatted: string; periods: AvailablePeriod[] }>);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ajouter des assignations - {secretaryName}</DialogTitle>
          <DialogDescription>
            Sélectionnez les périodes et le site pour ajouter des assignations
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Site selection */}
          <div className="space-y-2">
            <Label htmlFor="site">Site</Label>
            <Select value={selectedSiteId} onValueChange={setSelectedSiteId}>
              <SelectTrigger id="site">
                <SelectValue placeholder="Sélectionner un site" />
              </SelectTrigger>
              <SelectContent>
                {sites.map(site => (
                  <SelectItem key={site.id} value={site.id}>
                    {site.nom}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Period selection */}
          <div className="space-y-2">
            <Label>Périodes disponibles</Label>
            {availablePeriods.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aucune période disponible pour cette semaine
              </p>
            ) : (
              <div className="border rounded-lg divide-y max-h-96 overflow-y-auto">
                {Object.entries(groupedPeriods).map(([date, { dateFormatted, periods }]) => (
                  <div key={date} className="p-3">
                    <div className="font-medium text-sm mb-2">{dateFormatted}</div>
                    <div className="space-y-2">
                      {periods.map(period => {
                        const key = `${period.date}_${period.periode}`;
                        return (
                          <div key={key} className="flex items-center space-x-2">
                            <Checkbox
                              id={key}
                              checked={selectedPeriods.has(key)}
                              onCheckedChange={() => togglePeriod(key)}
                            />
                            <Label
                              htmlFor={key}
                              className="text-sm font-normal cursor-pointer"
                            >
                              {period.periodeLabel}
                            </Label>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {selectedPeriods.size > 0 && (
            <p className="text-sm text-muted-foreground">
              {selectedPeriods.size} période(s) sélectionnée(s)
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button onClick={handleSubmit} disabled={loading || selectedPeriods.size === 0}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Ajouter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
