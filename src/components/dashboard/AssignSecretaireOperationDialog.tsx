import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, UserCircle, Clock, MapPin, AlertCircle } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface Secretaire {
  id: string;
  first_name: string;
  name: string;
  status: 'available_admin' | 'not_working' | 'assigned_elsewhere';
  existing_site?: string;
  existing_besoin?: string;
}

interface AssignSecretaireOperationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: string;
  periode: 'matin' | 'apres_midi';
  besoinOperationId: string;
  besoinOperationNom: string;
  planningBlocId: string;
  onSuccess: () => void;
}

export function AssignSecretaireOperationDialog({
  open,
  onOpenChange,
  date,
  periode,
  besoinOperationId,
  besoinOperationNom,
  planningBlocId,
  onSuccess,
}: AssignSecretaireOperationDialogProps) {
  const [secretaires, setSecretaires] = useState<Secretaire[]>([]);
  const [selectedSecretaireId, setSelectedSecretaireId] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetchingData, setFetchingData] = useState(false);

  useEffect(() => {
    if (open) {
      fetchSecretaires();
    }
  }, [open, date, periode, besoinOperationId]);

  const fetchSecretaires = async () => {
    setFetchingData(true);
    try {
      // Récupérer les assistants médicaux éligibles pour ce besoin opératoire
      const { data: eligibleSecretaires, error: eligibleError } = await supabase
        .from('secretaires_besoins_operations')
        .select(`
          secretaire_id,
          secretaires (
            id,
            first_name,
            name
          )
        `)
        .eq('besoin_operation_id', besoinOperationId)
        .eq('secretaires.actif', true);

      if (eligibleError) throw eligibleError;

      // Récupérer les capacités existantes pour ce jour
      const { data: capacites, error: capacitesError } = await supabase
        .from('capacite_effective')
        .select(`
          secretaire_id,
          demi_journee,
          site_id,
          besoin_operation_id,
          planning_genere_bloc_operatoire_id,
          sites (nom),
          besoins_operations (nom)
        `)
        .eq('date', date)
        .eq('demi_journee', periode)
        .eq('actif', true);

      if (capacitesError) throw capacitesError;

      // Récupérer toutes les assistants médicaux actifs
      const { data: allSecretaires, error: allError } = await supabase
        .from('secretaires')
        .select('id, first_name, name')
        .eq('actif', true);

      if (allError) throw allError;

      // Construire la liste des assistants médicaux avec leur statut
      const secretairesList: Secretaire[] = [];

      // Assistants médicaux éligibles pour ce besoin
      const eligibleIds = new Set(
        eligibleSecretaires
          ?.filter(es => es.secretaires)
          .map(es => es.secretaire_id) || []
      );

      for (const sec of allSecretaires || []) {
        // Ne traiter que les assistants médicaux éligibles pour ce besoin
        if (!eligibleIds.has(sec.id)) {
          continue;
        }

        // Vérifier si l'assistant médical a une capacité pour cette période
        const capacite = capacites?.find(c => c.secretaire_id === sec.id);

        if (capacite) {
          // Assistant médical déjà assigné
          if (capacite.site_id === '00000000-0000-0000-0000-000000000001') {
            // Administratif
            secretairesList.push({
              id: sec.id,
              first_name: sec.first_name,
              name: sec.name,
              status: 'available_admin',
            });
          } else {
            // Assigné ailleurs
            let existingInfo = capacite.sites?.nom || 'Site inconnu';
            if (capacite.besoin_operation_id && capacite.besoins_operations) {
              existingInfo = capacite.besoins_operations.nom;
            }
            secretairesList.push({
              id: sec.id,
              first_name: sec.first_name,
              name: sec.name,
              status: 'assigned_elsewhere',
              existing_site: capacite.sites?.nom,
              existing_besoin: capacite.besoins_operations?.nom,
            });
          }
        } else {
          // Assistant médical éligible mais ne travaille pas ce jour
          secretairesList.push({
            id: sec.id,
            first_name: sec.first_name,
            name: sec.name,
            status: 'not_working',
          });
        }
      }

      // Trier : admin d'abord, puis non-travaillantes, puis assignées ailleurs
      secretairesList.sort((a, b) => {
        const statusOrder = {
          available_admin: 0,
          not_working: 1,
          assigned_elsewhere: 2,
        };
        return statusOrder[a.status] - statusOrder[b.status];
      });

      setSecretaires(secretairesList);
    } catch (error) {
      console.error('Error fetching secretaires:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible de charger les assistants médicaux',
        variant: 'destructive',
      });
    } finally {
      setFetchingData(false);
    }
  };

  const handleSubmit = async () => {
    if (!selectedSecretaireId) {
      toast({
        title: 'Erreur',
        description: 'Veuillez sélectionner un assistant médical',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      const selectedSecretaire = secretaires.find(s => s.id === selectedSecretaireId);
      if (!selectedSecretaire) return;

      // Site du bloc opératoire
      const { data: blocSite, error: siteError } = await supabase
        .from('sites')
        .select('id')
        .ilike('nom', '%bloc%opératoire%')
        .eq('actif', true)
        .single();

      if (siteError || !blocSite) {
        throw new Error('Site Bloc opératoire non trouvé');
      }

      if (selectedSecretaire.status === 'not_working') {
        // Créer une nouvelle capacité
        const { error: insertError } = await supabase
          .from('capacite_effective')
          .insert({
            date,
            secretaire_id: selectedSecretaireId,
            site_id: blocSite.id,
            demi_journee: periode,
            besoin_operation_id: besoinOperationId,
            planning_genere_bloc_operatoire_id: planningBlocId,
            actif: true,
          });

        if (insertError) throw insertError;

        toast({
          title: 'Succès',
          description: 'Assistant médical assigné avec succès',
        });
      } else {
        // Mettre à jour la capacité existante
        const { error: updateError } = await supabase
          .from('capacite_effective')
          .update({
            site_id: blocSite.id,
            besoin_operation_id: besoinOperationId,
            planning_genere_bloc_operatoire_id: planningBlocId,
          })
          .eq('secretaire_id', selectedSecretaireId)
          .eq('date', date)
          .eq('demi_journee', periode);

        if (updateError) throw updateError;

        toast({
          title: 'Succès',
          description: selectedSecretaire.status === 'assigned_elsewhere'
            ? 'Assistant médical réassigné avec succès'
            : 'Assistant médical assigné avec succès',
        });
      }

      onSuccess();
      onOpenChange(false);
      setSelectedSecretaireId('');
    } catch (error: any) {
      console.error('Error assigning secretaire:', error);
      toast({
        title: 'Erreur',
        description: error.message || 'Impossible d\'assigner l\'assistant médical',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: Secretaire['status']) => {
    switch (status) {
      case 'available_admin':
        return (
          <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">
            <MapPin className="h-3 w-3 mr-1" />
            Administratif
          </Badge>
        );
      case 'not_working':
        return (
          <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/20">
            <Clock className="h-3 w-3 mr-1" />
            Ne travaille pas
          </Badge>
        );
      case 'assigned_elsewhere':
        return (
            <Badge variant="outline" className="bg-orange-500/10 text-orange-600 border-orange-500/20">
            <AlertCircle className="h-3 w-3 mr-1" />
            Déjà assigné
          </Badge>
        );
    }
  };

  const selectedSecretaire = secretaires.find(s => s.id === selectedSecretaireId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="bg-gradient-to-r from-emerald-500 to-teal-600 bg-clip-text text-transparent">
            Assigner un assistant médical
          </DialogTitle>
          <DialogDescription>
            {besoinOperationNom} - {periode === 'matin' ? 'Matin' : 'Après-midi'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {fetchingData ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label>Assistant médical</Label>
                <Command className="border rounded-lg">
                  <CommandInput placeholder="Rechercher un assistant médical..." />
                  <CommandList>
                    <CommandEmpty>Aucun assistant médical trouvé.</CommandEmpty>
                    <CommandGroup className="max-h-[300px] overflow-y-auto">
                      {secretaires.map((secretaire) => (
                        <CommandItem
                          key={secretaire.id}
                          value={`${secretaire.first_name} ${secretaire.name}`}
                          onSelect={() => setSelectedSecretaireId(secretaire.id)}
                          className={cn(
                            "cursor-pointer",
                            selectedSecretaireId === secretaire.id && "bg-accent"
                          )}
                        >
                          <div className="flex items-center gap-3 w-full">
                            <UserCircle className={cn(
                              "h-4 w-4 flex-shrink-0",
                              selectedSecretaireId === secretaire.id ? "text-primary" : "text-muted-foreground"
                            )} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-medium truncate">
                                  {secretaire.first_name} {secretaire.name}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 flex-wrap">
                                {getStatusBadge(secretaire.status)}
                                {secretaire.status === 'assigned_elsewhere' && (
                                  <span className="text-xs text-muted-foreground truncate">
                                    {secretaire.existing_besoin || secretaire.existing_site}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </div>

              {selectedSecretaire && selectedSecretaire.status === 'not_working' && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Cet assistant médical ne travaille pas ce jour. Un créneau sera automatiquement créé.
                  </AlertDescription>
                </Alert>
              )}

              {selectedSecretaire && selectedSecretaire.status === 'assigned_elsewhere' && (
                <Alert className="border-orange-500/20 bg-orange-500/5">
                  <AlertCircle className="h-4 w-4 text-orange-600" />
                  <AlertDescription className="text-orange-600">
                    Cet assistant médical sera retiré de son assignation actuelle ({selectedSecretaire.existing_besoin || selectedSecretaire.existing_site}) et réassigné ici.
                  </AlertDescription>
                </Alert>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Annuler
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={loading || !selectedSecretaireId || fetchingData}
            className="bg-gradient-to-r from-emerald-500 to-teal-600"
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {selectedSecretaire?.status === 'assigned_elsewhere' ? 'Réassigner' : 'Assigner'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
