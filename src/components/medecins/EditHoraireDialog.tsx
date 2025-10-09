import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

const horaireSchema = z.object({
  demiJournee: z.enum(['matin', 'apres_midi', 'toute_journee']),
  siteId: z.string().min(1, 'Site requis'),
  alternanceType: z.enum(['hebdomadaire', 'une_sur_deux', 'une_sur_trois', 'une_sur_quatre']).default('hebdomadaire'),
  alternanceSemaineReference: z.string().optional(),
  dateDebut: z.string().optional(),
  dateFin: z.string().optional(),
}).refine((data) => {
  if (data.dateDebut && data.dateFin) {
    return data.dateDebut <= data.dateFin;
  }
  return true;
}, {
  message: "La date de début doit être avant ou égale à la date de fin",
  path: ["dateDebut"],
});

type HoraireFormData = z.infer<typeof horaireSchema>;

interface Site {
  id: string;
  nom: string;
}

interface EditHoraireDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  medecinId: string;
  jour: number;
  horaire?: any;
  onSuccess: () => void;
}

const joursNoms = ['', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];

export function EditHoraireDialog({ open, onOpenChange, medecinId, jour, horaire, onSuccess }: EditHoraireDialogProps) {
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const form = useForm<HoraireFormData>({
    resolver: zodResolver(horaireSchema),
    defaultValues: {
      demiJournee: horaire?.demi_journee || 'toute_journee',
      siteId: horaire?.site_id || '',
      alternanceType: horaire?.alternance_type || 'hebdomadaire',
      alternanceSemaineReference: horaire?.alternance_semaine_reference || '',
      dateDebut: horaire?.date_debut || '',
      dateFin: horaire?.date_fin || '',
    },
  });

  useEffect(() => {
    const fetchSites = async () => {
      const { data } = await supabase.from('sites').select('id, nom').order('nom');
      if (data) setSites(data);
    };
    fetchSites();
  }, []);

  useEffect(() => {
    if (horaire) {
      form.reset({
        demiJournee: horaire.demi_journee || 'toute_journee',
        siteId: horaire.site_id || '',
        alternanceType: horaire.alternance_type || 'hebdomadaire',
        alternanceSemaineReference: horaire.alternance_semaine_reference || '',
        dateDebut: horaire.date_debut || '',
        dateFin: horaire.date_fin || '',
      });
    } else {
      form.reset({
        demiJournee: 'toute_journee',
        siteId: '',
        alternanceType: 'hebdomadaire',
        alternanceSemaineReference: '',
        dateDebut: '',
        dateFin: '',
      });
    }
  }, [horaire, form]);

  const onSubmit = async (data: HoraireFormData) => {
    setLoading(true);
    try {
      if (horaire) {
        // Modification
        const { error } = await supabase
          .from('horaires_base_medecins')
          .update({
            demi_journee: data.demiJournee,
            site_id: data.siteId,
            alternance_type: data.alternanceType,
            alternance_semaine_reference: data.alternanceSemaineReference || new Date().toISOString().split('T')[0],
            date_debut: data.dateDebut || null,
            date_fin: data.dateFin || null,
          })
          .eq('id', horaire.id);

        if (error) throw error;

        toast({
          title: "Succès",
          description: "Horaire modifié avec succès",
        });
      } else {
        // Création
        const { error } = await supabase
          .from('horaires_base_medecins')
          .insert({
            medecin_id: medecinId,
            jour_semaine: jour,
            demi_journee: data.demiJournee,
            site_id: data.siteId,
            alternance_type: data.alternanceType,
            alternance_semaine_reference: data.alternanceSemaineReference || new Date().toISOString().split('T')[0],
            date_debut: data.dateDebut || null,
            date_fin: data.dateFin || null,
            actif: true,
          });

        if (error) throw error;

        toast({
          title: "Succès",
          description: "Horaire créé avec succès",
        });
      }

      onSuccess();
      onOpenChange(false);
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

  const alternanceType = form.watch('alternanceType');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {horaire ? 'Modifier' : 'Ajouter'} un horaire - {joursNoms[jour]}
          </DialogTitle>
        </DialogHeader>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="demiJournee"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Période</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Sélectionner une période" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="matin">Matin</SelectItem>
                      <SelectItem value="apres_midi">Après-midi</SelectItem>
                      <SelectItem value="toute_journee">Toute la journée</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="siteId"
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

            <FormField
              control={form.control}
              name="alternanceType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Type d'alternance</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Toutes les semaines" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="hebdomadaire">Toutes les semaines</SelectItem>
                      <SelectItem value="une_sur_deux">Une semaine sur deux</SelectItem>
                      <SelectItem value="une_sur_trois">Une semaine sur trois</SelectItem>
                      <SelectItem value="une_sur_quatre">Une semaine sur quatre</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {alternanceType && alternanceType !== 'hebdomadaire' && (
              <FormField
                control={form.control}
                name="alternanceSemaineReference"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Semaine de référence</FormLabel>
                    <FormControl>
                      <Input {...field} type="date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="dateDebut"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date de début</FormLabel>
                    <FormControl>
                      <Input {...field} type="date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="dateFin"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date de fin</FormLabel>
                    <FormControl>
                      <Input {...field} type="date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="flex justify-end space-x-2 pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Annuler
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? 'Enregistrement...' : horaire ? 'Modifier' : 'Ajouter'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
