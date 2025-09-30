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
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

const capaciteSchema = z.object({
  secretaire_id: z.string().min(1, 'Secrétaire ou backup requis'),
  heure_debut: z.string().min(1, 'Heure de début requise'),
  heure_fin: z.string().min(1, 'Heure de fin requise'),
  specialites: z.array(z.string()).min(1, 'Au moins une spécialité requise'),
}).refine((data) => {
  if (data.heure_debut && data.heure_fin) {
    return data.heure_debut < data.heure_fin;
  }
  return true;
}, {
  message: "L'heure de début doit être avant l'heure de fin",
  path: ["heure_debut"],
});

type CapaciteFormData = z.infer<typeof capaciteSchema>;

interface AddCapaciteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function AddCapaciteDialog({ open, onOpenChange, onSuccess }: AddCapaciteDialogProps) {
  const [secretaires, setSecretaires] = useState<{ id: string; first_name: string; name: string; specialites: string[] }[]>([]);
  const [backup, setBackup] = useState<{ id: string; first_name: string; name: string; specialites: string[] }[]>([]);
  const [specialites, setSpecialites] = useState<{ id: string; nom: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDates, setSelectedDates] = useState<Date[]>([]);
  const [showCalendar, setShowCalendar] = useState(false);
  const { toast } = useToast();

  const form = useForm<CapaciteFormData>({
    resolver: zodResolver(capaciteSchema),
    defaultValues: {
      secretaire_id: '',
      heure_debut: '07:30',
      heure_fin: '17:30',
      specialites: [],
    },
  });

  const selectedSecretaireId = form.watch('secretaire_id');

  useEffect(() => {
    const fetchData = async () => {
      const [{ data: secretairesData }, { data: backupData }, { data: specialitesData }] = await Promise.all([
        supabase.from('secretaires').select('id, first_name, name, specialites').eq('actif', true).order('name'),
        supabase.from('backup').select('id, first_name, name, specialites').eq('actif', true).order('name'),
        supabase.from('specialites').select('id, nom').order('nom'),
      ]);
      
      setSecretaires(secretairesData || []);
      setBackup(backupData || []);
      setSpecialites(specialitesData || []);
    };

    if (open) {
      fetchData();
      setSelectedDates([]);
      form.reset();
    }
  }, [open, form]);

  // Auto-sélectionner les spécialités de la personne sélectionnée
  useEffect(() => {
    if (selectedSecretaireId) {
      const personne = [...secretaires, ...backup].find(p => p.id === selectedSecretaireId);
      if (personne && personne.specialites) {
        form.setValue('specialites', personne.specialites);
      }
    }
  }, [selectedSecretaireId, secretaires, backup, form]);

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
      await Promise.all(
        selectedDates.map(date => 
          supabase
            .from('capacite_effective')
            .insert({
              date: format(date, 'yyyy-MM-dd'),
              secretaire_id: data.secretaire_id,
              heure_debut: data.heure_debut,
              heure_fin: data.heure_fin,
              specialites: data.specialites,
              actif: true,
            })
        )
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
                  <FormLabel>Secrétaire ou Backup *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Sélectionner une personne" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {secretaires.length > 0 && (
                        <>
                          <div className="px-2 py-1.5 text-sm font-semibold text-muted-foreground">
                            Secrétaires
                          </div>
                          {secretaires.map((sec) => (
                            <SelectItem key={sec.id} value={sec.id}>
                              {sec.first_name} {sec.name}
                            </SelectItem>
                          ))}
                        </>
                      )}
                      {backup.length > 0 && (
                        <>
                          <div className="px-2 py-1.5 text-sm font-semibold text-muted-foreground">
                            Backup
                          </div>
                          {backup.map((bkp) => (
                            <SelectItem key={bkp.id} value={bkp.id}>
                              {bkp.first_name} {bkp.name}
                            </SelectItem>
                          ))}
                        </>
                      )}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="specialites"
              render={() => (
                <FormItem>
                  <FormLabel>Spécialités *</FormLabel>
                  <div className="border rounded-lg p-3 space-y-2 max-h-40 overflow-y-auto">
                    {specialites.map((spec) => (
                      <FormField
                        key={spec.id}
                        control={form.control}
                        name="specialites"
                        render={({ field }) => (
                          <FormItem className="flex items-center space-x-2 space-y-0">
                            <FormControl>
                              <Checkbox
                                checked={field.value?.includes(spec.id)}
                                onCheckedChange={(checked) => {
                                  return checked
                                    ? field.onChange([...field.value, spec.id])
                                    : field.onChange(field.value?.filter((value) => value !== spec.id));
                                }}
                              />
                            </FormControl>
                            <FormLabel className="font-normal cursor-pointer">
                              {spec.nom}
                            </FormLabel>
                          </FormItem>
                        )}
                      />
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="heure_debut"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Heure de début</FormLabel>
                    <FormControl>
                      <Input {...field} type="time" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="heure_fin"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Heure de fin</FormLabel>
                    <FormControl>
                      <Input {...field} type="time" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

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