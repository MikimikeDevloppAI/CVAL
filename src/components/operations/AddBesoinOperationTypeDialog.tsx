import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

const besoinOperationSchema = z.object({
  nom: z.string().trim().min(1, 'Le nom est requis').max(100, 'Le nom est trop long'),
  code: z.string().trim().min(1, 'Le code est requis').max(50, 'Le code est trop long'),
  description: z.string().trim().max(500, 'La description est trop longue').optional(),
  categorie: z.string().trim().max(100, 'La catégorie est trop longue').optional(),
});

type BesoinOperationFormData = z.infer<typeof besoinOperationSchema>;

interface AddBesoinOperationTypeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export const AddBesoinOperationTypeDialog = ({
  open,
  onOpenChange,
  onSuccess
}: AddBesoinOperationTypeDialogProps) => {
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<BesoinOperationFormData>({
    resolver: zodResolver(besoinOperationSchema),
    defaultValues: {
      nom: '',
      code: '',
      description: '',
      categorie: '',
    },
  });

  const handleSubmit = async (data: BesoinOperationFormData) => {
    setSubmitting(true);
    try {
      const { error } = await supabase
        .from('besoins_operations')
        .insert({
          nom: data.nom,
          code: data.code,
          description: data.description || null,
          categorie: data.categorie || null,
          actif: true,
        });

      if (error) throw error;

      toast.success('Besoin opération créé avec succès');
      form.reset();
      onOpenChange(false);
      onSuccess();
    } catch (error: any) {
      console.error('Erreur lors de la création du besoin opération:', error);
      toast.error('Erreur lors de la création: ' + error.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Ajouter un besoin opération</DialogTitle>
          <DialogDescription>
            Créer un nouveau type de besoin opérationnel
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="nom"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nom *</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Ex: Infirmier instrumentiste" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Code *</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Ex: INST" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="categorie"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Catégorie</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Ex: Personnel de bloc" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea 
                      {...field} 
                      placeholder="Ex: Prépare et assiste le chirurgien pendant l'intervention"
                      rows={3}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => onOpenChange(false)} 
                disabled={submitting}
              >
                Annuler
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Créer
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
