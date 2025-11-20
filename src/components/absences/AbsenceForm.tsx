import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { CalendarIcon } from 'lucide-react';
import { format, eachDayOfInterval } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { DateRange } from 'react-day-picker';

const absenceSchema = z.object({
  profile_type: z.enum(['medecin', 'secretaire']),
  person_id: z.string().min(1, 'La sélection d\'une personne est requise'),
  type: z.enum(['conges', 'maladie', 'formation', 'conge_maternite', 'autre']),
  dateRange: z.object({
    from: z.date({ message: "Veuillez sélectionner une date de début" }),
    to: z.date().optional(),
  }).refine((data) => {
    if (data.to && data.from) {
      return data.to >= data.from;
    }
    return true;
  }, { message: "La date de fin doit être après la date de début" }),
  demi_journee: z.enum(['toute_journee', 'matin', 'apres_midi']).default('toute_journee'),
  motif: z.string().optional(),
});

type AbsenceFormData = z.infer<typeof absenceSchema>;

interface AbsenceFormProps {
  absence?: any;
  onSuccess: () => void;
}

export function AbsenceForm({ absence, onSuccess }: AbsenceFormProps) {
  const [loading, setLoading] = useState(false);
  const [medecins, setMedecins] = useState<any[]>([]);
  const [secretaires, setSecretaires] = useState<any[]>([]);
  const { toast } = useToast();

  const form = useForm<AbsenceFormData>({
    resolver: zodResolver(absenceSchema),
    defaultValues: {
      profile_type: absence?.type_personne || 'medecin',
      person_id: absence?.medecin_id || absence?.secretaire_id || '',
      type: absence?.type || 'conges',
      dateRange: absence?.date_debut ? {
        from: new Date(absence.date_debut),
        to: absence.date_fin ? new Date(absence.date_fin) : undefined,
      } : { from: undefined, to: undefined },
      demi_journee: absence?.demi_journee || 'toute_journee',
      motif: absence?.motif || '',
    },
  });

  const profileType = form.watch('profile_type');

  useEffect(() => {
    const fetchProfiles = async () => {
      // Fetch all active medecins
      const { data: medecinData } = await supabase
        .from('medecins')
        .select('id, first_name, name')
        .eq('actif', true)
        .order('first_name');
      
      setMedecins(medecinData || []);

      // Fetch all active secretaires
      const { data: secretaireData } = await supabase
        .from('secretaires')
        .select('id, first_name, name')
        .eq('actif', true)
        .order('first_name');
      
      setSecretaires(secretaireData || []);
    };

    fetchProfiles();
  }, []);

  const onSubmit = async (data: AbsenceFormData) => {
    setLoading(true);
    try {
      // Calculer toutes les dates de la plage
      const dates = data.dateRange.to 
        ? eachDayOfInterval({ start: data.dateRange.from, end: data.dateRange.to })
        : [data.dateRange.from];
      
      const absenceData = {
        type_personne: data.profile_type,
        medecin_id: data.profile_type === 'medecin' ? data.person_id : null,
        secretaire_id: data.profile_type === 'secretaire' ? data.person_id : null,
        type: data.type,
        date_debut: format(dates[0], 'yyyy-MM-dd'),
        date_fin: format(dates[dates.length - 1], 'yyyy-MM-dd'),
        demi_journee: data.demi_journee,
        motif: data.motif || null,
        statut: 'approuve' as const,
      };

      if (absence) {
        // Modification
        const { error } = await supabase
          .from('absences')
          .update(absenceData)
          .eq('id', absence.id);

        if (error) throw error;

        toast({
          title: "Succès",
          description: "Absence modifiée avec succès",
        });
      } else {
        // Création - une absence par date sélectionnée
        const absences = dates.map(date => ({
          type_personne: data.profile_type,
          medecin_id: data.profile_type === 'medecin' ? data.person_id : null,
          secretaire_id: data.profile_type === 'secretaire' ? data.person_id : null,
          type: data.type,
          date_debut: format(date, 'yyyy-MM-dd'),
          date_fin: format(date, 'yyyy-MM-dd'),
          demi_journee: data.demi_journee,
          motif: data.motif || null,
          statut: 'approuve' as const,
        }));

        const { error } = await supabase
          .from('absences')
          .insert(absences);

        if (error) throw error;

        toast({
          title: "Succès",
          description: "Absence(s) créée(s) avec succès",
        });
      }

      onSuccess();
    } catch (error) {
      console.error('Erreur:', error);
      toast({
        title: "Erreur",
        description: "Une erreur est survenue",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const profiles = profileType === 'medecin' ? medecins : secretaires;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        {/* Type de profil */}
        <FormField
          control={form.control}
          name="profile_type"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Type de profil</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner le type" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="medecin">Médecin</SelectItem>
                  <SelectItem value="secretaire">Assistant médical</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Personne */}
        <FormField
          control={form.control}
          name="person_id"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Personne</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner une personne" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {profiles.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.first_name} {profile.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Type d'absence */}
        <FormField
          control={form.control}
          name="type"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Type d'absence</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner le type" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="conges">Congé</SelectItem>
                  <SelectItem value="maladie">Maladie</SelectItem>
                  <SelectItem value="formation">Formation</SelectItem>
                  <SelectItem value="conge_maternite">Congé maternité</SelectItem>
                  <SelectItem value="autre">Autre</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        {/* Dates */}
        <FormField
          control={form.control}
          name="dateRange"
          render={({ field }) => (
            <FormItem className="flex flex-col">
              <FormLabel>Dates d'absence</FormLabel>
              <Popover>
                <PopoverTrigger asChild>
                  <FormControl>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full pl-3 text-left font-normal",
                        !field.value?.from && "text-muted-foreground"
                      )}
                    >
                      {field.value?.from ? (
                        field.value.to ? (
                          <>
                            Du {format(field.value.from, 'dd MMM yyyy', { locale: fr })} au{' '}
                            {format(field.value.to, 'dd MMM yyyy', { locale: fr })}
                          </>
                        ) : (
                          format(field.value.from, 'dd MMM yyyy', { locale: fr })
                        )
                      ) : (
                        <span>Sélectionner une période</span>
                      )}
                      <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                    </Button>
                  </FormControl>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="range"
                    selected={field.value as DateRange}
                    onSelect={field.onChange}
                    className="pointer-events-auto"
                    locale={fr}
                    numberOfMonths={2}
                  />
                </PopoverContent>
              </Popover>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Période */}
        <FormField
          control={form.control}
          name="demi_journee"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Période</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner la période" />
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

        {/* Motif */}
        <FormField
          control={form.control}
          name="motif"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Motif (optionnel)</FormLabel>
              <FormControl>
                <Textarea 
                  {...field} 
                  placeholder="Précisez le motif de l'absence"
                  rows={3}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end space-x-2 pt-4">
          <Button type="submit" disabled={loading}>
            {loading ? 'Enregistrement...' : absence ? 'Modifier' : 'Ajouter'}
          </Button>
        </div>
      </form>
    </Form>
  );
}
