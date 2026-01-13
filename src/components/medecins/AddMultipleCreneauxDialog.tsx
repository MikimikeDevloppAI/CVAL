import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Calendar as CalendarIconComponent, MapPin, Stethoscope } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { checkMedecinOverlap, getOverlapErrorMessage } from '@/lib/overlapValidation';

const multipleCreneauxSchema = z.object({
  site_id: z.string().min(1, 'Veuillez sélectionner un site'),
  demi_journee: z.enum(['matin', 'apres_midi', 'toute_journee']),
  type_intervention_id: z.string().optional(),
});

interface AddMultipleCreneauxDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  medecinId: string;
  onSuccess?: () => void;
}

interface Site {
  id: string;
  nom: string;
}

interface TypeIntervention {
  id: string;
  nom: string;
}

export function AddMultipleCreneauxDialog({
  open,
  onOpenChange,
  medecinId,
  onSuccess,
}: AddMultipleCreneauxDialogProps) {
  const [sites, setSites] = useState<Site[]>([]);
  const [typesIntervention, setTypesIntervention] = useState<TypeIntervention[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDates, setSelectedDates] = useState<Date[]>([]);
  const [blocSiteId, setBlocSiteId] = useState<string>('');

  const form = useForm<z.infer<typeof multipleCreneauxSchema>>({
    resolver: zodResolver(multipleCreneauxSchema),
    defaultValues: {
      site_id: '',
      demi_journee: 'toute_journee',
      type_intervention_id: '',
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
    // Fetch sites excluding "administratif"
    const { data: sitesData } = await supabase
      .from('sites')
      .select('id, nom')
      .eq('actif', true)
      .not('nom', 'ilike', '%administratif%')
      .order('nom');

    if (sitesData) setSites(sitesData);

    // Fetch bloc operatoire site
    const { data: blocSite } = await supabase
      .from('sites')
      .select('id')
      .ilike('nom', '%bloc%opératoire%')
      .single();

    if (blocSite) setBlocSiteId(blocSite.id);

    const { data: typesData } = await supabase
      .from('types_intervention')
      .select('id, nom')
      .eq('actif', true)
      .order('nom');

    if (typesData) setTypesIntervention(typesData);
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

    // Validate if type_intervention_id is required for bloc operatoire
    if (values.site_id === blocSiteId && !values.type_intervention_id) {
      toast.error('Le type d\'intervention est obligatoire pour le bloc opératoire');
      return;
    }

    setLoading(true);

    try {
      // Delete existing créneaux for the selected dates and periods
      for (const date of selectedDates) {
        const dateStr = format(date, 'yyyy-MM-dd');
        const periodes: ('matin' | 'apres_midi')[] =
          values.demi_journee === 'toute_journee' ? ['matin', 'apres_midi'] : [values.demi_journee];

        // Delete existing besoin_effectif for this medecin, date, and periods
        const { error: deleteError } = await supabase
          .from('besoin_effectif')
          .delete()
          .eq('medecin_id', medecinId)
          .eq('date', dateStr)
          .in('demi_journee', periodes);

        if (deleteError) {
          console.error('Error deleting existing créneaux:', deleteError);
        }
      }

      const besoinsToInsert = selectedDates.flatMap((date) => {
        const baseBesoin = {
          type: 'medecin' as const,
          medecin_id: medecinId,
          date: format(date, 'yyyy-MM-dd'),
          site_id: values.site_id,
          type_intervention_id: values.type_intervention_id || null,
        };

        if (values.demi_journee === 'toute_journee') {
          return [
            { ...baseBesoin, demi_journee: 'matin' as const },
            { ...baseBesoin, demi_journee: 'apres_midi' as const },
          ];
        } else {
          return [{ ...baseBesoin, demi_journee: values.demi_journee }];
        }
      });

      const { error } = await supabase.from('besoin_effectif').insert(besoinsToInsert);

      if (error) throw error;

      toast.success(`${besoinsToInsert.length} créneau(x) ajouté(s)`);
      onSuccess?.();
      onOpenChange(false);
    } catch (error) {
      console.error('Error adding besoins:', error);
      toast.error('Erreur lors de l\'ajout des créneaux');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl backdrop-blur-xl bg-card/95 border border-border/50">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-teal-50 border border-teal-200 flex items-center justify-center">
              <Stethoscope className="h-5 w-5 text-teal-600" />
            </div>
            <span className="text-xl font-bold text-foreground">Ajouter plusieurs créneaux</span>
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
                          <SelectTrigger>
                            <SelectValue placeholder="Sélectionner un site" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {sites.map((site) => (
                            <SelectItem key={site.id} value={site.id}>
                              {site.nom}
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
                          <SelectTrigger>
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

                {form.watch('site_id') === blocSiteId && (
                  <FormField
                    control={form.control}
                    name="type_intervention_id"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Type d'intervention <span className="text-destructive">*</span></FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Sélectionner un type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {typesIntervention.map((type) => (
                              <SelectItem key={type.id} value={type.id}>
                                {type.nom}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

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
                  <CalendarIconComponent className="h-4 w-4 text-muted-foreground" />
                  Sélectionner les dates
                </FormLabel>
                <Calendar
                  mode="multiple"
                  selected={selectedDates}
                  onSelect={(dates) => dates && setSelectedDates(dates)}
                  locale={fr}
                  className="rounded-xl border border-border/50 bg-card/95 p-3"
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
              >
                Annuler
              </Button>
              <Button
                type="submit"
                disabled={loading || selectedDates.length === 0}
                className="bg-primary hover:bg-primary/90"
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
