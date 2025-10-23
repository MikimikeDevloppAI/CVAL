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
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

const absenceSchema = z.object({
  profile_type: z.enum(['medecin', 'secretaire']),
  person_id: z.string().min(1, 'La sélection d\'une personne est requise'),
  type: z.enum(['conges', 'maladie', 'formation', 'autre']),
  dates: z.array(z.date()).min(1, 'Sélectionnez au moins une date'),
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
      dates: absence?.date_debut ? (() => {
        const dates = [];
        const start = new Date(absence.date_debut);
        const end = new Date(absence.date_fin);
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          dates.push(new Date(d));
        }
        return dates;
      })() : [],
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
      // Trier les dates pour avoir date_debut et date_fin
      const sortedDates = [...data.dates].sort((a, b) => a.getTime() - b.getTime());
      
      const absenceData = {
        type_personne: data.profile_type,
        medecin_id: data.profile_type === 'medecin' ? data.person_id : null,
        secretaire_id: data.profile_type === 'secretaire' ? data.person_id : null,
        type: data.type,
        date_debut: format(sortedDates[0], 'yyyy-MM-dd'),
        date_fin: format(sortedDates[sortedDates.length - 1], 'yyyy-MM-dd'),
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
        const absences = sortedDates.map(date => ({
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
          name="dates"
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
                        !field.value?.length && "text-muted-foreground"
                      )}
                    >
                      {field.value?.length ? (
                        `${field.value.length} date${field.value.length > 1 ? 's' : ''} sélectionnée${field.value.length > 1 ? 's' : ''}`
                      ) : (
                        <span>Sélectionner des dates</span>
                      )}
                      <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                    </Button>
                  </FormControl>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="multiple"
                    selected={field.value}
                    onSelect={field.onChange}
                    className="pointer-events-auto"
                    locale={fr}
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
