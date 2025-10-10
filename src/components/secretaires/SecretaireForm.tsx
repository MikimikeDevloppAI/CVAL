import { useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
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
  preferePortEnTruie: z.boolean().default(false),
  flexibleJoursSupplementaires: z.boolean().default(false),
  nombreJoursSupplementaires: z.number().min(1).max(7).optional(),
  personnelBlocOperatoire: z.boolean().default(false),
  assignationAdministrative: z.boolean().default(false),
  anesthesiste: z.boolean().default(false),
  instrumentaliste: z.boolean().default(false),
  aideDeSalle: z.boolean().default(false),
  blocOphtalmoAccueil: z.boolean().default(false),
  blocDermatoAccueil: z.boolean().default(false),
  horaires: z.array(horaireSchema),
});

type SecretaireFormData = z.infer<typeof secretaireSchema>;

interface SecretaireFormProps {
  secretaire?: any;
  onSuccess: () => void;
}

export function SecretaireForm({ secretaire, onSuccess }: SecretaireFormProps) {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const form = useForm<SecretaireFormData>({
    resolver: zodResolver(secretaireSchema),
    defaultValues: {
      prenom: secretaire?.first_name || secretaire?.profiles?.prenom || '',
      nom: secretaire?.name || secretaire?.profiles?.nom || '',
      email: secretaire?.email || secretaire?.profiles?.email || '',
      telephone: secretaire?.phone_number || '',
      preferePortEnTruie: secretaire?.prefere_port_en_truie || false,
      flexibleJoursSupplementaires: secretaire?.flexible_jours_supplementaires || false,
      nombreJoursSupplementaires: secretaire?.nombre_jours_supplementaires || 1,
      personnelBlocOperatoire: secretaire?.personnel_bloc_operatoire || false,
      assignationAdministrative: secretaire?.assignation_administrative || false,
      anesthesiste: secretaire?.anesthesiste || false,
      instrumentaliste: secretaire?.instrumentaliste || false,
      aideDeSalle: secretaire?.aide_de_salle || false,
      blocOphtalmoAccueil: secretaire?.bloc_ophtalmo_accueil || false,
      blocDermatoAccueil: secretaire?.bloc_dermato_accueil || false,
      horaires: secretaire?.horaires || [
        { jour: 1, jourTravaille: false, demiJournee: 'toute_journee', actif: true },
        { jour: 2, jourTravaille: false, demiJournee: 'toute_journee', actif: true },
        { jour: 3, jourTravaille: false, demiJournee: 'toute_journee', actif: true },
        { jour: 4, jourTravaille: false, demiJournee: 'toute_journee', actif: true },
        { jour: 5, jourTravaille: false, demiJournee: 'toute_journee', actif: true },
      ],
    },
  });

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
            prefere_port_en_truie: data.preferePortEnTruie,
            flexible_jours_supplementaires: data.flexibleJoursSupplementaires,
            nombre_jours_supplementaires: data.flexibleJoursSupplementaires ? data.nombreJoursSupplementaires : null,
            personnel_bloc_operatoire: data.personnelBlocOperatoire,
            assignation_administrative: data.assignationAdministrative,
            anesthesiste: data.anesthesiste,
            instrumentaliste: data.instrumentaliste,
            aide_de_salle: data.aideDeSalle,
            bloc_ophtalmo_accueil: data.blocOphtalmoAccueil,
            bloc_dermato_accueil: data.blocDermatoAccueil,
          })
          .eq('id', secretaire.id);

        if (secretaireError) throw secretaireError;

        // Mettre à jour les horaires
        // D'abord supprimer les anciens horaires (triggers géreront capacite_effective)
        await supabase
          .from('horaires_base_secretaires')
          .delete()
          .eq('secretaire_id', secretaire.id);

        // Puis insérer les nouveaux horaires actifs (triggers créeront capacite_effective)
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
        // Création sans profil associé - sites_assignes et medecin seront gérés via QuickEdit dialogs
        const { data: secretaireData, error: secretaireError } = await supabase
          .from('secretaires')
          .insert({
            first_name: data.prenom,
            name: data.nom,
            email: data.email?.trim() || null,
            phone_number: data.telephone?.trim() || null,
            profile_id: null,
            sites_assignes: [],
            medecin_assigne_id: null,
            prefere_port_en_truie: data.preferePortEnTruie,
            flexible_jours_supplementaires: data.flexibleJoursSupplementaires,
            nombre_jours_supplementaires: data.flexibleJoursSupplementaires ? data.nombreJoursSupplementaires : null,
            personnel_bloc_operatoire: data.personnelBlocOperatoire,
            assignation_administrative: data.assignationAdministrative,
            anesthesiste: data.anesthesiste,
            instrumentaliste: data.instrumentaliste,
            aide_de_salle: data.aideDeSalle,
            bloc_ophtalmo_accueil: data.blocOphtalmoAccueil,
            bloc_dermato_accueil: data.blocDermatoAccueil,
          })
          .select()
          .single();

        if (secretaireError) throw secretaireError;

        // Créer les horaires (triggers créeront automatiquement capacite_effective)
        if (secretaireData) {
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
        {/* Prénom et Nom côte à côte */}
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

        {/* Email et Téléphone côte à côte */}
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

        {/* Préférences */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="preferePortEnTruie"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                  />
                </FormControl>
                <div className="space-y-1 leading-none">
                  <FormLabel>
                    Préfère travailler à Port-en-truie
                  </FormLabel>
                </div>
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="flexibleJoursSupplementaires"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center space-x-3 space-y-0">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={(checked) => field.onChange(checked === true)}
                />
              </FormControl>
              <div className="space-y-1 leading-none">
                <FormLabel>
                  Disponible pour des jours supplémentaires au besoin
                </FormLabel>
              </div>
            </FormItem>
          )}
        />

        {form.watch('flexibleJoursSupplementaires') && (
          <FormField
            control={form.control}
            name="nombreJoursSupplementaires"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nombre de jours supplémentaires maximum</FormLabel>
                <FormControl>
                  <Input 
                    {...field} 
                    type="number" 
                    min="1" 
                    max="7" 
                    placeholder="1"
                    onChange={(e) => field.onChange(parseInt(e.target.value) || 1)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {/* Caractéristiques professionnelles */}
        <div className="space-y-4 pt-4 border-t">
          <h3 className="text-sm font-medium">Caractéristiques professionnelles</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="personnelBlocOperatoire"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={(checked) => field.onChange(checked === true)}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Personnel bloc opératoire</FormLabel>
                  </div>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="assignationAdministrative"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={(checked) => field.onChange(checked === true)}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Assignation administrative</FormLabel>
                  </div>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="anesthesiste"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={(checked) => field.onChange(checked === true)}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Anesthésiste</FormLabel>
                  </div>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="instrumentaliste"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={(checked) => field.onChange(checked === true)}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Instrumentaliste</FormLabel>
                  </div>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="aideDeSalle"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={(checked) => field.onChange(checked === true)}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Aide de salle</FormLabel>
                  </div>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="blocOphtalmoAccueil"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={(checked) => field.onChange(checked === true)}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Bloc opératoire Ophtalmologie Accueil</FormLabel>
                  </div>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="blocDermatoAccueil"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={(checked) => field.onChange(checked === true)}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Bloc opératoire Dermatologie Accueil</FormLabel>
                  </div>
                </FormItem>
              )}
            />
          </div>
        </div>

        <div className="flex justify-end space-x-2 pt-4">
          <Button type="submit" disabled={loading}>
            {loading ? 'Enregistrement...' : secretaire ? 'Modifier' : 'Ajouter'}
          </Button>
        </div>
      </form>
    </Form>
  );
}
