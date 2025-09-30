import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

const editBesoinSchema = z.object({
  heure_debut: z.string().min(1, 'Heure de début requise'),
  heure_fin: z.string().min(1, 'Heure de fin requise'),
  nombre_secretaires_requis: z.number().min(0).max(10),
}).refine((data) => {
  if (data.heure_debut && data.heure_fin) {
    return data.heure_debut < data.heure_fin;
  }
  return true;
}, {
  message: "L'heure de début doit être avant l'heure de fin",
  path: ["heure_debut"],
});

type EditBesoinFormData = z.infer<typeof editBesoinSchema>;

interface EditBesoinDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  besoin: {
    id: string;
    type: string;
    heure_debut: string;
    heure_fin: string;
    nombre_secretaires_requis: number;
    bloc_operatoire_besoin_id?: string;
  } | null;
  onSuccess: () => void;
}

export function EditBesoinDialog({ open, onOpenChange, besoin, onSuccess }: EditBesoinDialogProps) {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const form = useForm<EditBesoinFormData>({
    resolver: zodResolver(editBesoinSchema),
    defaultValues: {
      heure_debut: besoin?.heure_debut || '07:30',
      heure_fin: besoin?.heure_fin || '17:30',
      nombre_secretaires_requis: besoin?.nombre_secretaires_requis || 1,
    },
  });

  useEffect(() => {
    if (besoin) {
      form.reset({
        heure_debut: besoin.heure_debut,
        heure_fin: besoin.heure_fin,
        nombre_secretaires_requis: besoin.nombre_secretaires_requis,
      });
    }
  }, [besoin, form]);

  const handleSubmit = async (data: EditBesoinFormData) => {
    if (!besoin) return;

    setLoading(true);
    try {
      if (besoin.type === 'bloc_operatoire' && besoin.bloc_operatoire_besoin_id) {
        // Pour le bloc opératoire, modifier dans bloc_operatoire_besoins
        const { error } = await supabase
          .from('bloc_operatoire_besoins')
          .update({
            heure_debut: data.heure_debut,
            heure_fin: data.heure_fin,
            nombre_secretaires_requis: data.nombre_secretaires_requis,
          })
          .eq('id', besoin.bloc_operatoire_besoin_id);

        if (error) throw error;
      } else {
        // Pour les médecins, modifier directement dans besoin_effectif
        const { error } = await supabase
          .from('besoin_effectif')
          .update({
            heure_debut: data.heure_debut,
            heure_fin: data.heure_fin,
            nombre_secretaires_requis: data.nombre_secretaires_requis,
          })
          .eq('id', besoin.id);

        if (error) throw error;
      }

      toast({
        title: "Succès",
        description: "Besoin modifié avec succès",
      });

      onSuccess();
      onOpenChange(false);
    } catch (error) {
      console.error('Erreur:', error);
      toast({
        title: "Erreur",
        description: "Erreur lors de la modification du besoin",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Modifier le besoin</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="heure_debut"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Heure de début</FormLabel>
                    <FormControl>
                      <Input {...field} type="time" />
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
                      <Input {...field} type="time" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="nombre_secretaires_requis"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre de secrétaires requis</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="number"
                      min={0}
                      max={10}
                      step={0.1}
                      onChange={(e) => field.onChange(parseFloat(e.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Annuler
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? 'Modification...' : 'Modifier'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
