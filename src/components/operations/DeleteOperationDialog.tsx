import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { Loader2, AlertTriangle } from 'lucide-react';

const ADMIN_SITE_ID = '00000000-0000-0000-0000-000000000001';

interface Site {
  id: string;
  nom: string;
}

interface TypeIntervention {
  id: string;
  nom: string;
}

interface DeleteOperationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  operation: {
    id: string;
    besoin_effectif_id: string | null;
    date: string;
    periode: 'matin' | 'apres_midi';
    type_intervention_nom: string;
    medecin_id: string | null;
    medecin_nom: string;
  };
  onSuccess: () => void;
}

export function DeleteOperationDialog({
  open,
  onOpenChange,
  operation,
  onSuccess,
}: DeleteOperationDialogProps) {
  const [reassign, setReassign] = useState<'yes' | 'no'>('no');
  const [selectedSiteId, setSelectedSiteId] = useState<string>('');
  const [selectedTypeInterventionId, setSelectedTypeInterventionId] = useState<string>('');
  const [sites, setSites] = useState<Site[]>([]);
  const [typesIntervention, setTypesIntervention] = useState<TypeIntervention[]>([]);
  const [loading, setLoading] = useState(false);
  const [blocSiteId, setBlocSiteId] = useState<string>('');

  useEffect(() => {
    if (open) {
      fetchSitesAndTypes();
    }
  }, [open]);

  const fetchSitesAndTypes = async () => {
    try {
      // Fetch sites (exclude administrative site)
      const { data: sitesData } = await supabase
        .from('sites')
        .select('id, nom')
        .eq('actif', true)
        .order('nom');

      if (sitesData) {
        const filteredSites = sitesData.filter(
          (site) => site.id !== ADMIN_SITE_ID
        );
        setSites(filteredSites);

        // Find bloc operatoire site
        const blocSite = filteredSites.find((site) =>
          site.nom.toLowerCase().includes('bloc opératoire')
        );
        if (blocSite) {
          setBlocSiteId(blocSite.id);
        }
      }

      // Fetch types intervention
      const { data: typesData } = await supabase
        .from('types_intervention')
        .select('id, nom')
        .eq('actif', true)
        .order('nom');

      if (typesData) {
        setTypesIntervention(typesData);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible de charger les données',
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async () => {
    if (reassign === 'yes') {
      if (!selectedSiteId) {
        toast({
          title: 'Site requis',
          description: 'Veuillez sélectionner un site pour réaffecter le médecin',
          variant: 'destructive',
        });
        return;
      }

      if (selectedSiteId === blocSiteId && !selectedTypeInterventionId) {
        toast({
          title: 'Type d\'intervention requis',
          description: 'Veuillez sélectionner un type d\'intervention pour le bloc opératoire',
          variant: 'destructive',
        });
        return;
      }
    }

    setLoading(true);
    try {
      if (reassign === 'yes') {
        // Scenario A: Reassign the doctor

        // 1. Get all capacite_effective linked to this operation
        const { data: capacites } = await supabase
          .from('capacite_effective')
          .select('id')
          .eq('planning_genere_bloc_operatoire_id', operation.id);

        // 2. Reset the capacites to administrative
        if (capacites && capacites.length > 0) {
          const { error: updateError } = await supabase
            .from('capacite_effective')
            .update({
              planning_genere_bloc_operatoire_id: null,
              besoin_operation_id: null,
              site_id: ADMIN_SITE_ID,
            })
            .in('id', capacites.map((c) => c.id));

          if (updateError) throw updateError;
        }

        // 3. Delete the old besoin_effectif (this will trigger deletion of planning_genere_bloc_operatoire)
        if (operation.besoin_effectif_id) {
          const { error: deleteError } = await supabase
            .from('besoin_effectif')
            .delete()
            .eq('id', operation.besoin_effectif_id);

          if (deleteError) throw deleteError;
        }

        // 4. Create new besoin_effectif for the reassigned site
        const { error: insertError } = await supabase
          .from('besoin_effectif')
          .insert({
            date: operation.date,
            demi_journee: operation.periode,
            medecin_id: operation.medecin_id,
            site_id: selectedSiteId,
            type: selectedSiteId === blocSiteId ? 'bloc_operatoire' : 'medecin',
            type_intervention_id:
              selectedSiteId === blocSiteId ? selectedTypeInterventionId : null,
            actif: true,
          });

        if (insertError) throw insertError;

        toast({
          title: 'Succès',
          description: 'Opération supprimée et médecin réaffecté',
        });
      } else {
        // Scenario B: Just delete (triggers will clean up capacites)
        if (operation.besoin_effectif_id) {
          const { error: deleteError } = await supabase
            .from('besoin_effectif')
            .delete()
            .eq('id', operation.besoin_effectif_id);

          if (deleteError) throw deleteError;
        }

        toast({
          title: 'Succès',
          description: 'Opération supprimée',
        });
      }

      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error deleting operation:', error);
      toast({
        title: 'Erreur',
        description: error.message || 'Impossible de supprimer l\'opération',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Supprimer l'opération
          </DialogTitle>
          <DialogDescription>
            Êtes-vous sûr de vouloir supprimer cette opération ?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Operation details */}
          <div className="p-4 rounded-lg bg-muted/50 space-y-2">
            <p className="font-medium">{operation.type_intervention_nom}</p>
            <p className="text-sm text-muted-foreground">
              Dr. {operation.medecin_nom}
            </p>
            <p className="text-sm text-muted-foreground">
              {new Date(operation.date).toLocaleDateString('fr-FR', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}{' '}
              - {operation.periode === 'matin' ? 'Matin' : 'Après-midi'}
            </p>
          </div>

          {/* Reassignment options */}
          <div className="space-y-4">
            <Label>Que souhaitez-vous faire avec le médecin ?</Label>
            <RadioGroup value={reassign} onValueChange={(value) => setReassign(value as 'yes' | 'no')}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="no" id="no" />
                <Label htmlFor="no" className="font-normal cursor-pointer">
                  Ne pas réaffecter (supprimer simplement l'opération)
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="yes" id="yes" />
                <Label htmlFor="yes" className="font-normal cursor-pointer">
                  Réaffecter le médecin à un autre site
                </Label>
              </div>
            </RadioGroup>

            {reassign === 'yes' && (
              <div className="space-y-4 pl-6 border-l-2 border-primary/20">
                <div className="space-y-2">
                  <Label htmlFor="site">Site de réaffectation *</Label>
                  <Select value={selectedSiteId} onValueChange={setSelectedSiteId}>
                    <SelectTrigger id="site">
                      <SelectValue placeholder="Sélectionner un site" />
                    </SelectTrigger>
                    <SelectContent>
                      {sites.map((site) => (
                        <SelectItem key={site.id} value={site.id}>
                          {site.nom}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {selectedSiteId === blocSiteId && (
                  <div className="space-y-2">
                    <Label htmlFor="type">Type d'intervention *</Label>
                    <Select
                      value={selectedTypeInterventionId}
                      onValueChange={setSelectedTypeInterventionId}
                    >
                      <SelectTrigger id="type">
                        <SelectValue placeholder="Sélectionner un type" />
                      </SelectTrigger>
                      <SelectContent>
                        {typesIntervention.map((type) => (
                          <SelectItem key={type.id} value={type.id}>
                            {type.nom}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Annuler
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {reassign === 'yes' ? 'Réaffecter' : 'Supprimer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
