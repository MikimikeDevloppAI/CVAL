import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

const besoinSchema = z.object({
  type: z.enum(['medecin', 'bloc_operatoire']),
  medecin_id: z.string().optional(),
  site_id: z.string().min(1, 'Site requis'),
  specialite_id: z.string().optional(),
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

type BesoinFormData = z.infer<typeof besoinSchema>;

interface AddBesoinDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: string;
  siteId: string;
  onSuccess: () => void;
}

export function AddBesoinDialog({ open, onOpenChange, date, siteId, onSuccess }: AddBesoinDialogProps) {
  const [sites, setSites] = useState<{ id: string; nom: string }[]>([]);
  const [specialites, setSpecialites] = useState<{ id: string; nom: string }[]>([]);
  const [medecins, setMedecins] = useState<{ id: string; first_name: string; name: string; specialite_id: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const form = useForm<BesoinFormData>({
    resolver: zodResolver(besoinSchema),
    defaultValues: {
      type: 'medecin',
      site_id: siteId,
      heure_debut: '07:30',
      heure_fin: '17:30',
      nombre_secretaires_requis: 1,
    },
  });

  const type = form.watch('type');
  const selectedMedecinId = form.watch('medecin_id');

  useEffect(() => {
    const fetchData = async () => {
      const [{ data: sitesData }, { data: specialitesData }, { data: medecinsData }] = await Promise.all([
        supabase.from('sites').select('id, nom').eq('actif', true).order('nom'),
        supabase.from('specialites').select('id, nom').order('nom'),
        supabase.from('medecins').select('id, first_name, name, specialite_id').eq('actif', true).order('name'),
      ]);
      
      setSites(sitesData || []);
      setSpecialites(specialitesData || []);
      setMedecins(medecinsData || []);
    };

    if (open) {
      fetchData();
      form.setValue('site_id', siteId);
    }
  }, [open, siteId, form]);

  // Auto-remplir la spécialité quand un médecin est sélectionné
  useEffect(() => {
    if (selectedMedecinId && type === 'medecin') {
      const medecin = medecins.find(m => m.id === selectedMedecinId);
      if (medecin) {
        form.setValue('specialite_id', medecin.specialite_id);
      }
    }
  }, [selectedMedecinId, medecins, type, form]);

  const handleSubmit = async (data: BesoinFormData) => {
    setLoading(true);
    try {
      if (data.type === 'bloc_operatoire') {
        // Pour le bloc opératoire, créer dans bloc_operatoire_besoins
        // Récupérer la spécialité si pas fournie
        let specialiteId = data.specialite_id;
        if (!specialiteId && specialites.length > 0) {
          specialiteId = specialites[0].id;
        }

        const { error } = await supabase
          .from('bloc_operatoire_besoins')
          .insert([{
            date,
            specialite_id: specialiteId,
            heure_debut: data.heure_debut,
            heure_fin: data.heure_fin,
            nombre_secretaires_requis: data.nombre_secretaires_requis,
            actif: true,
          }]);

        if (error) throw error;
      } else {
        // Pour les médecins, créer directement dans besoin_effectif
        // La spécialité vient du médecin sélectionné
        const medecin = medecins.find(m => m.id === data.medecin_id);
        
        const { error } = await supabase
          .from('besoin_effectif')
          .insert([{
            date,
            type: 'medecin',
            medecin_id: data.medecin_id,
            site_id: data.site_id,
            specialite_id: medecin?.specialite_id,
            heure_debut: data.heure_debut,
            heure_fin: data.heure_fin,
            nombre_secretaires_requis: data.nombre_secretaires_requis,
            actif: true,
          }]);

        if (error) throw error;
      }

      toast({
        title: "Succès",
        description: "Besoin ajouté avec succès",
      });

      onSuccess();
      onOpenChange(false);
      form.reset();
    } catch (error: any) {
      console.error('Erreur:', error);
      
      // Extraire le message d'erreur lisible
      let errorMessage = "Erreur lors de l'ajout du besoin";
      if (error?.message) {
        // Chercher si c'est une erreur de chevauchement
        if (error.message.includes('déjà attribué')) {
          errorMessage = error.message;
        }
      }
      
      toast({
        title: "Erreur",
        description: errorMessage,
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
          <DialogTitle>Ajouter un besoin</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="medecin">Médecin</SelectItem>
                      <SelectItem value="bloc_operatoire">Bloc opératoire</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {type === 'medecin' && (
              <>
                <FormField
                  control={form.control}
                  name="medecin_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Médecin</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Sélectionner un médecin" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {medecins.map((medecin) => (
                            <SelectItem key={medecin.id} value={medecin.id}>
                              {medecin.first_name} {medecin.name}
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
                  name="site_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Site</FormLabel>
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
              </>
            )}

            {type === 'bloc_operatoire' && (
              <FormField
                control={form.control}
                name="specialite_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Spécialité (optionnel)</FormLabel>
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
            )}

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
                {loading ? 'Ajout...' : 'Ajouter'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
