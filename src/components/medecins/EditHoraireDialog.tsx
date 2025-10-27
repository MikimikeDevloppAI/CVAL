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
  typeInterventionId: z.string().optional(),
  alternanceType: z.enum(['hebdomadaire', 'une_sur_deux', 'une_sur_trois', 'une_sur_quatre', 'trois_sur_quatre']).default('hebdomadaire'),
  alternanceSemaineModulo: z.number().int().min(0).max(3),
  dateDebut: z.string().optional(),
  dateFin: z.string().optional(),
  blocOperatoireSiteId: z.string().optional(),
}).refine((data) => {
  if (data.dateDebut && data.dateFin) {
    return data.dateDebut <= data.dateFin;
  }
  return true;
}, {
  message: "La date de début doit être avant ou égale à la date de fin",
  path: ["dateDebut"],
}).refine((data) => {
  if (data.siteId === data.blocOperatoireSiteId && (!data.typeInterventionId || data.typeInterventionId === '')) {
    return false;
  }
  return true;
}, {
  message: "Le type d'intervention est requis pour le bloc opératoire",
  path: ["typeInterventionId"],
});

type HoraireFormData = z.infer<typeof horaireSchema>;

interface Site {
  id: string;
  nom: string;
}

interface TypeIntervention {
  id: string;
  nom: string;
  code: string;
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

// Fonction pour calculer la semaine ISO
const getISOWeek = (date: Date): number => {
  const target = new Date(date.valueOf());
  const dayNr = (date.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
  }
  return 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
};

// Fonction pour vérifier si le médecin doit travailler (logique identique au SQL)
const should_doctor_work_js = (
  alternanceType: string,
  alternanceModulo: number,
  targetDate: Date
): boolean => {
  const weekNumber = getISOWeek(targetDate);
  
  switch (alternanceType) {
    case 'hebdomadaire':
      return true;
    case 'une_sur_deux':
      return weekNumber % 2 === alternanceModulo;
    case 'une_sur_trois':
      return weekNumber % 3 === alternanceModulo;
    case 'une_sur_quatre':
      return weekNumber % 4 === alternanceModulo;
    case 'trois_sur_quatre':
      return weekNumber % 4 !== alternanceModulo;
    default:
      return true;
  }
};

export function EditHoraireDialog({ open, onOpenChange, medecinId, jour, horaire, onSuccess }: EditHoraireDialogProps) {
  const [sites, setSites] = useState<Site[]>([]);
  const [typesIntervention, setTypesIntervention] = useState<TypeIntervention[]>([]);
  const [blocOperatoireSiteId, setBlocOperatoireSiteId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const form = useForm<HoraireFormData>({
    resolver: zodResolver(horaireSchema),
    defaultValues: {
      demiJournee: horaire?.demi_journee || 'toute_journee',
      siteId: horaire?.site_id || '',
      typeInterventionId: horaire?.type_intervention_id || '',
      alternanceType: horaire?.alternance_type || 'hebdomadaire',
      alternanceSemaineModulo: horaire?.alternance_semaine_modulo ?? 0,
      dateDebut: horaire?.date_debut || '',
      dateFin: horaire?.date_fin || '',
      blocOperatoireSiteId: blocOperatoireSiteId,
    },
  });

  useEffect(() => {
    const fetchData = async () => {
      const { data: sitesData } = await supabase.from('sites').select('id, nom').eq('actif', true).order('nom');
      if (sitesData) {
        setSites(sitesData);
        const blocSite = sitesData.find(s => s.nom.toLowerCase().includes('bloc'));
        if (blocSite) setBlocOperatoireSiteId(blocSite.id);
      }

      const { data: typesData } = await supabase.from('types_intervention').select('*').eq('actif', true).order('nom');
      if (typesData) setTypesIntervention(typesData);
    };
    fetchData();
  }, []);

  useEffect(() => {
    if (horaire) {
      form.reset({
        demiJournee: horaire.demi_journee || 'toute_journee',
        siteId: horaire.site_id || '',
        typeInterventionId: horaire.type_intervention_id || '',
        alternanceType: horaire.alternance_type || 'hebdomadaire',
        alternanceSemaineModulo: horaire.alternance_semaine_modulo ?? 0,
        dateDebut: horaire.date_debut || '',
        dateFin: horaire.date_fin || '',
        blocOperatoireSiteId: blocOperatoireSiteId,
      });
    } else {
      form.reset({
        demiJournee: 'toute_journee',
        siteId: '',
        typeInterventionId: '',
        alternanceType: 'hebdomadaire',
        alternanceSemaineModulo: 0,
        dateDebut: '',
        dateFin: '',
        blocOperatoireSiteId: blocOperatoireSiteId,
      });
    }
  }, [horaire, form, blocOperatoireSiteId]);

  const deleteManualBesoins = async (data: HoraireFormData) => {
    const dateDebut = data.dateDebut || '1900-01-01';
    const dateFin = data.dateFin || '2100-12-31';
    
    // Récupérer tous les besoins effectifs du médecin pour ce site
    const { data: existingBesoins, error: fetchError } = await supabase
      .from('besoin_effectif')
      .select('*')
      .eq('medecin_id', medecinId)
      .eq('type', 'medecin')
      .eq('site_id', data.siteId)
      .gte('date', dateDebut)
      .lte('date', dateFin);
    
    if (fetchError) throw fetchError;
    
    // Filtrer les besoins qui correspondent au jour de la semaine et à l'alternance
    const besoinsToDelete = existingBesoins?.filter(besoin => {
      const besoinDate = new Date(besoin.date);
      const jourSemaine = besoinDate.getDay() || 7; // JavaScript: 0=Dimanche -> 7
      
      // Vérifier que c'est le bon jour de la semaine
      if (jourSemaine !== jour) return false;
      
      // Vérifier l'alternance
      const shouldWork = should_doctor_work_js(
        data.alternanceType,
        data.alternanceSemaineModulo,
        besoinDate
      );
      
      if (!shouldWork) return false;
      
      // Vérifier la période
      if (data.demiJournee === 'toute_journee') {
        return true; // Toute journée écrase matin ET après-midi
      }
      
      return besoin.demi_journee === data.demiJournee;
    }) || [];
    
    // Supprimer les besoins identifiés
    if (besoinsToDelete.length > 0) {
      const { error: deleteError } = await supabase
        .from('besoin_effectif')
        .delete()
        .in('id', besoinsToDelete.map(b => b.id));
      
      if (deleteError) throw deleteError;
      
      console.log(`✅ Supprimé ${besoinsToDelete.length} besoins effectifs manuels conflictuels`);
    }
  };

  const onSubmit = async (data: HoraireFormData) => {
    setLoading(true);
    try {

      // Vérification des chevauchements dans horaires_base_medecins
      const horairesToDelete: string[] = [];
      
      const { data: existing, error: checkError } = await supabase
        .from('horaires_base_medecins')
        .select('*')
        .eq('medecin_id', medecinId)
        .eq('jour_semaine', jour)
        .eq('actif', true)
        .neq('id', horaire?.id || '00000000-0000-0000-0000-000000000000');

      if (checkError) throw checkError;

      if (existing && existing.length > 0) {
        for (const existingHoraire of existing) {
          if (existingHoraire.alternance_type === data.alternanceType && 
              existingHoraire.alternance_semaine_modulo === data.alternanceSemaineModulo) {
            
            const periodsOverlap = 
              data.demiJournee === 'toute_journee' ||
              existingHoraire.demi_journee === 'toute_journee' ||
              data.demiJournee === existingHoraire.demi_journee;

            if (periodsOverlap) {
              const newStart = data.dateDebut || '1900-01-01';
              const newEnd = data.dateFin || '2100-12-31';
              const existingStart = existingHoraire.date_debut || '1900-01-01';
              const existingEnd = existingHoraire.date_fin || '2100-12-31';

              const datesOverlap = newStart <= existingEnd && newEnd >= existingStart;

              if (datesOverlap) {
                horairesToDelete.push(existingHoraire.id);
              }
            }
          }
        }
      }

      // Supprimer les horaires_base_medecins conflictuels
      for (const horaireId of horairesToDelete) {
        const { error: deleteError } = await supabase
          .from('horaires_base_medecins')
          .delete()
          .eq('id', horaireId);
        
        if (deleteError) throw deleteError;
      }
      
      // Supprimer les besoins effectifs manuels conflictuels
      await deleteManualBesoins(data);

      if (horaire) {
        // Modification
        const { error } = await supabase
          .from('horaires_base_medecins')
          .update({
            demi_journee: data.demiJournee,
            site_id: data.siteId,
            type_intervention_id: data.siteId === blocOperatoireSiteId ? data.typeInterventionId : null,
            alternance_type: data.alternanceType,
            alternance_semaine_modulo: data.alternanceSemaineModulo,
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
            type_intervention_id: data.siteId === blocOperatoireSiteId ? data.typeInterventionId : null,
            alternance_type: data.alternanceType,
            alternance_semaine_modulo: data.alternanceSemaineModulo,
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
  const selectedSiteId = form.watch('siteId');
  const isBlocOperatoire = selectedSiteId === blocOperatoireSiteId;

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

            {isBlocOperatoire && (
              <FormField
                control={form.control}
                name="typeInterventionId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type d'intervention *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Sélectionner un type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {typesIntervention.map((type) => (
                          <SelectItem key={type.id} value={type.id}>
                            {type.nom}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

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
                      <SelectItem value="trois_sur_quatre">Trois semaines sur quatre</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {alternanceType && alternanceType !== 'hebdomadaire' && (
              <FormField
                control={form.control}
                name="alternanceSemaineModulo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {alternanceType === 'une_sur_deux' && 'Semaine'}
                      {alternanceType === 'une_sur_trois' && 'Semaine dans le cycle'}
                      {alternanceType === 'une_sur_quatre' && 'Semaine dans le cycle'}
                      {alternanceType === 'trois_sur_quatre' && 'Semaine absente dans le cycle'}
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
                        {alternanceType === 'trois_sur_quatre' && (
                          <>
                            <SelectItem value="0">Sauf Semaine 1 (pas 1, 5, 9...)</SelectItem>
                            <SelectItem value="1">Sauf Semaine 2 (pas 2, 6, 10...)</SelectItem>
                            <SelectItem value="2">Sauf Semaine 3 (pas 3, 7, 11...)</SelectItem>
                            <SelectItem value="3">Sauf Semaine 4 (pas 4, 8, 12...)</SelectItem>
                          </>
                        )}
                      </SelectContent>
                    </Select>
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
