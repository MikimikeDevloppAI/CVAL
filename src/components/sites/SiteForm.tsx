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
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

const siteSchema = z.object({
  nom: z.string().trim().min(1, 'Le nom est requis').max(100, 'Le nom est trop long'),
  adresse: z.string().trim().min(1, 'L\'adresse est requise').max(255, 'L\'adresse est trop longue'),
  fermeture: z.boolean().default(false),
});

type SiteFormData = z.infer<typeof siteSchema>;

interface SiteFormProps {
  site?: any;
  onSuccess: () => void;
}

export function SiteForm({ site, onSuccess }: SiteFormProps) {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const form = useForm<SiteFormData>({
    resolver: zodResolver(siteSchema),
    defaultValues: {
      nom: site?.nom || '',
      adresse: site?.adresse || '',
      fermeture: site?.fermeture || false,
    },
  });

  const onSubmit = async (data: SiteFormData) => {
    setLoading(true);
    try {
      if (site) {
        // Modification
        const { error: siteError } = await supabase
          .from('sites')
          .update({
            nom: data.nom,
            adresse: data.adresse,
            fermeture: data.fermeture,
          })
          .eq('id', site.id);

        if (siteError) throw siteError;

        toast({
          title: "Succès",
          description: "Site modifié avec succès",
        });
      } else {
        // Création
        const { error: siteError } = await supabase
          .from('sites')
          .insert({
            nom: data.nom,
            adresse: data.adresse,
            fermeture: data.fermeture,
            actif: true, // Par défaut actif
          });

        if (siteError) throw siteError;

        toast({
          title: "Succès",
          description: "Site créé avec succès",
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
        {/* Nom */}
        <FormField
          control={form.control}
          name="nom"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nom du site</FormLabel>
              <FormControl>
                <Input {...field} placeholder="Nom du site" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Adresse */}
        <FormField
          control={form.control}
          name="adresse"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Adresse</FormLabel>
              <FormControl>
                <Textarea 
                  {...field} 
                  placeholder="Adresse complète du site"
                  rows={3}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Statut fermeture */}
        <FormField
          control={form.control}
          name="fermeture"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center space-x-3 space-y-0">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
              <div className="space-y-1 leading-none">
                <FormLabel>
                  Nécessite fermeture de site
                </FormLabel>
              </div>
            </FormItem>
          )}
        />

        <div className="flex justify-end space-x-2 pt-4">
          <Button type="submit" disabled={loading}>
            {loading ? 'Enregistrement...' : site ? 'Modifier' : 'Ajouter'}
          </Button>
        </div>
      </form>
    </Form>
  );
}