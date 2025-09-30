import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
  profile_id: z.string().min(1, 'La sélection d\'une personne est requise'),
  type: z.enum(['conges', 'maladie', 'formation', 'autre']),
  date_debut: z.date(),
  date_fin: z.date(),
  motif: z.string().optional(),
}).refine((data) => data.date_fin >= data.date_debut, {
  message: 'La date de fin doit être après la date de début',
  path: ['date_fin'],
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
      profile_type: 'medecin',
      profile_id: absence?.profile_id || '',
      type: absence?.type || 'conges',
      date_debut: absence?.date_debut ? new Date(absence.date_debut) : undefined,
      date_fin: absence?.date_fin ? new Date(absence.date_fin) : undefined,
      motif: absence?.motif || '',
    },
  });

  const profileType = form.watch('profile_type');

  useEffect(() => {
    const fetchProfiles = async () => {
      // Fetch medecins
      const { data: medecinData } = await supabase
        .from('medecins')
        .select('id, first_name, name, profile_id')
        .eq('actif', true)
        .order('name');
      
      setMedecins(medecinData || []);

      // Fetch secretaires
      const { data: secretaireData } = await supabase
        .from('secretaires')
        .select('id, first_name, name, profile_id')
        .eq('actif', true)
        .order('name');
      
      setSecretaires(secretaireData || []);
    };

    fetchProfiles();
  }, []);

  const onSubmit = async (data: AbsenceFormData) => {
    setLoading(true);
    try {
      const absenceData = {
        profile_id: data.profile_id,
        type: data.type,
        date_debut: format(data.date_debut, 'yyyy-MM-dd'),
        date_fin: format(data.date_fin, 'yyyy-MM-dd'),
        motif: data.motif || null,
        statut: 'en_attente' as const,
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
        // Création
        const { error } = await supabase
          .from('absences')
          .insert(absenceData);

        if (error) throw error;

        toast({
          title: "Succès",
          description: "Absence créée avec succès",
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
                  <SelectItem value="secretaire">Secrétaire</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Personne */}
        <FormField
          control={form.control}
          name="profile_id"
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
                    <SelectItem key={profile.id} value={profile.profile_id || profile.id}>
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

        {/* Date début */}
        <FormField
          control={form.control}
          name="date_debut"
          render={({ field }) => (
            <FormItem className="flex flex-col">
              <FormLabel>Date de début</FormLabel>
              <Popover>
                <PopoverTrigger asChild>
                  <FormControl>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full pl-3 text-left font-normal",
                        !field.value && "text-muted-foreground"
                      )}
                    >
                      {field.value ? (
                        format(field.value, "PPP", { locale: fr })
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
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Date fin */}
        <FormField
          control={form.control}
          name="date_fin"
          render={({ field }) => (
            <FormItem className="flex flex-col">
              <FormLabel>Date de fin</FormLabel>
              <Popover>
                <PopoverTrigger asChild>
                  <FormControl>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full pl-3 text-left font-normal",
                        !field.value && "text-muted-foreground"
                      )}
                    >
                      {field.value ? (
                        format(field.value, "PPP", { locale: fr })
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
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
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
