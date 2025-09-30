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

const horaireSchema = z.object({
  jour: z.number().min(1).max(7),
  jourTravaille: z.boolean().default(false),
  heureDebut: z.string().optional(),
  heureFin: z.string().optional(),
  siteId: z.string().optional(),
  actif: z.boolean().default(true),
  alternanceType: z.enum(['hebdomadaire', 'une_sur_deux', 'une_sur_trois', 'une_sur_quatre']).default('hebdomadaire'),
  alternanceSemaineReference: z.string().optional(),
});

const medecinSchema = z.object({
  first_name: z.string().trim().min(1, 'Le prénom est requis').max(50, 'Le prénom est trop long'),
  name: z.string().trim().min(1, 'Le nom est requis').max(50, 'Le nom est trop long'),
  email: z.string().trim().email('Email invalide').max(255, 'Email trop long'),
  phone_number: z.string().optional(),
  specialiteId: z.string().min(1, 'La spécialité est requise'),
  horaires: z.array(horaireSchema),
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
      horaires: medecin?.horaires || [
        { jour: 1, jourTravaille: false, heureDebut: '07:30', heureFin: '17:00', siteId: '', actif: true, alternanceType: 'hebdomadaire' as const, alternanceSemaineReference: undefined },
        { jour: 2, jourTravaille: false, heureDebut: '07:30', heureFin: '17:00', siteId: '', actif: true, alternanceType: 'hebdomadaire' as const, alternanceSemaineReference: undefined },
        { jour: 3, jourTravaille: false, heureDebut: '07:30', heureFin: '17:00', siteId: '', actif: true, alternanceType: 'hebdomadaire' as const, alternanceSemaineReference: undefined },
        { jour: 4, jourTravaille: false, heureDebut: '07:30', heureFin: '17:00', siteId: '', actif: true, alternanceType: 'hebdomadaire' as const, alternanceSemaineReference: undefined },
        { jour: 5, jourTravaille: false, heureDebut: '07:30', heureFin: '17:00', siteId: '', actif: true, alternanceType: 'hebdomadaire' as const, alternanceSemaineReference: undefined },
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

        // Si on modifie un médecin, récupérer ses horaires
        if (medecin) {
          const { data: horairesData } = await supabase
            .from('horaires_base_medecins')
            .select('*')
            .eq('medecin_id', medecin.id);
          
          if (horairesData && horairesData.length > 0) {
            const horaires = [];
            for (let jour = 1; jour <= 5; jour++) {
              const horaireExistant = horairesData.find(h => h.jour_semaine === jour);
              if (horaireExistant) {
                horaires.push({
                  jour,
                  jourTravaille: true,
                  heureDebut: horaireExistant.heure_debut || '07:30',
                  heureFin: horaireExistant.heure_fin || '17:00',
                  siteId: horaireExistant.site_id || '',
                  actif: horaireExistant.actif !== false,
                  alternanceType: horaireExistant.alternance_type || 'hebdomadaire',
                  alternanceSemaineReference: horaireExistant.alternance_semaine_reference || undefined
                });
              } else {
                horaires.push({
                  jour,
                  jourTravaille: false,
                  heureDebut: '07:30',
                  heureFin: '17:00',
                  siteId: '',
                  actif: true,
                  alternanceType: 'hebdomadaire',
                  alternanceSemaineReference: undefined
                });
              }
            }
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
          })
          .eq('id', medecin.id);

        if (medecinError) throw medecinError;

        // Mettre à jour les horaires
        // D'abord supprimer les anciens horaires
        await supabase
          .from('horaires_base_medecins')
          .delete()
          .eq('medecin_id', medecin.id);

        // Puis insérer les nouveaux horaires actifs
        const horairesActifs = data.horaires.filter(horaire => 
          horaire.jourTravaille && 
          horaire.heureDebut && 
          horaire.heureFin &&
          horaire.siteId
        );

        if (horairesActifs.length > 0) {
          const horairesData = horairesActifs.map(horaire => ({
            medecin_id: medecin.id,
            jour_semaine: horaire.jour,
            heure_debut: horaire.heureDebut,
            heure_fin: horaire.heureFin,
            site_id: horaire.siteId,
            actif: horaire.actif,
            alternance_type: horaire.alternanceType,
            alternance_semaine_reference: horaire.alternanceSemaineReference || new Date().toISOString().split('T')[0],
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
          })
          .select()
          .single();

        if (medecinError) throw medecinError;

        // Créer les horaires (seulement les jours travaillés)
        if (medecinData) {
          const horairesActifs = data.horaires.filter(horaire => 
            horaire.jourTravaille && 
            horaire.heureDebut && 
            horaire.heureFin &&
            horaire.siteId
          );

          if (horairesActifs.length > 0) {
            const horairesData = horairesActifs.map(horaire => ({
              medecin_id: medecinData.id,
              jour_semaine: horaire.jour,
              heure_debut: horaire.heureDebut,
              heure_fin: horaire.heureFin,
              site_id: horaire.siteId,
              actif: horaire.actif,
              alternance_type: horaire.alternanceType,
              alternance_semaine_reference: horaire.alternanceSemaineReference || new Date().toISOString().split('T')[0],
            }));

            const { error: horairesError } = await supabase
              .from('horaires_base_medecins')
              .insert(horairesData);

            if (horairesError) throw horairesError;
          }
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

        {/* Spécialité seule */}
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

        {/* Horaires */}
        <div className="space-y-4">
          <FormLabel className="text-base">Horaires de travail par jour</FormLabel>

          {fields.map((field, index) => {
            const jourNoms = ['', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];
            const jourTravaille = form.watch(`horaires.${index}.jourTravaille`);
            const alternanceType = form.watch(`horaires.${index}.alternanceType`);
            
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

                      {alternanceType !== 'hebdomadaire' && (
                        <FormField
                          control={form.control}
                          name={`horaires.${index}.alternanceSemaineReference`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Semaine de référence (première semaine de travail)</FormLabel>
                              <FormControl>
                                <Input {...field} type="date" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      )}
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
            {loading ? 'Enregistrement...' : medecin ? 'Modifier' : 'Ajouter'}
          </Button>
        </div>
      </form>
    </Form>
  );
}