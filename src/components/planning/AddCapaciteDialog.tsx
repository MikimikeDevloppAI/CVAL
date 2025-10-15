import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Calendar } from '@/components/ui/calendar';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { CalendarIcon, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';

const capaciteSchema = z.object({
  secretaire_id: z.string().min(1, 'Secrétaire requis'),
  periode: z.enum(['matin', 'apres_midi', 'journee']),
});

type CapaciteFormData = z.infer<typeof capaciteSchema>;

interface AddCapaciteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function AddCapaciteDialog({ open, onOpenChange, onSuccess }: AddCapaciteDialogProps) {
  const [secretaires, setSecretaires] = useState<{ id: string; first_name: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDates, setSelectedDates] = useState<Date[]>([]);
  const [showCalendar, setShowCalendar] = useState(false);
  const { toast } = useToast();

  const form = useForm<CapaciteFormData>({
    resolver: zodResolver(capaciteSchema),
    defaultValues: {
      secretaire_id: '',
      periode: 'matin',
    },
  });

  useEffect(() => {
    const fetchData = async () => {
      const { data: secretairesData } = await supabase
        .from('secretaires')
        .select('id, first_name, name')
        .eq('actif', true)
        .order('name');
      
      setSecretaires(secretairesData || []);
    };

    if (open) {
      fetchData();
      setSelectedDates([]);
      form.reset();
    }
  }, [open, form]);

  const handleDateSelect = (dates: Date[] | undefined) => {
    if (dates) {
      setSelectedDates(dates);
    }
  };

  const removeDate = (dateToRemove: Date) => {
    setSelectedDates(prev => prev.filter(d => d.getTime() !== dateToRemove.getTime()));
  };

  const handleSubmit = async (data: CapaciteFormData) => {
    if (selectedDates.length === 0) {
      toast({
        title: "Erreur",
        description: "Veuillez sélectionner au moins un jour",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      // Déterminer la demi_journee selon les heures
      let demiJournee: 'matin' | 'apres_midi' | 'toute_journee' = 'toute_journee';
      if (data.periode === 'matin') {
        demiJournee = 'matin';
      } else if (data.periode === 'apres_midi') {
        demiJournee = 'apres_midi';
      } else {
        demiJournee = 'toute_journee';
      }

      // Cette ligne n'est plus nécessaire
      
      await Promise.all(
        selectedDates.map(date => {
          const insertData = {
            date: format(date, 'yyyy-MM-dd'),
            secretaire_id: data.secretaire_id,
            demi_journee: demiJournee,
            actif: true,
          };

          return supabase
            .from('capacite_effective')
            .insert(insertData);
        })
      );

      toast({
        title: "Succès",
        description: `${selectedDates.length} capacité(s) ajoutée(s) avec succès`,
      });

      onSuccess();
      onOpenChange(false);
      form.reset();
      setSelectedDates([]);
    } catch (error: any) {
      console.error('Erreur:', error);
      toast({
        title: "Erreur",
        description: error?.message || "Erreur lors de l'ajout de la capacité",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ajouter une capacité</DialogTitle>
          <DialogDescription>
            Sélectionnez les jours et configurez les horaires de disponibilité
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            {/* Sélection des dates */}
            <div className="space-y-2">
              <FormLabel>Jours *</FormLabel>
              <div className="space-y-2">
                {selectedDates.length > 0 && (
                  <div className="flex flex-wrap gap-2 p-3 bg-muted/30 rounded-lg">
                    {selectedDates.map((date, index) => (
                      <Badge key={index} variant="secondary" className="gap-1">
                        {format(date, 'EEE d MMM', { locale: fr })}
                        <button
                          type="button"
                          onClick={() => removeDate(date)}
                          className="ml-1 hover:bg-destructive/20 rounded-full"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
                
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => setShowCalendar(!showCalendar)}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {selectedDates.length === 0 
                    ? 'Sélectionner des jours' 
                    : `${selectedDates.length} jour(s) sélectionné(s)`
                  }
                </Button>

                {showCalendar && (
                  <div className="border rounded-lg p-3 bg-background">
                    <Calendar
                      mode="multiple"
                      selected={selectedDates}
                      onSelect={handleDateSelect}
                      locale={fr}
                      className={cn("pointer-events-auto")}
                    />
                  </div>
                )}
              </div>
            </div>

            <FormField
              control={form.control}
              name="secretaire_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Secrétaire *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Sélectionner une secrétaire" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {secretaires.map((sec) => (
                        <SelectItem key={sec.id} value={sec.id}>
                          {sec.first_name} {sec.name}
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
              name="periode"
              render={({ field }) => (
                <FormItem className="space-y-3">
                  <FormLabel>Période *</FormLabel>
                  <FormControl>
                    <RadioGroup
                      onValueChange={field.onChange}
                      value={field.value}
                      className="flex flex-col space-y-1"
                    >
                      <FormItem className="flex items-center space-x-3 space-y-0">
                        <FormControl>
                          <RadioGroupItem value="matin" />
                        </FormControl>
                        <FormLabel className="font-normal cursor-pointer">
                          Matin (07:30 - 12:00)
                        </FormLabel>
                      </FormItem>
                      <FormItem className="flex items-center space-x-3 space-y-0">
                        <FormControl>
                          <RadioGroupItem value="apres_midi" />
                        </FormControl>
                        <FormLabel className="font-normal cursor-pointer">
                          Après-midi (13:00 - 17:00)
                        </FormLabel>
                      </FormItem>
                      <FormItem className="flex items-center space-x-3 space-y-0">
                        <FormControl>
                          <RadioGroupItem value="journee" />
                        </FormControl>
                        <FormLabel className="font-normal cursor-pointer">
                          Journée complète (07:30 - 17:00)
                        </FormLabel>
                      </FormItem>
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Annuler
              </Button>
              <Button type="submit" disabled={loading || selectedDates.length === 0}>
                {loading ? 'Ajout...' : `Ajouter ${selectedDates.length > 0 ? `(${selectedDates.length})` : ''}`}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}