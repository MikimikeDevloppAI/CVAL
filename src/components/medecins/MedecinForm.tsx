import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

const medecinSchema = z.object({
  first_name: z.string().trim().min(1, 'Le prénom est requis').max(50, 'Le prénom est trop long'),
  name: z.string().trim().min(1, 'Le nom est requis').max(50, 'Le nom est trop long'),
  email: z.string().trim().email('Email invalide').max(255, 'Email trop long'),
  phone_number: z.string().optional(),
  specialiteId: z.string().min(1, 'La spécialité est requise'),
  sitePreferentielId: z.string().optional(),
});

type MedecinFormData = z.infer<typeof medecinSchema>;

interface Specialite {
  id: string;
  nom: string;
}

interface Site {
  id: string;
  nom: string;
}

interface MedecinFormProps {
  medecin?: any;
  onSuccess: () => void;
}

export function MedecinForm({ medecin, onSuccess }: MedecinFormProps) {
  const [specialites, setSpecialites] = useState<Specialite[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
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
      sitePreferentielId: medecin?.site_preferentiel_id || '',
    },
  });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [specialitesRes, sitesRes] = await Promise.all([
          supabase.from('specialites').select('id, nom').order('nom'),
          supabase.from('sites').select('id, nom').order('nom')
        ]);

        if (specialitesRes.data) setSpecialites(specialitesRes.data);
        if (sitesRes.data) setSites(sitesRes.data);
      } catch (error) {
        console.error('Erreur lors du chargement des données:', error);
      }
    };

    fetchData();
  }, []);

  const onSubmit = async (data: MedecinFormData) => {
    setLoading(true);
    try {
      if (medecin) {
        // Modification
        const { error: medecinError } = await supabase
          .from('medecins')
          .update({
            first_name: data.first_name,
            name: data.name,
            email: data.email,
            phone_number: data.phone_number || null,
            specialite_id: data.specialiteId,
            site_preferentiel_id: data.sitePreferentielId || null,
          })
          .eq('id', medecin.id);

        if (medecinError) throw medecinError;

        toast({
          title: "Succès",
          description: "Médecin modifié avec succès",
        });
      } else {
        // Création
        const { error: medecinError } = await supabase
          .from('medecins')
          .insert({
            first_name: data.first_name,
            name: data.name,
            email: data.email,
            phone_number: data.phone_number || null,
            specialite_id: data.specialiteId,
            site_preferentiel_id: data.sitePreferentielId || null,
          });

        if (medecinError) throw medecinError;

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
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="first_name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Prénom</FormLabel>
              <FormControl>
                <Input {...field} placeholder="Prénom du médecin" />
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
                <Input {...field} placeholder="Nom du médecin" />
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
                <Input {...field} type="email" placeholder="email@example.com" />
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
                <Input {...field} type="tel" placeholder="+33 1 23 45 67 89" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="specialiteId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Spécialité</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
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
          name="sitePreferentielId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Site préférentiel (optionnel)</FormLabel>
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

        <div className="flex justify-end space-x-2 pt-4">
          <Button type="submit" disabled={loading}>
            {loading ? 'Enregistrement...' : medecin ? 'Modifier' : 'Ajouter'}
          </Button>
        </div>
      </form>
    </Form>
  );
}