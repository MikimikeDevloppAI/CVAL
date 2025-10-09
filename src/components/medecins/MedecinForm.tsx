import { useState, useEffect } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Plus, Trash2 } from 'lucide-react';

const horaireSchema = z.object({
  jour: z.number().min(1).max(5),
  demiJournee: z.enum(['matin', 'apres_midi', 'toute_journee']),
  siteId: z.string().min(1, 'Site requis'),
  actif: z.boolean().default(true),
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

const medecinSchema = z.object({
  first_name: z.string().trim().min(1, 'Le prénom est requis').max(50, 'Le prénom est trop long'),
  name: z.string().trim().min(1, 'Le nom est requis').max(50, 'Le nom est trop long'),
  email: z.string().trim().max(255, 'Email trop long').refine((val) => !val || z.string().email().safeParse(val).success, {
    message: 'Email invalide'
  }),
  phone_number: z.string().optional(),
  specialiteId: z.string().min(1, 'La spécialité est requise'),
  besoin_secretaires: z.number().min(0, 'Le besoin doit être positif').max(10, 'Le besoin ne peut pas dépasser 10'),
  horaires: z.array(horaireSchema),
}).refine((data) => {
  // Vérifier les chevauchements d'horaires pour chaque jour
  const horairesParJour = data.horaires.reduce((acc, horaire) => {
    if (!acc[horaire.jour]) acc[horaire.jour] = [];
    acc[horaire.jour].push(horaire);
    return acc;
  }, {} as Record<number, typeof data.horaires>);

  for (const jour in horairesParJour) {
    const horairesJour = horairesParJour[jour];
    for (let i = 0; i < horairesJour.length; i++) {
      for (let j = i + 1; j < horairesJour.length; j++) {
        const h1 = horairesJour[i];
        const h2 = horairesJour[j];
        
        // Vérifier si les périodes se chevauchent
        const periodesChevauchent = 
          h1.demiJournee === h2.demiJournee || 
          h1.demiJournee === 'toute_journee' || 
          h2.demiJournee === 'toute_journee';
        
        if (!periodesChevauchent) continue;
        
        // Si les périodes se chevauchent, vérifier s'ils peuvent coexister
        
        // Si les deux ont des dates différentes qui ne se chevauchent pas
        if (h1.dateDebut && h1.dateFin && h2.dateDebut && h2.dateFin) {
          if (h1.dateFin < h2.dateDebut || h2.dateFin < h1.dateDebut) {
            continue;
          }
        }
        
        // Si les sites sont différents, pas de problème
        if (h1.siteId !== h2.siteId) {
          continue;
        }
        
        // Si les alternances sont différentes, ils peuvent coexister
        if (h1.alternanceType !== h2.alternanceType) {
          continue;
        }
        
        // Si même alternance mais semaines de référence différentes
        if (h1.alternanceType !== 'hebdomadaire' && h2.alternanceType !== 'hebdomadaire') {
          if (h1.alternanceSemaineReference !== h2.alternanceSemaineReference) {
            continue;
          }
        }
        
        return false;
      }
    }
  }
  return true;
}, {
  message: "Les horaires d'un même jour ne peuvent pas se chevaucher (même site, mêmes semaines)",
  path: ["horaires"],
});

type MedecinFormData = z.infer<typeof medecinSchema>;

interface Specialite {
  id: string;
  nom: string;
}

interface Site {
  id: string;
  nom: string;
}

interface MedecinFormProps {
  medecin?: any;
  onSuccess: () => void;
}

export function MedecinForm({ medecin, onSuccess }: MedecinFormProps) {
  const [specialites, setSpecialites] = useState<Specialite[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const form = useForm<MedecinFormData>({
    resolver: zodResolver(medecinSchema),
    defaultValues: {
      first_name: medecin?.first_name || '',
      name: medecin?.name || '',
      email: medecin?.email || '',
      phone_number: medecin?.phone_number || '',
      specialiteId: medecin?.specialite_id || '',
      besoin_secretaires: medecin?.besoin_secretaires || 1.2,
      horaires: [],
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

        // Si on modifie un médecin, récupérer ses horaires
        if (medecin) {
          const { data: horairesData } = await supabase
            .from('horaires_base_medecins')
            .select('*')
            .eq('medecin_id', medecin.id)
            .order('jour_semaine')
            .order('demi_journee');
          
          if (horairesData && horairesData.length > 0) {
            const horaires = horairesData.map(h => ({
              jour: h.jour_semaine,
              demiJournee: h.demi_journee as 'matin' | 'apres_midi' | 'toute_journee',
              siteId: h.site_id || '',
              actif: h.actif !== false,
              alternanceType: h.alternance_type || 'hebdomadaire',
              alternanceSemaineReference: h.alternance_semaine_reference || '',
              dateDebut: h.date_debut || '',
              dateFin: h.date_fin || '',
            }));
            form.setValue('horaires', horaires);
          }
        }
      } catch (error) {
        console.error('Erreur lors du chargement des données:', error);
      }
    };

    fetchData();
  }, [medecin, form]);

  const onSubmit = async (data: MedecinFormData) => {
    setLoading(true);
    try {
      if (medecin) {
        // Modification
        const { error: medecinError } = await supabase
          .from('medecins')
          .update({
            first_name: data.first_name,
            name: data.name,
            email: data.email,
            phone_number: data.phone_number || null,
            specialite_id: data.specialiteId,
            besoin_secretaires: data.besoin_secretaires,
          })
          .eq('id', medecin.id);

        if (medecinError) throw medecinError;

        // Mettre à jour les horaires
        // D'abord supprimer les anciens horaires (triggers géreront besoin_effectif)
        await supabase
          .from('horaires_base_medecins')
          .delete()
          .eq('medecin_id', medecin.id);

        // Puis insérer les nouveaux horaires (triggers créeront besoin_effectif)
        if (data.horaires.length > 0) {
          const horairesData = data.horaires.map(horaire => ({
            medecin_id: medecin.id,
            jour_semaine: horaire.jour,
            demi_journee: horaire.demiJournee,
            site_id: horaire.siteId,
            actif: horaire.actif,
            alternance_type: horaire.alternanceType,
            alternance_semaine_reference: horaire.alternanceSemaineReference || new Date().toISOString().split('T')[0],
            date_debut: horaire.dateDebut ? horaire.dateDebut : null,
            date_fin: horaire.dateFin ? horaire.dateFin : null,
          }));

          const { error: horairesError } = await supabase
            .from('horaires_base_medecins')
            .insert(horairesData);

          if (horairesError) throw horairesError;
        }

        toast({
          title: "Succès",
          description: "Médecin modifié avec succès",
        });
      } else {
        // Création
        const { data: medecinData, error: medecinError } = await supabase
          .from('medecins')
          .insert({
            first_name: data.first_name,
            name: data.name,
            email: data.email,
            phone_number: data.phone_number || null,
            specialite_id: data.specialiteId,
            besoin_secretaires: data.besoin_secretaires,
          })
          .select()
          .single();

        if (medecinError) throw medecinError;

        // Créer les horaires (triggers créeront automatiquement besoin_effectif)
        if (medecinData && data.horaires.length > 0) {
          const horairesData = data.horaires.map(horaire => ({
            medecin_id: medecinData.id,
            jour_semaine: horaire.jour,
            demi_journee: horaire.demiJournee,
            site_id: horaire.siteId,
            actif: horaire.actif,
            alternance_type: horaire.alternanceType,
            alternance_semaine_reference: horaire.alternanceSemaineReference || new Date().toISOString().split('T')[0],
            date_debut: horaire.dateDebut ? horaire.dateDebut : null,
            date_fin: horaire.dateFin ? horaire.dateFin : null,
          }));

          const { error: horairesError } = await supabase
            .from('horaires_base_medecins')
            .insert(horairesData);

          if (horairesError) throw horairesError;
        }

        toast({
          title: "Succès",
          description: "Médecin créé avec succès",
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
        {/* Prénom et Nom côte à côte */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="first_name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Prénom</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="Prénom du médecin" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nom</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="Nom du médecin" />
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
            name="phone_number"
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

        {/* Spécialité et Besoin secrétaires côte à côte */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="specialiteId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Spécialité</FormLabel>
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

          <FormField
            control={form.control}
            name="besoin_secretaires"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Besoin en secrétaires</FormLabel>
                <FormControl>
                  <Input 
                    {...field} 
                    type="number" 
                    step="0.1"
                    min="0"
                    max="10"
                    onChange={(e) => field.onChange(parseFloat(e.target.value))}
                    placeholder="1.2" 
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Horaires */}
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <FormLabel className="text-base">Horaires de travail</FormLabel>
          </div>

          {form.formState.errors.horaires?.message && (
            <div className="text-destructive text-sm">
              {form.formState.errors.horaires.message}
            </div>
          )}

          {[1, 2, 3, 4, 5].map((jour) => {
            const jourNoms = ['', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];
            const horairesJour = fields.filter((_, idx) => form.watch(`horaires.${idx}.jour`) === jour);
            
            return (
              <Card key={jour}>
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-center">
                    <CardTitle className="text-sm">{jourNoms[jour]}</CardTitle>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        append({
                          jour,
                          demiJournee: 'toute_journee',
                          siteId: '',
                          actif: true,
                          alternanceType: 'hebdomadaire',
                          alternanceSemaineReference: '',
                          dateDebut: '',
                          dateFin: '',
                        });
                      }}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Ajouter un créneau
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {fields.map((field, index) => {
                    if (form.watch(`horaires.${index}.jour`) !== jour) return null;
                    
                    const alternanceType = form.watch(`horaires.${index}.alternanceType`);
                    
                    return (
                      <div key={field.id} className="space-y-3 p-4 border rounded-lg relative">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute top-2 right-2 text-destructive hover:text-destructive"
                          onClick={() => remove(index)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>

                        <FormField
                          control={form.control}
                          name={`horaires.${index}.demiJournee`}
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
                          name={`horaires.${index}.siteId`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Site associé</FormLabel>
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
                          name={`horaires.${index}.alternanceType`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Type d'alternance</FormLabel>
                              <Select onValueChange={field.onChange} value={field.value} defaultValue="hebdomadaire">
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
                            name={`horaires.${index}.alternanceSemaineReference`}
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
                            name={`horaires.${index}.dateDebut`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Date de début</FormLabel>
                                <FormControl>
                                  <Input {...field} type="date" placeholder="Optionnel" />
                                </FormControl>
                                <p className="text-xs text-muted-foreground">Si vide, commence aujourd'hui</p>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name={`horaires.${index}.dateFin`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Date de fin</FormLabel>
                                <FormControl>
                                  <Input {...field} type="date" placeholder="Optionnel" />
                                </FormControl>
                                <p className="text-xs text-muted-foreground">Si vide, applique pour 52 semaines</p>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                      </div>
                    );
                  })}
                  
                  {horairesJour.length === 0 && (
                    <div className="text-muted-foreground text-sm py-4 text-center">
                      Aucun créneau pour ce jour
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="sticky bottom-0 bg-background border-t pt-4 pb-6 -mx-6 px-6 mt-6 flex justify-end space-x-2">
          <Button type="submit" disabled={loading}>
            {loading ? 'Enregistrement...' : medecin ? 'Modifier' : 'Ajouter'}
          </Button>
        </div>
      </form>
    </Form>
  );
}