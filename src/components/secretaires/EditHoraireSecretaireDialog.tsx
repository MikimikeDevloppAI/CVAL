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
  siteId: z.string(),
  dateDebut: z.string().optional(),
  dateFin: z.string().optional(),
  alternanceType: z.enum(['hebdomadaire', 'une_sur_deux', 'une_sur_trois', 'une_sur_quatre']),
  alternanceSemaineModulo: z.number().int().min(0).max(3),
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

interface EditHoraireSecretaireDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  secretaireId: string;
  jour: number;
  horaire?: any;
  onSuccess: () => void;
}

const joursNoms = ['', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];

export function EditHoraireSecretaireDialog({ 
  open, 
  onOpenChange, 
  secretaireId, 
  jour, 
  horaire, 
  onSuccess 
}: EditHoraireSecretaireDialogProps) {
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const form = useForm<HoraireFormData>({
    resolver: zodResolver(horaireSchema),
    defaultValues: {
      demiJournee: horaire?.demi_journee || 'toute_journee',
      siteId: horaire?.site_id || 'none',
      dateDebut: horaire?.date_debut || '',
      dateFin: horaire?.date_fin || '',
      alternanceType: horaire?.alternance_type || 'hebdomadaire',
      alternanceSemaineModulo: horaire?.alternance_semaine_modulo ?? 0,
    },
  });

  useEffect(() => {
    const fetchSites = async () => {
      const { data } = await supabase.from('sites').select('id, nom').eq('actif', true).not('nom', 'ilike', '%bloc opératoire%').order('nom');
      if (data) setSites(data);
    };
    fetchSites();
  }, []);

  useEffect(() => {
    if (horaire) {
      form.reset({
        demiJournee: horaire.demi_journee || 'toute_journee',
        siteId: horaire.site_id || 'none',
        dateDebut: horaire.date_debut || '',
        dateFin: horaire.date_fin || '',
        alternanceType: horaire.alternance_type || 'hebdomadaire',
        alternanceSemaineModulo: horaire.alternance_semaine_modulo ?? 0,
      });
    } else {
      form.reset({
        demiJournee: 'toute_journee',
        siteId: 'none',
        dateDebut: '',
        dateFin: '',
        alternanceType: 'hebdomadaire',
        alternanceSemaineModulo: 0,
      });
    }
  }, [horaire, form]);

  const onSubmit = async (data: HoraireFormData) => {
    setLoading(true);
    try {
      // Vérification des chevauchements
      const { data: existing, error: checkError } = await supabase
        .from('horaires_base_secretaires')
        .select('*')
        .eq('secretaire_id', secretaireId)
        .eq('jour_semaine', jour)
        .eq('actif', true)
        .neq('id', horaire?.id || '00000000-0000-0000-0000-000000000000');

      if (checkError) throw checkError;

      if (existing && existing.length > 0) {
        // Vérifier les chevauchements de périodes
        for (const existingHoraire of existing) {
          const periodsOverlap = 
            data.demiJournee === 'toute_journee' ||
            existingHoraire.demi_journee === 'toute_journee' ||
            data.demiJournee === existingHoraire.demi_journee;

          if (periodsOverlap) {
            // Vérifier chevauchement de dates
            const newStart = data.dateDebut || '1900-01-01';
            const newEnd = data.dateFin || '2100-12-31';
            const existingStart = existingHoraire.date_debut || '1900-01-01';
            const existingEnd = existingHoraire.date_fin || '2100-12-31';

            const datesOverlap = newStart <= existingEnd && newEnd >= existingStart;

            if (datesOverlap) {
              toast({
                title: "Conflit détecté",
                description: "Un horaire existe déjà pour ce jour avec la même période",
                variant: "destructive",
              });
              setLoading(false);
              return;
            }
          }
        }
      }

      if (horaire) {
        // Modification
        const { error } = await supabase
          .from('horaires_base_secretaires')
          .update({
            demi_journee: data.demiJournee,
            site_id: data.siteId === 'none' ? null : data.siteId,
            date_debut: data.dateDebut || null,
            date_fin: data.dateFin || null,
            alternance_type: data.alternanceType,
            alternance_semaine_modulo: data.alternanceSemaineModulo,
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
          .from('horaires_base_secretaires')
          .insert({
            secretaire_id: secretaireId,
            jour_semaine: jour,
            demi_journee: data.demiJournee,
            site_id: data.siteId === 'none' ? null : data.siteId,
            date_debut: data.dateDebut || null,
            date_fin: data.dateFin || null,
            alternance_type: data.alternanceType,
            alternance_semaine_modulo: data.alternanceSemaineModulo,
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
                  <FormLabel>Site (optionnel)</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Aucun site spécifique" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="none">Aucun site spécifique</SelectItem>
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

            <FormField
              control={form.control}
              name="alternanceType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Type d'alternance</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Sélectionner le type" />
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

            {alternanceType !== 'hebdomadaire' && (
              <FormField
                control={form.control}
                name="alternanceSemaineModulo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {alternanceType === 'une_sur_deux' && 'Semaine'}
                      {alternanceType === 'une_sur_trois' && 'Semaine dans le cycle'}
                      {alternanceType === 'une_sur_quatre' && 'Semaine dans le cycle'}
                    </FormLabel>
                    <Select 
                      onValueChange={(value) => field.onChange(parseInt(value))} 
                      value={field.value?.toString()}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Sélectionner" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {alternanceType === 'une_sur_deux' && (
                          <>
                            <SelectItem value="0">Paire (2, 4, 6...)</SelectItem>
                            <SelectItem value="1">Impaire (1, 3, 5...)</SelectItem>
                          </>
                        )}
                        {alternanceType === 'une_sur_trois' && (
                          <>
                            <SelectItem value="0">Semaine 1 (1, 4, 7...)</SelectItem>
                            <SelectItem value="1">Semaine 2 (2, 5, 8...)</SelectItem>
                            <SelectItem value="2">Semaine 3 (3, 6, 9...)</SelectItem>
                          </>
                        )}
                        {alternanceType === 'une_sur_quatre' && (
                          <>
                            <SelectItem value="0">Semaine 1 (1, 5, 9...)</SelectItem>
                            <SelectItem value="1">Semaine 2 (2, 6, 10...)</SelectItem>
                            <SelectItem value="2">Semaine 3 (3, 7, 11...)</SelectItem>
                            <SelectItem value="3">Semaine 4 (4, 8, 12...)</SelectItem>
                          </>
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

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