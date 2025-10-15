import { useState, useEffect } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { MultiSelect } from '@/components/ui/multi-select';
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
  horaireFlexible: z.boolean().default(false),
  pourcentageTemps: z.number().min(0.01).max(100).optional(),
  personnelBlocOperatoire: z.boolean().default(false),
  assignationAdministrative: z.boolean().default(false),
  anesthesiste: z.boolean().default(false),
  instrumentaliste: z.boolean().default(false),
  aideDeSalle: z.boolean().default(false),
  blocOphtalmoAccueil: z.boolean().default(false),
  blocDermatoAccueil: z.boolean().default(false),
  sitesPriorite1: z.array(z.string()).default([]),
  sitesPriorite2: z.array(z.string()).default([]),
  horaires: z.array(horaireSchema),
}).refine((data) => {
  if (data.horaireFlexible && !data.pourcentageTemps) {
    return false;
  }
  return true;
}, {
  message: "Le pourcentage est requis pour un horaire flexible",
  path: ["pourcentageTemps"],
});

type SecretaireFormData = z.infer<typeof secretaireSchema>;

interface SecretaireFormProps {
  secretaire?: any;
  onSuccess: () => void;
}

export function SecretaireForm({ secretaire, onSuccess }: SecretaireFormProps) {
  const [loading, setLoading] = useState(false);
  const [sitesOptions, setSitesOptions] = useState<{ id: string; nom: string }[]>([]);
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
      horaireFlexible: secretaire?.horaire_flexible || false,
      pourcentageTemps: secretaire?.pourcentage_temps || undefined,
      personnelBlocOperatoire: secretaire?.personnel_bloc_operatoire || false,
      assignationAdministrative: secretaire?.assignation_administrative || false,
      anesthesiste: secretaire?.anesthesiste || false,
      instrumentaliste: secretaire?.instrumentaliste || false,
      aideDeSalle: secretaire?.aide_de_salle || false,
      blocOphtalmoAccueil: secretaire?.bloc_ophtalmo_accueil || false,
      blocDermatoAccueil: secretaire?.bloc_dermato_accueil || false,
      sitesPriorite1: [],
      sitesPriorite2: [],
      horaires: secretaire?.horaires || [
        { jour: 1, jourTravaille: false, demiJournee: 'toute_journee', actif: true },
        { jour: 2, jourTravaille: false, demiJournee: 'toute_journee', actif: true },
        { jour: 3, jourTravaille: false, demiJournee: 'toute_journee', actif: true },
        { jour: 4, jourTravaille: false, demiJournee: 'toute_journee', actif: true },
        { jour: 5, jourTravaille: false, demiJournee: 'toute_journee', actif: true },
      ],
    },
  });

  // Fetch sites and site assignments
  useEffect(() => {
    const fetchData = async () => {
      const { data: sitesData } = await supabase
        .from('sites')
        .select('id, nom')
        .eq('actif', true)
        .order('nom');
      
      setSitesOptions(sitesData || []);
      
      if (secretaire?.id) {
        const { data: associations } = await supabase
          .from('secretaires_sites')
          .select('site_id, priorite')
          .eq('secretaire_id', secretaire.id);
        
        const prio1 = associations?.filter(a => a.priorite === '1').map(a => a.site_id) || [];
        const prio2 = associations?.filter(a => a.priorite === '2').map(a => a.site_id) || [];
        
        form.setValue('sitesPriorite1', prio1);
        form.setValue('sitesPriorite2', prio2);
      }
    };
    
    fetchData();
  }, [secretaire?.id]);

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
            horaire_flexible: data.horaireFlexible,
            pourcentage_temps: data.horaireFlexible ? data.pourcentageTemps : null,
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

        // Gestion des sites avec priorités
        await supabase
          .from('secretaires_sites')
          .delete()
          .eq('secretaire_id', secretaire.id);

        const sitesData = [
          ...(data.sitesPriorite1 || []).map(siteId => ({
            secretaire_id: secretaire.id,
            site_id: siteId,
            priorite: '1' as '1' | '2'
          })),
          ...(data.sitesPriorite2 || []).map(siteId => ({
            secretaire_id: secretaire.id,
            site_id: siteId,
            priorite: '2' as '1' | '2'
          }))
        ];

        if (sitesData.length > 0) {
          const { error: sitesError } = await supabase
            .from('secretaires_sites')
            .insert(sitesData);
          
          if (sitesError) throw sitesError;
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
        // Création - using secretaires_sites for site assignments
        const { data: secretaireData, error: secretaireError } = await supabase
          .from('secretaires')
          .insert({
            first_name: data.prenom,
            name: data.nom,
            email: data.email?.trim() || null,
            phone_number: data.telephone?.trim() || null,
            profile_id: null,
            prefere_port_en_truie: data.preferePortEnTruie,
            flexible_jours_supplementaires: data.flexibleJoursSupplementaires,
            nombre_jours_supplementaires: data.flexibleJoursSupplementaires ? data.nombreJoursSupplementaires : null,
            horaire_flexible: data.horaireFlexible,
            pourcentage_temps: data.horaireFlexible ? data.pourcentageTemps : null,
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

        // Gestion des sites avec priorités
        if (secretaireData) {
          const sitesData = [
            ...(data.sitesPriorite1 || []).map(siteId => ({
              secretaire_id: secretaireData.id,
              site_id: siteId,
              priorite: '1' as '1' | '2'
            })),
            ...(data.sitesPriorite2 || []).map(siteId => ({
              secretaire_id: secretaireData.id,
              site_id: siteId,
              priorite: '2' as '1' | '2'
            }))
          ];

          if (sitesData.length > 0) {
            const { error: sitesError } = await supabase
              .from('secretaires_sites')
              .insert(sitesData);
            
            if (sitesError) throw sitesError;
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
          </div>
        </div>

        {/* Sites assignés avec priorités */}
        <div className="space-y-4 pt-4 border-t">
          <h3 className="text-sm font-medium">Sites assignés</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="sitesPriorite1"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Sites priorité 1</FormLabel>
                  <FormControl>
                    <MultiSelect
                      options={sitesOptions}
                      selected={field.value || []}
                      onChange={field.onChange}
                      placeholder="Sélectionner les sites prioritaires..."
                    />
                  </FormControl>
                  <FormDescription>
                    Sites préférés pour l'assignation
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="sitesPriorite2"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Sites priorité 2</FormLabel>
                  <FormControl>
                    <MultiSelect
                      options={sitesOptions}
                      selected={field.value || []}
                      onChange={field.onChange}
                      placeholder="Sélectionner les sites secondaires..."
                    />
                  </FormControl>
                  <FormDescription>
                    Sites secondaires pour l'assignation
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        {/* Caractéristiques professionnelles */}
        <div className="space-y-4 pt-4 border-t">
          <h3 className="text-sm font-medium">Caractéristiques professionnelles</h3>
          
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
                    <FormLabel>Préfère travailler à Port-en-Truie</FormLabel>
                  </div>
                </FormItem>
              )}
            />

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
                    <FormLabel>Assignation administrative prioritaire</FormLabel>
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
                    <FormLabel>Bloc ophtalmo accueil</FormLabel>
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
                    <FormLabel>Bloc dermato accueil</FormLabel>
                  </div>
                </FormItem>
              )}
            />
          </div>
        </div>

        <Button type="submit" disabled={loading} className="w-full">
          {loading ? 'Enregistrement...' : (secretaire ? 'Modifier' : 'Créer')}
        </Button>
      </form>
    </Form>
  );
}
