import { useState, useEffect } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

const horaireSchema = z.object({
  jour: z.number().min(1).max(7),
  jourTravaille: z.boolean().default(false),
  heureDebut: z.string().optional(),
  heureFin: z.string().optional(),
  actif: z.boolean().default(true),
});

const secretaireSchema = z.object({
  prenom: z.string().trim().min(1, 'Le prénom est requis').max(50, 'Le prénom est trop long'),
  nom: z.string().trim().min(1, 'Le nom est requis').max(50, 'Le nom est trop long'),
  email: z.string().trim().email('Email invalide').max(255, 'Email trop long'),
  telephone: z.string().trim().min(1, 'Le numéro de téléphone est requis').max(20, 'Le numéro de téléphone est trop long'),
  specialites: z.array(z.string()).min(0, 'Au moins une spécialité doit être sélectionnée'),
  sitePreferentielId: z.string().optional(),
  preferePortEnTruie: z.boolean().default(false),
  flexibleJoursSupplementaires: z.boolean().default(false),
  nombreJoursSupplementaires: z.number().min(1).max(7).optional(),
  horaires: z.array(horaireSchema),
});

type SecretaireFormData = z.infer<typeof secretaireSchema>;

interface Specialite {
  id: string;
  nom: string;
}

interface Site {
  id: string;
  nom: string;
}

interface SecretaireFormProps {
  secretaire?: any;
  onSuccess: () => void;
}

export function SecretaireForm({ secretaire, onSuccess }: SecretaireFormProps) {
  const [specialites, setSpecialites] = useState<Specialite[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const form = useForm<SecretaireFormData>({
    resolver: zodResolver(secretaireSchema),
    defaultValues: {
      prenom: secretaire?.first_name || secretaire?.profiles?.prenom || '',
      nom: secretaire?.name || secretaire?.profiles?.nom || '',
      email: secretaire?.email || secretaire?.profiles?.email || '',
      telephone: secretaire?.phone_number || '',
      specialites: secretaire?.specialites || [],
      sitePreferentielId: secretaire?.site_preferentiel_id || '',
      preferePortEnTruie: secretaire?.prefere_port_en_truie || false,
      flexibleJoursSupplementaires: secretaire?.flexible_jours_supplementaires || false,
      nombreJoursSupplementaires: secretaire?.nombre_jours_supplementaires || 1,
      horaires: secretaire?.horaires || [
        { jour: 1, jourTravaille: false, heureDebut: '07:30', heureFin: '17:00', actif: true },
        { jour: 2, jourTravaille: false, heureDebut: '07:30', heureFin: '17:00', actif: true },
        { jour: 3, jourTravaille: false, heureDebut: '07:30', heureFin: '17:00', actif: true },
        { jour: 4, jourTravaille: false, heureDebut: '07:30', heureFin: '17:00', actif: true },
        { jour: 5, jourTravaille: false, heureDebut: '07:30', heureFin: '17:00', actif: true },
      ],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'horaires',
  });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [specialitesRes, sitesRes] = await Promise.all([
          supabase.from('specialites').select('id, nom').order('nom'),
          supabase.from('sites').select('id, nom').order('nom')
        ]);

        if (specialitesRes.data) setSpecialites(specialitesRes.data);
        if (sitesRes.data) setSites(sitesRes.data);
      } catch (error) {
        console.error('Erreur lors du chargement des données:', error);
      }
    };

    fetchData();
  }, []);

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
            email: data.email,
            phone_number: data.telephone,
            specialites: data.specialites,
            site_preferentiel_id: data.sitePreferentielId || null,
            prefere_port_en_truie: data.preferePortEnTruie,
            flexible_jours_supplementaires: data.flexibleJoursSupplementaires,
            nombre_jours_supplementaires: data.flexibleJoursSupplementaires ? data.nombreJoursSupplementaires : null,
          })
          .eq('id', secretaire.id);

        if (secretaireError) throw secretaireError;

        // Mettre à jour les horaires
        // D'abord supprimer les anciens horaires
        await supabase
          .from('horaires_base_secretaires')
          .delete()
          .eq('secretaire_id', secretaire.id);

        // Puis insérer les nouveaux horaires actifs
        const horairesActifs = data.horaires.filter(horaire => 
          horaire.jourTravaille && 
          horaire.heureDebut && 
          horaire.heureFin
        );

        if (horairesActifs.length > 0) {
          const horairesData = horairesActifs.map(horaire => ({
            secretaire_id: secretaire.id,
            jour_semaine: horaire.jour,
            heure_debut: horaire.heureDebut,
            heure_fin: horaire.heureFin,
            actif: horaire.actif,
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
        // Création sans profil associé
        const { data: secretaireData, error: secretaireError } = await supabase
          .from('secretaires')
          .insert({
            first_name: data.prenom,
            name: data.nom,
            email: data.email,
            phone_number: data.telephone,
            profile_id: null, // Pas de profil associé
            specialites: data.specialites,
            site_preferentiel_id: data.sitePreferentielId || null,
            prefere_port_en_truie: data.preferePortEnTruie,
            flexible_jours_supplementaires: data.flexibleJoursSupplementaires,
            nombre_jours_supplementaires: data.flexibleJoursSupplementaires ? data.nombreJoursSupplementaires : null,
          })
          .select()
          .single();

        if (secretaireError) throw secretaireError;

        // Créer les horaires (seulement les jours travaillés)
        if (secretaireData) {
          const horairesActifs = data.horaires.filter(horaire => 
            horaire.jourTravaille && 
            horaire.heureDebut && 
            horaire.heureFin
          );

          if (horairesActifs.length > 0) {
            const horairesData = horairesActifs.map(horaire => ({
              secretaire_id: secretaireData.id,
              jour_semaine: horaire.jour,
              heure_debut: horaire.heureDebut,
              heure_fin: horaire.heureFin,
              actif: horaire.actif,
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

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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

        <FormField
          control={form.control}
          name="specialites"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Spécialités</FormLabel>
              <Popover>
                <PopoverTrigger asChild>
                  <FormControl>
                    <Button
                      variant="outline"
                      role="combobox"
                      className="w-full justify-between h-auto min-h-10"
                    >
                      <div className="flex flex-wrap gap-1">
                        {field.value && field.value.length > 0 ? (
                          <>
                            {field.value.slice(0, 2).map((specialiteId) => {
                              const specialite = specialites.find(s => s.id === specialiteId);
                              return specialite ? (
                                <Badge key={specialite.id} variant="secondary" className="text-xs">
                                  {specialite.nom}
                                  <button
                                    type="button"
                                    className="ml-1 hover:bg-secondary-foreground/20 rounded-full"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const current = field.value || [];
                                      field.onChange(current.filter((id) => id !== specialite.id));
                                    }}
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </Badge>
                              ) : null;
                            })}
                            {field.value.length > 2 && (
                              <Badge variant="secondary" className="text-xs">
                                +{field.value.length - 2} autres
                              </Badge>
                            )}
                          </>
                        ) : (
                          "Sélectionner des spécialités"
                        )}
                      </div>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </FormControl>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0">
                  <Command>
                    <CommandInput placeholder="Rechercher une spécialité..." />
                    <CommandEmpty>Aucune spécialité trouvée.</CommandEmpty>
                    <CommandGroup className="max-h-60 overflow-auto">
                      {specialites.map((specialite) => (
                        <CommandItem
                          value={specialite.nom}
                          key={specialite.id}
                          onSelect={() => {
                            const current = field.value || [];
                            if (current.includes(specialite.id)) {
                              field.onChange(current.filter((id) => id !== specialite.id));
                            } else {
                              field.onChange([...current, specialite.id]);
                            }
                          }}
                        >
                          <Check
                            className={`mr-2 h-4 w-4 ${
                              field.value?.includes(specialite.id) ? "opacity-100" : "opacity-0"
                            }`}
                          />
                          {specialite.nom}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </Command>
                </PopoverContent>
              </Popover>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="sitePreferentielId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Site préférentiel (optionnel)</FormLabel>
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
          name="preferePortEnTruie"
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
                  Préfère travailler à Port-en-truie
                </FormLabel>
              </div>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="flexibleJoursSupplementaires"
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

        {/* Horaires */}
        <div className="space-y-4">
          <FormLabel className="text-base">Horaires de travail par jour</FormLabel>

          {fields.map((field, index) => {
            const jourNoms = ['', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];
            const jourTravaille = form.watch(`horaires.${index}.jourTravaille`);
            
            return (
              <Card key={field.id}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">
                    {jourNoms[field.jour]}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <FormField
                    control={form.control}
                    name={`horaires.${index}.jourTravaille`}
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
                            Jour travaillé
                          </FormLabel>
                        </div>
                      </FormItem>
                    )}
                  />

                  {jourTravaille ? (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <FormField
                          control={form.control}
                          name={`horaires.${index}.heureDebut`}
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
                          name={`horaires.${index}.heureFin`}
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

                    </>
                  ) : (
                    <div className="text-muted-foreground text-sm py-4">
                      Jour non travaillé
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
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