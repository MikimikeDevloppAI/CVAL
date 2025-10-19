import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Medecin } from './useMedecins';

const medecinSchema = z.object({
  first_name: z.string().trim().min(1, 'Le prénom est requis').max(50, 'Le prénom est trop long'),
  name: z.string().trim().min(1, 'Le nom est requis').max(50, 'Le nom est trop long'),
  email: z.string().trim().max(255, 'Email trop long').refine((val) => !val || z.string().email().safeParse(val).success, {
    message: 'Email invalide'
  }),
  phone_number: z.string().optional(),
  specialiteId: z.string().min(1, 'La spécialité est requise'),
  besoin_secretaires: z.number().min(0, 'Le besoin doit être positif').max(10, 'Le besoin ne peut pas dépasser 10'),
});

type MedecinFormData = z.infer<typeof medecinSchema>;

interface Specialite {
  id: string;
  nom: string;
}

interface MedecinFormDialogProps {
  medecin?: Medecin | null;
  onSuccess: () => void;
  onBack: () => void;
}

export function MedecinFormDialog({ medecin, onSuccess, onBack }: MedecinFormDialogProps) {
  const [specialites, setSpecialites] = useState<Specialite[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const form = useForm<MedecinFormData>({
    resolver: zodResolver(medecinSchema),
    defaultValues: {
      first_name: medecin?.first_name || '',
      name: medecin?.name || '',
      email: medecin?.email || '',
      phone_number: medecin?.phone_number || '',
      specialiteId: medecin?.specialite_id || '',
      besoin_secretaires: medecin?.besoin_secretaires || 1.2,
    },
  });

  useEffect(() => {
    const fetchSpecialites = async () => {
      const { data } = await supabase
        .from('specialites')
        .select('id, nom')
        .order('nom');

      if (data) setSpecialites(data);
    };

    fetchSpecialites();
  }, []);

  const onSubmit = async (data: MedecinFormData) => {
    setLoading(true);
    try {
      if (medecin) {
        const { error } = await supabase
          .from('medecins')
          .update({
            first_name: data.first_name,
            name: data.name,
            email: data.email,
            phone_number: data.phone_number || null,
            specialite_id: data.specialiteId,
            besoin_secretaires: data.besoin_secretaires,
          })
          .eq('id', medecin.id);

        if (error) throw error;

        toast({
          title: "Succès",
          description: "Médecin modifié avec succès",
        });
      } else {
        const { error } = await supabase
          .from('medecins')
          .insert({
            first_name: data.first_name,
            name: data.name,
            email: data.email,
            phone_number: data.phone_number || null,
            specialite_id: data.specialiteId,
            besoin_secretaires: data.besoin_secretaires,
          });

        if (error) throw error;

        toast({
          title: "Succès",
          description: "Médecin créé avec succès",
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

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-4 pb-4 border-b border-border/50">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="hover:bg-cyan-500/10"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-xl font-semibold bg-gradient-to-r from-cyan-500 to-teal-600 bg-clip-text text-transparent">
          {medecin ? 'Modifier le médecin' : 'Ajouter un médecin'}
        </h2>
      </div>

      {/* Form */}
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="first_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Prénom</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Prénom du médecin" className="border-cyan-200/50 focus:border-cyan-500" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nom</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Nom du médecin" className="border-cyan-200/50 focus:border-cyan-500" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input {...field} type="email" placeholder="email@example.com" className="border-cyan-200/50 focus:border-cyan-500" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="phone_number"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Numéro de téléphone</FormLabel>
                  <FormControl>
                    <Input {...field} type="tel" placeholder="+33 1 23 45 67 89" className="border-cyan-200/50 focus:border-cyan-500" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="specialiteId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Spécialité</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="border-cyan-200/50 focus:border-cyan-500">
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
              name="besoin_secretaires"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Besoin en secrétaires</FormLabel>
                  <FormControl>
                    <Input 
                      {...field} 
                      type="number" 
                      step="0.1"
                      min="0"
                      max="10"
                      onChange={(e) => field.onChange(parseFloat(e.target.value))}
                      placeholder="1.2"
                      className="border-cyan-200/50 focus:border-cyan-500"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button 
              type="button" 
              variant="outline" 
              onClick={onBack}
              disabled={loading}
            >
              Annuler
            </Button>
            <Button 
              type="submit" 
              disabled={loading}
              className="bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-600 hover:to-teal-600"
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {loading ? 'Enregistrement...' : medecin ? 'Modifier' : 'Ajouter'}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
