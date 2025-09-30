import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

const editCapaciteSchema = z.object({
  heure_debut: z.string().min(1, 'Heure de début requise'),
  heure_fin: z.string().min(1, 'Heure de fin requise'),
  specialites: z.array(z.string()).min(1, 'Au moins une spécialité requise'),
}).refine((data) => {
  if (data.heure_debut && data.heure_fin) {
    return data.heure_debut < data.heure_fin;
  }
  return true;
}, {
  message: "L'heure de début doit être avant l'heure de fin",
  path: ["heure_debut"],
});

type EditCapaciteFormData = z.infer<typeof editCapaciteSchema>;

interface EditCapaciteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  capacite: {
    id: string;
    heure_debut: string;
    heure_fin: string;
    specialites: string[];
  } | null;
  onSuccess: () => void;
}

export function EditCapaciteDialog({ open, onOpenChange, capacite, onSuccess }: EditCapaciteDialogProps) {
  const [loading, setLoading] = useState(false);
  const [specialites, setSpecialites] = useState<{ id: string; nom: string }[]>([]);
  const { toast } = useToast();

  const form = useForm<EditCapaciteFormData>({
    resolver: zodResolver(editCapaciteSchema),
    defaultValues: {
      heure_debut: capacite?.heure_debut || '07:30',
      heure_fin: capacite?.heure_fin || '17:30',
      specialites: capacite?.specialites || [],
    },
  });

  useEffect(() => {
    const fetchSpecialites = async () => {
      const { data } = await supabase
        .from('specialites')
        .select('id, nom')
        .order('nom');
      
      setSpecialites(data || []);
    };

    if (open) {
      fetchSpecialites();
    }
  }, [open]);

  useEffect(() => {
    if (capacite) {
      form.reset({
        heure_debut: capacite.heure_debut,
        heure_fin: capacite.heure_fin,
        specialites: capacite.specialites,
      });
    }
  }, [capacite, form]);

  const handleSubmit = async (data: EditCapaciteFormData) => {
    if (!capacite) return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from('capacite_effective')
        .update({
          heure_debut: data.heure_debut,
          heure_fin: data.heure_fin,
          specialites: data.specialites,
        })
        .eq('id', capacite.id);

      if (error) throw error;

      toast({
        title: "Succès",
        description: "Capacité modifiée avec succès",
      });

      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Erreur:', error);
      toast({
        title: "Erreur",
        description: error?.message || "Erreur lors de la modification",
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
          <DialogTitle>Modifier la capacité</DialogTitle>
          <DialogDescription>
            Modifiez les horaires et les spécialités
          </DialogDescription>
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
              name="specialites"
              render={() => (
                <FormItem>
                  <FormLabel>Spécialités *</FormLabel>
                  <div className="border rounded-lg p-3 space-y-2 max-h-40 overflow-y-auto">
                    {specialites.map((spec) => (
                      <FormField
                        key={spec.id}
                        control={form.control}
                        name="specialites"
                        render={({ field }) => (
                          <FormItem className="flex items-center space-x-2 space-y-0">
                            <FormControl>
                              <Checkbox
                                checked={field.value?.includes(spec.id)}
                                onCheckedChange={(checked) => {
                                  return checked
                                    ? field.onChange([...field.value, spec.id])
                                    : field.onChange(field.value?.filter((value) => value !== spec.id));
                                }}
                              />
                            </FormControl>
                            <FormLabel className="font-normal cursor-pointer">
                              {spec.nom}
                            </FormLabel>
                          </FormItem>
                        )}
                      />
                    ))}
                  </div>
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