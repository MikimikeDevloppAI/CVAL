import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Calendar as CalendarIconComponent, MapPin } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { checkSecretaireOverlap, getOverlapErrorMessage } from '@/lib/overlapValidation';

const multipleCreneauxSchema = z.object({
  site_id: z.string().optional(),
  demi_journee: z.enum(['matin', 'apres_midi', 'toute_journee']),
});

interface AddMultipleCreneauxDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  secretaireId: string;
  onSuccess?: () => void;
}

interface Site {
  id: string;
  nom: string;
}

export function AddMultipleCreneauxDialog({
  open,
  onOpenChange,
  secretaireId,
  onSuccess,
}: AddMultipleCreneauxDialogProps) {
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDates, setSelectedDates] = useState<Date[]>([]);
  const [adminSiteId, setAdminSiteId] = useState<string>('');

  const form = useForm<z.infer<typeof multipleCreneauxSchema>>({
    resolver: zodResolver(multipleCreneauxSchema),
    defaultValues: {
      site_id: '',
      demi_journee: 'toute_journee',
    },
  });

  useEffect(() => {
    if (open) {
      fetchData();
      setSelectedDates([]);
      form.reset();
    }
  }, [open]);

  const fetchData = async () => {
    const { data: sitesData } = await supabase
      .from('sites')
      .select('id, nom')
      .eq('actif', true)
      .order('nom');

    if (sitesData) setSites(sitesData);

    // Fetch administratif site as default
    const { data: adminSite } = await supabase
      .from('sites')
      .select('id')
      .ilike('nom', '%administratif%')
      .single();

    if (adminSite) setAdminSiteId(adminSite.id);
  };

  const handleDateSelect = (date: Date | undefined) => {
    if (!date) return;

    setSelectedDates((prev) => {
      const exists = prev.some((d) => format(d, 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd'));
      if (exists) {
        return prev.filter((d) => format(d, 'yyyy-MM-dd') !== format(date, 'yyyy-MM-dd'));
      } else {
        return [...prev, date];
      }
    });
  };

  const onSubmit = async (values: z.infer<typeof multipleCreneauxSchema>) => {
    if (selectedDates.length === 0) {
      toast.error('Veuillez sélectionner au moins une date');
      return;
    }

    setLoading(true);

    try {
      // Delete existing créneaux for the selected dates and periods
      for (const date of selectedDates) {
        const dateStr = format(date, 'yyyy-MM-dd');
        const periodes: ('matin' | 'apres_midi')[] =
          values.demi_journee === 'toute_journee' ? ['matin', 'apres_midi'] : [values.demi_journee];

        // Delete existing capacite_effective for this secretaire, date, and periods
        const { error: deleteError } = await supabase
          .from('capacite_effective')
          .delete()
          .eq('secretaire_id', secretaireId)
          .eq('date', dateStr)
          .in('demi_journee', periodes);

        if (deleteError) {
          console.error('Error deleting existing créneaux:', deleteError);
        }
      }

      const capacitesToInsert = selectedDates.flatMap((date) => {
        const baseCapacite = {
          secretaire_id: secretaireId,
          date: format(date, 'yyyy-MM-dd'),
          site_id: values.site_id || adminSiteId, // Use admin site if no site selected
        };

        if (values.demi_journee === 'toute_journee') {
          return [
            { ...baseCapacite, demi_journee: 'matin' as const },
            { ...baseCapacite, demi_journee: 'apres_midi' as const },
          ];
        } else {
          return [{ ...baseCapacite, demi_journee: values.demi_journee }];
        }
      });

      const { error } = await supabase.from('capacite_effective').insert(capacitesToInsert);

      if (error) throw error;

      toast.success(`${capacitesToInsert.length} créneau(x) ajouté(s)`);
      onSuccess?.();
      onOpenChange(false);
    } catch (error) {
      console.error('Error adding capacités:', error);
      toast.error('Erreur lors de l\'ajout des créneaux');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl backdrop-blur-xl bg-card/95 border-2 border-teal-200/50 dark:border-teal-800/50">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold bg-gradient-to-r from-teal-600 to-cyan-600 bg-clip-text text-transparent">
            Ajouter plusieurs créneaux
          </DialogTitle>
          <DialogDescription className="sr-only">Sélectionnez plusieurs dates pour ajouter des créneaux</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <FormField
                  control={form.control}
                  name="site_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Site</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger className="backdrop-blur-xl bg-card/95 border-teal-200/50 dark:border-teal-800/50">
                            <SelectValue placeholder="Administratif (par défaut)" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {sites.map((site) => (
                            <SelectItem key={site.id} value={site.id}>
                              <div className="flex items-center gap-2">
                                <MapPin className="h-3 w-3" />
                                {site.nom}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="demi_journee"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Période</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger className="backdrop-blur-xl bg-card/95 border-teal-200/50 dark:border-teal-800/50">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="matin">Matin</SelectItem>
                          <SelectItem value="apres_midi">Après-midi</SelectItem>
                          <SelectItem value="toute_journee">Toute la journée</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {selectedDates.length > 0 && (
                  <div className="space-y-2">
                    <FormLabel>Dates sélectionnées ({selectedDates.length})</FormLabel>
                    <div className="flex flex-wrap gap-2 p-3 bg-accent/20 rounded-lg max-h-32 overflow-y-auto">
                      {selectedDates
                        .sort((a, b) => a.getTime() - b.getTime())
                        .map((date) => (
                          <Badge
                            key={date.toISOString()}
                            variant="secondary"
                            className="cursor-pointer hover:bg-destructive hover:text-destructive-foreground transition-colors"
                            onClick={() => handleDateSelect(date)}
                          >
                            {format(date, 'dd MMM yyyy', { locale: fr })}
                            <span className="ml-1">×</span>
                          </Badge>
                        ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <FormLabel className="flex items-center gap-2">
                  <CalendarIconComponent className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                  Sélectionner les dates
                </FormLabel>
                <Calendar
                  mode="multiple"
                  selected={selectedDates}
                  onSelect={(dates) => dates && setSelectedDates(dates)}
                  locale={fr}
                  className="rounded-xl border-2 border-teal-200/50 dark:border-teal-800/50 backdrop-blur-xl bg-card/95 p-3"
                  modifiers={{
                    selected: selectedDates,
                  }}
                  modifiersStyles={{
                    selected: {
                      backgroundColor: 'hsl(var(--primary))',
                      color: 'hsl(var(--primary-foreground))',
                    },
                  }}
                />
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="backdrop-blur-xl bg-card/95 border-teal-200/50 dark:border-teal-800/50"
              >
                Annuler
              </Button>
              <Button
                type="submit"
                disabled={loading || selectedDates.length === 0}
                className="backdrop-blur-xl bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-700 hover:to-cyan-700 text-white border-0 shadow-lg hover:shadow-xl hover:shadow-teal-500/20 transition-all duration-300"
              >
                {loading ? 'Ajout en cours...' : `Ajouter ${selectedDates.length} date(s)`}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
