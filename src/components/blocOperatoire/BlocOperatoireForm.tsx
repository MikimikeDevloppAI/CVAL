import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

const besoinSchema = z.object({
  date: z.date(),
  medecin_id: z.string().min(1, 'Le médecin est requis'),
  type_intervention_id: z.string().min(1, "Le type d'intervention est requis"),
  demi_journee: z.union([
    z.literal('matin'),
    z.literal('apres_midi'),
    z.literal('toute_journee')
  ]),
});

type BesoinFormData = z.infer<typeof besoinSchema>;

interface Medecin {
  id: string;
  name: string;
  first_name: string;
}

interface TypeIntervention {
  id: string;
  nom: string;
  code: string;
}

interface BlocOperatoireFormProps {
  besoin?: any;
  preselectedDate?: Date | null;
  onSubmit: () => void;
  onCancel: () => void;
}

export const BlocOperatoireForm = ({ besoin, preselectedDate, onSubmit, onCancel }: BlocOperatoireFormProps) => {
  const [medecins, setMedecins] = useState<Medecin[]>([]);
  const [typesIntervention, setTypesIntervention] = useState<TypeIntervention[]>([]);
  const [blocSiteId, setBlocSiteId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const form = useForm<BesoinFormData>({
    resolver: zodResolver(besoinSchema),
    defaultValues: {
      date: besoin?.date ? new Date(besoin.date) : (preselectedDate || undefined),
      medecin_id: besoin?.medecin_id || '',
      type_intervention_id: besoin?.type_intervention_id || '',
      demi_journee: besoin?.demi_journee || 'toute_journee',
    },
  });

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch medecins
        const { data: medecinsData, error: medecinsError } = await supabase
          .from('medecins')
          .select('id, name, first_name')
          .eq('actif', true)
          .order('name');

        if (medecinsError) throw medecinsError;
        setMedecins(medecinsData || []);

        // Fetch types intervention
        const { data: typesData, error: typesError } = await supabase
          .from('types_intervention')
          .select('*')
          .eq('actif', true)
          .order('nom');

        if (typesError) throw typesError;
        setTypesIntervention(typesData || []);

        // Fetch bloc operatoire site
        const { data: siteData, error: siteError } = await supabase
          .from('sites')
          .select('id')
          .ilike('nom', '%bloc%')
          .limit(1)
          .single();

        if (siteError) throw siteError;
        setBlocSiteId(siteData?.id || '');
      } catch (error) {
        console.error('Erreur lors du chargement des données:', error);
        toast({
          title: "Erreur",
          description: "Erreur lors du chargement des données",
          variant: "destructive",
        });
      }
    };

    fetchData();
  }, []);

  const handleSubmit = async (data: BesoinFormData) => {
    setLoading(true);
    try {
      // Format date without timezone conversion to avoid day shift
      const year = data.date.getFullYear();
      const month = String(data.date.getMonth() + 1).padStart(2, '0');
      const day = String(data.date.getDate()).padStart(2, '0');
      const formattedDate = `${year}-${month}-${day}`;
      
      // Determine which demi_journees to process
      const demiJournees: ('matin' | 'apres_midi')[] = data.demi_journee === 'toute_journee' 
        ? ['matin', 'apres_midi'] 
        : [data.demi_journee as 'matin' | 'apres_midi'];

      // Delete existing besoins for this medecin/date/demi_journees
      const { error: deleteError } = await supabase
        .from('besoin_effectif')
        .delete()
        .eq('medecin_id', data.medecin_id)
        .eq('date', formattedDate)
        .eq('site_id', blocSiteId)
        .in('demi_journee', demiJournees);

      if (deleteError) throw deleteError;

      // Insert new besoins
      const besoinsToInsert = demiJournees.map(dj => ({
        date: formattedDate,
        type: 'medecin' as const,
        medecin_id: data.medecin_id,
        site_id: blocSiteId,
        demi_journee: dj,
        type_intervention_id: data.type_intervention_id,
        actif: true,
      }));

      const { error: insertError } = await supabase
        .from('besoin_effectif')
        .insert(besoinsToInsert);

      if (insertError) throw insertError;

      toast({
        title: "Succès",
        description: besoin ? "Besoin mis à jour avec succès" : "Besoin créé avec succès",
      });

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
          name="medecin_id"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Médecin</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner un médecin" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {medecins.map((medecin) => (
                    <SelectItem key={medecin.id} value={medecin.id}>
                      {medecin.first_name} {medecin.name}
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
          name="type_intervention_id"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Type d'intervention</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
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

        <FormField
          control={form.control}
          name="demi_journee"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Période</FormLabel>
              <FormControl>
                <RadioGroup
                  onValueChange={field.onChange}
                  defaultValue={field.value}
                  className="flex flex-col space-y-1"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="matin" id="matin" />
                    <Label htmlFor="matin" className="font-normal cursor-pointer">
                      Matin
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="apres_midi" id="apres_midi" />
                    <Label htmlFor="apres_midi" className="font-normal cursor-pointer">
                      Après-midi
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="toute_journee" id="toute_journee" />
                    <Label htmlFor="toute_journee" className="font-normal cursor-pointer">
                      Toute la journée
                    </Label>
                  </div>
                </RadioGroup>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

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