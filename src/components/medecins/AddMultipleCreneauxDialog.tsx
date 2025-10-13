import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Calendar } from '@/components/ui/calendar';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { CalendarIcon, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const multipleCreneauxSchema = z.object({
  site_id: z.string().min(1, 'Site requis'),
  demi_journee: z.union([
    z.literal('toute_journee'),
    z.literal('matin'),
    z.literal('apres_midi')
  ]),
  type_intervention_id: z.string().optional(),
});

interface AddMultipleCreneauxDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  medecinId: string;
  onSuccess: () => void;
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
  onSuccess 
}: AddMultipleCreneauxDialogProps) {
  const [sites, setSites] = useState<Site[]>([]);
  const [typesIntervention, setTypesIntervention] = useState<TypeIntervention[]>([]);
  const [blocOperatoireSiteId, setBlocOperatoireSiteId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [selectedDates, setSelectedDates] = useState<Date[]>([]);
  const { toast } = useToast();

  const form = useForm({
    resolver: zodResolver(multipleCreneauxSchema),
    defaultValues: {
      site_id: '',
      demi_journee: 'toute_journee' as const,
      type_intervention_id: undefined,
    },
  });

  const selectedSiteId = form.watch('site_id');
  const isBlocSite = selectedSiteId === blocOperatoireSiteId;

  useEffect(() => {
    if (open) {
      fetchData();
      setSelectedDates([]);
      form.reset();
    }
  }, [open]);

  const fetchData = async () => {
    const [{ data: sitesData }, { data: typesData }] = await Promise.all([
      supabase.from('sites').select('id, nom').eq('actif', true).order('nom'),
      supabase.from('types_intervention').select('*').eq('actif', true).order('nom'),
    ]);
    
    if (sitesData) {
      setSites(sitesData);
      const blocSite = sitesData.find(s => s.nom.toLowerCase().includes('bloc'));
      if (blocSite) setBlocOperatoireSiteId(blocSite.id);
    }
    if (typesData) setTypesIntervention(typesData);
  };

  const handleDateSelect = (date: Date | undefined) => {
    if (!date) return;
    
    const dateStr = format(date, 'yyyy-MM-dd');
    const existingIndex = selectedDates.findIndex(
      d => format(d, 'yyyy-MM-dd') === dateStr
    );
    
    if (existingIndex >= 0) {
      setSelectedDates(selectedDates.filter((_, i) => i !== existingIndex));
    } else {
      setSelectedDates([...selectedDates, date]);
    }
  };

  const removeDate = (index: number) => {
    setSelectedDates(selectedDates.filter((_, i) => i !== index));
  };

  const onSubmit = async (data: z.infer<typeof multipleCreneauxSchema>) => {
    if (selectedDates.length === 0) {
      toast({
        title: 'Erreur',
        description: 'Veuillez sélectionner au moins une date',
        variant: 'destructive',
      });
      return;
    }

    if (isBlocSite && !data.type_intervention_id) {
      toast({
        title: 'Erreur',
        description: 'Type d\'intervention requis pour le bloc opératoire',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      const besoinsToCreate = selectedDates.map(date => ({
        date: format(date, 'yyyy-MM-dd'),
        type: 'medecin' as const,
        medecin_id: medecinId,
        site_id: data.site_id,
        demi_journee: data.demi_journee,
        type_intervention_id: isBlocSite ? data.type_intervention_id : undefined,
        actif: true,
      }));

      const { error } = await supabase
        .from('besoin_effectif')
        .insert(besoinsToCreate);

      if (error) throw error;

      toast({
        title: 'Succès',
        description: `${selectedDates.length} créneaux ajoutés`,
      });

      onSuccess();
      onOpenChange(false);
    } catch (error) {
      console.error('Erreur:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible d\'ajouter les créneaux',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ajouter plusieurs créneaux</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
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
                      <SelectItem value="toute_journee">Toute la journée</SelectItem>
                      <SelectItem value="matin">Matin</SelectItem>
                      <SelectItem value="apres_midi">Après-midi</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {isBlocSite && (
              <FormField
                control={form.control}
                name="type_intervention_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type d'intervention</FormLabel>
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

            <div className="space-y-4">
              <FormLabel>Sélectionner les dates</FormLabel>
              <div className="flex justify-center">
                <Calendar
                  mode="single"
                  selected={undefined}
                  onSelect={handleDateSelect}
                  locale={fr}
                  className={cn("rounded-md border pointer-events-auto")}
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

              {selectedDates.length > 0 && (
                <div className="space-y-2">
                  <div className="text-sm font-medium">
                    Dates sélectionnées ({selectedDates.length})
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selectedDates
                      .sort((a, b) => a.getTime() - b.getTime())
                      .map((date, index) => (
                        <Badge key={index} variant="secondary" className="gap-1">
                          {format(date, 'dd/MM/yyyy', { locale: fr })}
                          <button
                            type="button"
                            onClick={() => removeDate(index)}
                            className="ml-1 hover:bg-destructive/20 rounded-full p-0.5"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                  </div>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={loading}
              >
                Annuler
              </Button>
              <Button type="submit" disabled={loading || selectedDates.length === 0}>
                {loading ? 'Ajout en cours...' : `Ajouter ${selectedDates.length} créneau${selectedDates.length > 1 ? 'x' : ''}`}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
