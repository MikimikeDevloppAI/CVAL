import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

const besoinSchema = z.object({
  date: z.date(),
  specialite_id: z.string().min(1, 'La spécialité est requise'),
  nombre_secretaires_requis: z.number().min(1, 'Au moins 1 secrétaire requis'),
  heure_debut: z.string().min(1, "L'heure de début est requise"),
  heure_fin: z.string().min(1, "L'heure de fin est requise"),
});

type BesoinFormData = z.infer<typeof besoinSchema>;

interface Specialite {
  id: string;
  nom: string;
  code: string;
}

interface BlocOperatoireFormProps {
  besoin?: any;
  onSubmit: () => void;
  onCancel: () => void;
}

export const BlocOperatoireForm = ({ besoin, onSubmit, onCancel }: BlocOperatoireFormProps) => {
  const [specialites, setSpecialites] = useState<Specialite[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const form = useForm<BesoinFormData>({
    resolver: zodResolver(besoinSchema),
    defaultValues: {
      date: besoin?.date ? new Date(besoin.date) : undefined,
      specialite_id: besoin?.specialite_id || '',
      nombre_secretaires_requis: besoin?.nombre_secretaires_requis || 1,
      heure_debut: besoin?.heure_debut || '08:00',
      heure_fin: besoin?.heure_fin || '17:00',
    },
  });

  useEffect(() => {
    const fetchSpecialites = async () => {
      try {
        const { data, error } = await supabase
          .from('specialites')
          .select('*')
          .order('nom');

        if (error) throw error;
        setSpecialites(data || []);
      } catch (error) {
        console.error('Erreur lors du chargement des spécialités:', error);
        toast({
          title: "Erreur",
          description: "Erreur lors du chargement des spécialités",
          variant: "destructive",
        });
      }
    };

    fetchSpecialites();
  }, []);

  const handleSubmit = async (data: BesoinFormData) => {
    setLoading(true);
    try {
      const formattedData = {
        ...data,
        date: format(data.date, 'yyyy-MM-dd'),
      };

      if (besoin) {
        // Mise à jour
        const { error } = await supabase
          .from('bloc_operatoire_besoins')
          .update(formattedData)
          .eq('id', besoin.id);

        if (error) throw error;
        toast({
          title: "Succès",
          description: "Besoin mis à jour avec succès",
        });
      } else {
        // Création
        const { error } = await supabase
          .from('bloc_operatoire_besoins')
          .insert([formattedData]);

        if (error) throw error;
        toast({
          title: "Succès",
          description: "Besoin créé avec succès",
        });
      }

      onSubmit();
    } catch (error) {
      console.error('Erreur lors de la sauvegarde:', error);
      toast({
        title: "Erreur",
        description: "Erreur lors de la sauvegarde",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        <FormField
          control={form.control}
          name="date"
          render={({ field }) => (
            <FormItem className="flex flex-col">
              <FormLabel>Date</FormLabel>
              <Popover>
                <PopoverTrigger asChild>
                  <FormControl>
                    <Button
                      variant={"outline"}
                      className={cn(
                        "w-full pl-3 text-left font-normal",
                        !field.value && "text-muted-foreground"
                      )}
                    >
                      {field.value ? (
                        format(field.value, "dd/MM/yyyy")
                      ) : (
                        <span>Sélectionner une date</span>
                      )}
                      <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                    </Button>
                  </FormControl>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={field.value}
                    onSelect={field.onChange}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="specialite_id"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Spécialité</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner une spécialité" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {specialites.map((specialite) => (
                    <SelectItem key={specialite.id} value={specialite.id}>
                      {specialite.nom}
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
          name="nombre_secretaires_requis"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nombre de secrétaires requis</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min="1"
                  {...field}
                  onChange={(e) => field.onChange(parseInt(e.target.value))}
                />
              </FormControl>
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
                  <Input type="time" {...field} />
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
                  <Input type="time" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="flex justify-end space-x-4">
          <Button type="button" variant="outline" onClick={onCancel}>
            Annuler
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? 'Sauvegarde...' : besoin ? 'Mettre à jour' : 'Créer'}
          </Button>
        </div>
      </form>
    </Form>
  );
};