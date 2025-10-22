import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

interface Site {
  id: string;
  nom: string;
}

interface TypeIntervention {
  id: string;
  nom: string;
  code: string;
}

interface ReassignOperationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  besoinEffectifId: string;
  currentDate: string;
  currentPeriode: 'matin' | 'apres_midi';
  currentMedecinId: string | null;
  onSuccess: () => void;
}

const BLOC_OPERATOIRE_SITE_ID = '86f1047f-c4ff-441f-a064-42ee2f8ef37a';
const ADMIN_SITE_ID = '00000000-0000-0000-0000-000000000001';

export const ReassignOperationDialog = ({
  open,
  onOpenChange,
  besoinEffectifId,
  currentDate,
  currentPeriode,
  currentMedecinId,
  onSuccess
}: ReassignOperationDialogProps) => {
  const [sites, setSites] = useState<Site[]>([]);
  const [typesIntervention, setTypesIntervention] = useState<TypeIntervention[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string>('');
  const [selectedTypeInterventionId, setSelectedTypeInterventionId] = useState<string>('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      fetchData();
      setSelectedSiteId('');
      setSelectedTypeInterventionId('');
    }
  }, [open]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch active sites (exclude admin site)
      const { data: sitesData, error: sitesError } = await supabase
        .from('sites')
        .select('id, nom')
        .eq('actif', true)
        .neq('id', ADMIN_SITE_ID)
        .order('nom');

      if (sitesError) throw sitesError;

      // Sort sites alphabetically
      const sortedSites = (sitesData || []).sort((a, b) => 
        a.nom.localeCompare(b.nom)
      );

      setSites(sortedSites);

      // Fetch active intervention types
      const { data: typesData, error: typesError } = await supabase
        .from('types_intervention')
        .select('id, nom, code')
        .eq('actif', true)
        .order('nom');

      if (typesError) throw typesError;

      // Sort types alphabetically
      const sortedTypes = (typesData || []).sort((a, b) => 
        a.nom.localeCompare(b.nom)
      );

      setTypesIntervention(sortedTypes);
    } catch (error: any) {
      console.error('Erreur lors du chargement des données:', error);
      toast.error('Erreur lors du chargement des données');
    } finally {
      setLoading(false);
    }
  };

  const handleReassign = async () => {
    if (!selectedSiteId) {
      toast.error('Veuillez sélectionner un site');
      return;
    }

    if (selectedSiteId === BLOC_OPERATOIRE_SITE_ID && !selectedTypeInterventionId) {
      toast.error('Veuillez sélectionner un type d\'intervention pour le bloc opératoire');
      return;
    }

    setLoading(true);
    try {
      // Delete old besoin_effectif (triggers will cascade delete planning and free personnel)
      const { error: deleteError } = await supabase
        .from('besoin_effectif')
        .delete()
        .eq('id', besoinEffectifId);

      if (deleteError) throw deleteError;

      // Create new besoin_effectif
      const newBesoin = {
        date: currentDate,
        demi_journee: currentPeriode,
        medecin_id: currentMedecinId,
        site_id: selectedSiteId,
        type: 'medecin' as const,
        type_intervention_id: selectedSiteId === BLOC_OPERATOIRE_SITE_ID ? selectedTypeInterventionId : null,
        actif: true
      };

      const { error: insertError } = await supabase
        .from('besoin_effectif')
        .insert([newBesoin]);

      if (insertError) throw insertError;

      toast.success('Opération réaffectée avec succès');
      onOpenChange(false);
      onSuccess();
    } catch (error: any) {
      console.error('Erreur lors de la réaffectation:', error);
      toast.error('Erreur lors de la réaffectation: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const isBlocOperatoire = selectedSiteId === BLOC_OPERATOIRE_SITE_ID;

  const handleSiteChange = (siteId: string) => {
    setSelectedSiteId(siteId);
    // Reset type intervention when changing site
    if (siteId !== BLOC_OPERATOIRE_SITE_ID) {
      setSelectedTypeInterventionId('');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Réaffecter le médecin</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="site">Nouveau site</Label>
            <Select value={selectedSiteId} onValueChange={handleSiteChange}>
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

          {isBlocOperatoire && (
            <div className="space-y-2">
              <Label htmlFor="type-intervention">Type d'intervention</Label>
              <Select value={selectedTypeInterventionId} onValueChange={setSelectedTypeInterventionId}>
                <SelectTrigger id="type-intervention">
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

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Annuler
          </Button>
          <Button onClick={handleReassign} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Réaffecter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
