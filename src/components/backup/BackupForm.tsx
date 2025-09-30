import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const backupSchema = z.object({
  first_name: z.string().min(1, 'Le prénom est requis'),
  name: z.string().min(1, 'Le nom est requis'),
  email: z.string().email('Email invalide'),
  phone_number: z.string().optional(),
  specialites: z.array(z.string()).default([]),
  actif: z.boolean().default(true),
});

type BackupFormData = z.infer<typeof backupSchema>;

interface Specialite {
  id: string;
  nom: string;
  code: string;
}

interface BackupFormProps {
  backup?: any;
  onSubmit: () => void;
  onCancel: () => void;
}

export const BackupForm = ({ backup, onSubmit, onCancel }: BackupFormProps) => {
  const [specialites, setSpecialites] = useState<Specialite[]>([]);
  const [loading, setLoading] = useState(false);

  const form = useForm<BackupFormData>({
    resolver: zodResolver(backupSchema),
    defaultValues: {
      first_name: backup?.first_name || '',
      name: backup?.name || '',
      email: backup?.email || '',
      phone_number: backup?.phone_number || '',
      specialites: backup?.specialites || [],
      actif: backup?.actif ?? true,
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
        toast.error('Erreur lors du chargement des spécialités');
      }
    };

    fetchSpecialites();
  }, []);

  const handleSubmit = async (data: BackupFormData) => {
    setLoading(true);
    try {
      if (backup) {
        // Mise à jour
        const { error } = await supabase
          .from('backup')
          .update(data)
          .eq('id', backup.id);

        if (error) throw error;
        toast.success('Backup mis à jour avec succès');
      } else {
        // Création
        const { error } = await supabase
          .from('backup')
          .insert([data]);

        if (error) throw error;
        toast.success('Backup créé avec succès');
      }

      onSubmit();
    } catch (error) {
      console.error('Erreur lors de la sauvegarde:', error);
      toast.error('Erreur lors de la sauvegarde');
    } finally {
      setLoading(false);
    }
  };

  const handleSpecialiteToggle = (specialiteId: string, checked: boolean) => {
    const currentSpecialites = form.getValues('specialites');
    if (checked) {
      form.setValue('specialites', [...currentSpecialites, specialiteId]);
    } else {
      form.setValue('specialites', currentSpecialites.filter(id => id !== specialiteId));
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="first_name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Prénom</FormLabel>
                <FormControl>
                  <Input {...field} />
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
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input type="email" {...field} />
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
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="actif"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start space-x-3 space-y-0">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
              <div className="space-y-1 leading-none">
                <FormLabel>Actif</FormLabel>
              </div>
            </FormItem>
          )}
        />

        <div>
          <Label className="text-base font-medium">Spécialités</Label>
          <div className="mt-2 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {specialites.map((specialite) => (
              <div key={specialite.id} className="flex items-center space-x-2">
                <Checkbox
                  id={specialite.id}
                  checked={form.watch('specialites').includes(specialite.id)}
                  onCheckedChange={(checked) => 
                    handleSpecialiteToggle(specialite.id, checked as boolean)
                  }
                />
                <Label htmlFor={specialite.id} className="text-sm font-normal">
                  {specialite.nom}
                </Label>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end space-x-4">
          <Button type="button" variant="outline" onClick={onCancel}>
            Annuler
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? 'Sauvegarde...' : backup ? 'Mettre à jour' : 'Créer'}
          </Button>
        </div>
      </form>
    </Form>
  );
};