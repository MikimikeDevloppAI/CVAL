import { useState, useEffect } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

const horaireSchema = z.object({
  jour: z.number().min(1).max(7),
  jourTravaille: z.boolean().default(false),
  demiJournee: z.enum(['matin', 'apres_midi', 'toute_journee']).optional(),
  actif: z.boolean().default(true),
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

interface BesoinOperation {
  id: string;
  code: string;
  nom: string;
  categorie?: string;
}

interface BesoinOperationWithPreference {
  besoinId: string;
  preference: number | null;
}

const secretaireSchema = z.object({
  prenom: z.string().trim().min(1, 'Le prénom est requis').max(50, 'Le prénom est trop long'),
  nom: z.string().trim().min(1, 'Le nom est requis').max(50, 'Le nom est trop long'),
  email: z.preprocess(
    (val) => (typeof val === 'string' ? val.trim() : val),
    z.union([z.literal(''), z.string().email('Email invalide').max(255, 'Email trop long')])
  ).optional(),
  telephone: z.preprocess(
    (val) => (typeof val === 'string' ? val.trim() : val),
    z.union([z.literal(''), z.string().max(50, 'Le numéro de téléphone est trop long')])
  ).optional(),
  flexibleJoursSupplementaires: z.boolean().default(false),
  nombreJoursSupplementaires: z.number().min(1).max(7).optional(),
  horaireFlexible: z.boolean().default(false),
  pourcentageTemps: z.number().min(0.01).max(100).optional(),
  preferedAdmin: z.boolean().default(false),
  nombreDemiJourneesAdmin: z.number().min(1).max(10).optional(),
  besoinsOperations: z.array(z.object({
    besoinId: z.string(),
    preference: z.number().min(1).max(3).nullable(),
  })),
  horaires: z.array(horaireSchema),
}).refine((data) => {
  if (data.horaireFlexible && !data.pourcentageTemps) {
    return false;
  }
  return true;
}, {
  message: "Le pourcentage est requis pour un horaire flexible",
  path: ["pourcentageTemps"],
}).refine((data) => {
  if (data.preferedAdmin && !data.nombreDemiJourneesAdmin) {
    return false;
  }
  return true;
}, {
  message: "Le nombre de demi-journées admin est requis quand 'Préfère admin' est activé",
  path: ["nombreDemiJourneesAdmin"],
});

type SecretaireFormData = z.infer<typeof secretaireSchema>;

interface SecretaireFormProps {
  secretaire?: any;
  onSuccess: () => void;
}

export function SecretaireForm({ secretaire, onSuccess }: SecretaireFormProps) {
  const [loading, setLoading] = useState(false);
  const [besoinsOperations, setBesoinsOperations] = useState<BesoinOperation[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    fetchBesoinsOperations();
    if (secretaire) {
      fetchSecretaireBesoins();
    }
  }, [secretaire]);

  const fetchBesoinsOperations = async () => {
    try {
      const { data, error } = await supabase
        .from('besoins_operations')
        .select('*')
        .eq('actif', true)
        .order('categorie', { ascending: true })
        .order('nom', { ascending: true });

      if (error) throw error;
      setBesoinsOperations(data || []);
    } catch (error) {
      console.error('Erreur lors du chargement des besoins:', error);
    }
  };

  const fetchSecretaireBesoins = async () => {
    if (!secretaire?.id) return;
    
    try {
      const { data, error } = await supabase
        .from('secretaires_besoins_operations')
        .select('besoin_operation_id, preference')
        .eq('secretaire_id', secretaire.id);

      if (error) throw error;
      
      const besoinsWithPreferences = data?.map(b => ({
        besoinId: b.besoin_operation_id,
        preference: b.preference,
      })) || [];
      form.setValue('besoinsOperations', besoinsWithPreferences);
    } catch (error) {
      console.error('Erreur lors du chargement des besoins de la secrétaire:', error);
    }
  };

  const form = useForm<SecretaireFormData>({
    resolver: zodResolver(secretaireSchema),
    defaultValues: {
      prenom: secretaire?.first_name || secretaire?.profiles?.prenom || '',
      nom: secretaire?.name || secretaire?.profiles?.nom || '',
      email: secretaire?.email || secretaire?.profiles?.email || '',
      telephone: secretaire?.phone_number || '',
      flexibleJoursSupplementaires: secretaire?.flexible_jours_supplementaires || false,
      nombreJoursSupplementaires: secretaire?.nombre_jours_supplementaires || 1,
      horaireFlexible: secretaire?.horaire_flexible || false,
      pourcentageTemps: secretaire?.pourcentage_temps || undefined,
      preferedAdmin: secretaire?.prefered_admin || false,
      nombreDemiJourneesAdmin: secretaire?.nombre_demi_journees_admin || undefined,
      besoinsOperations: [],
      horaires: secretaire?.horaires || [
        { jour: 1, jourTravaille: false, demiJournee: 'toute_journee', actif: true },
        { jour: 2, jourTravaille: false, demiJournee: 'toute_journee', actif: true },
        { jour: 3, jourTravaille: false, demiJournee: 'toute_journee', actif: true },
        { jour: 4, jourTravaille: false, demiJournee: 'toute_journee', actif: true },
        { jour: 5, jourTravaille: false, demiJournee: 'toute_journee', actif: true },
      ],
    },
  });

  useEffect(() => {
    if (secretaire) {
      form.setValue('preferedAdmin', !!secretaire.prefered_admin);
    }
  }, [secretaire, form]);

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'horaires',
  });

  const onSubmit = async (data: SecretaireFormData) => {
    setLoading(true);
    try {
      if (secretaire) {
        // Modification - mettre à jour les données directement dans la table secretaires
        const { error: secretaireError } = await supabase
          .from('secretaires')
          .update({
            first_name: data.prenom,
            name: data.nom,
            email: data.email?.trim() || null,
            phone_number: data.telephone?.trim() || null,
            flexible_jours_supplementaires: data.flexibleJoursSupplementaires,
            nombre_jours_supplementaires: data.flexibleJoursSupplementaires ? data.nombreJoursSupplementaires : null,
            horaire_flexible: data.horaireFlexible,
            pourcentage_temps: data.horaireFlexible ? data.pourcentageTemps : null,
            prefered_admin: data.preferedAdmin,
            nombre_demi_journees_admin: data.preferedAdmin ? data.nombreDemiJourneesAdmin : null,
          })
          .eq('id', secretaire.id);

        if (secretaireError) throw secretaireError;

        // Mettre à jour les besoins opérationnels
        await supabase
          .from('secretaires_besoins_operations')
          .delete()
          .eq('secretaire_id', secretaire.id);

        if (data.besoinsOperations.length > 0) {
          const besoinsData = data.besoinsOperations.map(besoin => ({
            secretaire_id: secretaire.id,
            besoin_operation_id: besoin.besoinId,
            preference: besoin.preference,
          }));

          const { error: besoinsError } = await supabase
            .from('secretaires_besoins_operations')
            .insert(besoinsData);

          if (besoinsError) throw besoinsError;
        }

        // Mettre à jour les horaires
        await supabase
          .from('horaires_base_secretaires')
          .delete()
          .eq('secretaire_id', secretaire.id);

        const horairesActifs = data.horaires.filter(horaire => 
          horaire.jourTravaille && horaire.demiJournee
        );

        if (horairesActifs.length > 0) {
          const horairesData = horairesActifs.map(horaire => ({
            secretaire_id: secretaire.id,
            jour_semaine: horaire.jour,
            demi_journee: horaire.demiJournee,
            actif: horaire.actif,
            date_debut: horaire.dateDebut || null,
            date_fin: horaire.dateFin || null,
          }));

          const { error: horairesError } = await supabase
            .from('horaires_base_secretaires')
            .insert(horairesData);

          if (horairesError) throw horairesError;
        }

        toast({
          title: "Succès",
          description: "Secrétaire modifié avec succès",
        });
      } else {
        // Création
        const { data: secretaireData, error: secretaireError } = await supabase
          .from('secretaires')
          .insert({
            first_name: data.prenom,
            name: data.nom,
            email: data.email?.trim() || null,
            phone_number: data.telephone?.trim() || null,
            profile_id: null,
            flexible_jours_supplementaires: data.flexibleJoursSupplementaires,
            nombre_jours_supplementaires: data.flexibleJoursSupplementaires ? data.nombreJoursSupplementaires : null,
            horaire_flexible: data.horaireFlexible,
            pourcentage_temps: data.horaireFlexible ? data.pourcentageTemps : null,
            prefered_admin: data.preferedAdmin,
            nombre_demi_journees_admin: data.preferedAdmin ? data.nombreDemiJourneesAdmin : null,
          })
          .select()
          .single();

        if (secretaireError) throw secretaireError;

        if (secretaireData) {
          // Créer les besoins opérationnels
          if (data.besoinsOperations.length > 0) {
            const besoinsData = data.besoinsOperations.map(besoin => ({
              secretaire_id: secretaireData.id,
              besoin_operation_id: besoin.besoinId,
              preference: besoin.preference,
            }));

            const { error: besoinsError } = await supabase
              .from('secretaires_besoins_operations')
              .insert(besoinsData);

            if (besoinsError) throw besoinsError;
          }

          // Créer les horaires
          const horairesActifs = data.horaires.filter(horaire => 
            horaire.jourTravaille && horaire.demiJournee
          );

          if (horairesActifs.length > 0) {
            const horairesData = horairesActifs.map(horaire => ({
              secretaire_id: secretaireData.id,
              jour_semaine: horaire.jour,
              demi_journee: horaire.demiJournee,
              actif: horaire.actif,
              date_debut: horaire.dateDebut || null,
              date_fin: horaire.dateFin || null,
            }));

            const { error: horairesError } = await supabase
              .from('horaires_base_secretaires')
              .insert(horairesData);

            if (horairesError) throw horairesError;
          }
        }

        toast({
          title: "Succès",
          description: "Secrétaire créé avec succès",
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

  const onInvalid = (errors: any) => {
    const first = errors && (Object.values(errors)[0] as any);
    toast({
      title: 'Validation',
      description: first?.message || 'Veuillez corriger les champs en erreur.',
      variant: 'destructive',
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit, onInvalid)} className="space-y-4">
        {/* Prénom et Nom */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="prenom"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Prénom</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="Prénom du secrétaire" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="nom"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nom</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="Nom du secrétaire" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Email et Téléphone */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
            name="telephone"
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
        </div>

        {/* Horaire flexible */}
        <div className="space-y-4 pt-4 border-t">
          <h3 className="text-sm font-medium">Configuration horaire</h3>
          
          <div className="space-y-4">
            <FormField
              control={form.control}
              name="horaireFlexible"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={(checked) => {
                        field.onChange(checked === true);
                        if (!checked) {
                          form.setValue('pourcentageTemps', undefined);
                        }
                      }}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Horaire flexible</FormLabel>
                  </div>
                </FormItem>
              )}
            />

            {form.watch('horaireFlexible') && (
              <FormField
                control={form.control}
                name="pourcentageTemps"
                render={({ field }) => (
                  <FormItem className="max-w-xs">
                    <FormLabel>Pourcentage de temps (%)</FormLabel>
                    <FormControl>
                      <Input 
                        {...field} 
                        type="number" 
                        min="0.01"
                        max="100"
                        step="0.01"
                        placeholder="80" 
                        onChange={(e) => field.onChange(parseFloat(e.target.value))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="preferedAdmin"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={(checked) => {
                        field.onChange(checked === true);
                        if (!checked) {
                          form.setValue('nombreDemiJourneesAdmin', undefined);
                        }
                      }}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Préfère admin</FormLabel>
                  </div>
                </FormItem>
              )}
            />

            {form.watch('preferedAdmin') && (
              <FormField
                control={form.control}
                name="nombreDemiJourneesAdmin"
                render={({ field }) => (
                  <FormItem className="max-w-xs ml-6">
                    <FormLabel>Nombre de demi-journées admin souhaitées</FormLabel>
                    <FormControl>
                      <Input 
                        {...field} 
                        type="number" 
                        min="1"
                        max="10"
                        placeholder="5" 
                        value={field.value || ''}
                        onChange={(e) => {
                          const value = e.target.value;
                          field.onChange(value ? parseInt(value) : undefined);
                        }}
                      />
                    </FormControl>
                    <FormDescription>
                      Entre 1 et 10 demi-journées administratives par semaine
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
          </div>
        </div>
        <Button type="submit" disabled={loading} className="w-full">
          {loading ? 'Enregistrement...' : (secretaire ? 'Modifier' : 'Créer')}
        </Button>
      </form>
    </Form>
  );
}
