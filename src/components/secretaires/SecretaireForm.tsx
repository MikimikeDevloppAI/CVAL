import { useState, useEffect } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
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
      prenom: secretaire?.profiles?.prenom || '',
      nom: secretaire?.profiles?.nom || '',
      email: secretaire?.profiles?.email || '',
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
        // Modification
        const { error: profileError } = await supabase
          .from('profiles')
          .update({
            prenom: data.prenom,
            nom: data.nom,
            email: data.email,
          })
          .eq('id', secretaire.profile_id);

        if (profileError) throw profileError;

        const { error: secretaireError } = await supabase
          .from('secretaires')
          .update({
            specialites: data.specialites,
            site_preferentiel_id: data.sitePreferentielId || null,
            prefere_port_en_truie: data.preferePortEnTruie,
            flexible_jours_supplementaires: data.flexibleJoursSupplementaires,
          })
          .eq('id', secretaire.id);

        if (secretaireError) throw secretaireError;

        toast({
          title: "Succès",
          description: "Secrétaire modifié avec succès",
        });
      } else {
        // Création - d'abord créer le profile
        const profileId = crypto.randomUUID();
        const { error: profileError } = await supabase
          .from('profiles')
          .insert({
            id: profileId,
            prenom: data.prenom,
            nom: data.nom,
            email: data.email,
            role: 'secretaire',
          });

        if (profileError) throw profileError;

        // Ensuite créer le secrétaire
        const { data: secretaireData, error: secretaireError } = await supabase
          .from('secretaires')
          .insert({
            profile_id: profileId,
            specialites: data.specialites,
            site_preferentiel_id: data.sitePreferentielId || null,
            prefere_port_en_truie: data.preferePortEnTruie,
            flexible_jours_supplementaires: data.flexibleJoursSupplementaires,
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
              site_id: null,
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
          name="specialites"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Spécialités</FormLabel>
              <div className="space-y-2 max-h-32 overflow-y-auto border rounded p-2">
                {specialites.map((specialite) => (
                  <div key={specialite.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={specialite.id}
                      checked={field.value?.includes(specialite.id)}
                      onCheckedChange={(checked) => {
                        const current = field.value || [];
                        if (checked) {
                          field.onChange([...current, specialite.id]);
                        } else {
                          field.onChange(current.filter((id) => id !== specialite.id));
                        }
                      }}
                    />
                    <label htmlFor={specialite.id} className="text-sm">
                      {specialite.nom}
                    </label>
                  </div>
                ))}
              </div>
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