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
import { Loader2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface Site {
  id: string;
  nom: string;
}

interface TypeIntervention {
  id: string;
  nom: string;
  code: string;
}

interface EditMedecinAssignmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  medecinId: string;
  medecinNom: string;
  date: string;
  currentSiteId: string;
  periode: 'matin' | 'apres_midi' | 'journee';
  onSuccess: () => void;
}

export function EditMedecinAssignmentDialog({
  open,
  onOpenChange,
  medecinId,
  medecinNom,
  date,
  currentSiteId,
  periode,
  onSuccess,
}: EditMedecinAssignmentDialogProps) {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState(currentSiteId);
  const [typesIntervention, setTypesIntervention] = useState<TypeIntervention[]>([]);
  const [selectedTypeInterventionId, setSelectedTypeInterventionId] = useState<string>('');
  const [selectedPeriod, setSelectedPeriod] = useState<'matin' | 'apres_midi' | 'toute_journee'>(
    periode === 'journee' ? 'toute_journee' : periode
  );
  const [loading, setLoading] = useState(false);

  const BLOC_OPERATOIRE_SITE_ID = '86f1047f-c4ff-441f-a064-42ee2f8ef37a';

  useEffect(() => {
    if (open) {
      fetchSites();
      fetchTypesIntervention();
      setSelectedSiteId(currentSiteId);
      setSelectedTypeInterventionId('');
      setSelectedPeriod(periode === 'journee' ? 'toute_journee' : periode);
    }
  }, [open, currentSiteId, periode]);

  const fetchSites = async () => {
    const ADMIN_SITE_ID = '00000000-0000-0000-0000-000000000001';
    
    // Récupérer tous les sites actifs (y compris le bloc opératoire, mais pas administratif)
    const { data: sitesData } = await supabase
      .from('sites')
      .select('id, nom')
      .eq('actif', true)
      .neq('id', ADMIN_SITE_ID)
      .order('nom');
    
    if (sitesData) {
      setSites(sitesData);
    }
  };

  const fetchTypesIntervention = async () => {
    const { data } = await supabase
      .from('types_intervention')
      .select('id, nom, code')
      .eq('actif', true)
      .order('nom');
    
    if (data) {
      setTypesIntervention(data);
    }
  };

  const handleSubmit = async () => {
    // Validation
    if (selectedSiteId === BLOC_OPERATOIRE_SITE_ID && !selectedTypeInterventionId) {
      toast({
        title: 'Erreur',
        description: 'Veuillez sélectionner un type d\'intervention pour le bloc opératoire',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      // Construire les données de mise à jour
      let updateData: any = { 
        site_id: selectedSiteId 
      };
      
      // Si on passe au bloc opératoire, ajouter type_intervention_id
      if (selectedSiteId === BLOC_OPERATOIRE_SITE_ID) {
        updateData.type_intervention_id = selectedTypeInterventionId;
      } else {
        // Si on quitte le bloc opératoire, supprimer type_intervention_id
        updateData.type_intervention_id = null;
      }

      // Build the query to filter by the specific period(s)
      let query = supabase
        .from('besoin_effectif')
        .update(updateData)
        .eq('medecin_id', medecinId)
        .eq('date', date)
        .eq('type', 'medecin')
        .eq('actif', true);

      // Filter by the specific demi-journee(s)
      if (selectedPeriod === 'toute_journee') {
        // For full day, update both periods
        query = query.in('demi_journee', ['matin', 'apres_midi']);
      } else {
        // For specific half-day, only update that period
        query = query.eq('demi_journee', selectedPeriod);
      }

      const { data, error } = await query.select('id, demi_journee, site_id');

      if (error) throw error;

      if (!data || data.length === 0) {
        toast({
          title: 'Aucun créneau trouvé',
          description: "Aucun besoin effectif actif ne correspond à cette période.",
          variant: 'destructive',
        });
        return;
      }

      toast({
        title: 'Succès',
        description: 'Médecin réaffecté avec succès',
      });

      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error updating medecin:', error);
      toast({
        title: 'Erreur',
        description: error.message || 'Impossible de réaffecter le médecin',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="bg-gradient-to-r from-teal-500 to-cyan-600 bg-clip-text text-transparent">
            Modifier le besoin
          </DialogTitle>
          <DialogDescription>
            Médecin : {medecinNom}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Période</Label>
            <Select
              value={selectedPeriod}
              onValueChange={(value: 'matin' | 'apres_midi' | 'toute_journee') => setSelectedPeriod(value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="matin">Matin</SelectItem>
                <SelectItem value="apres_midi">Après-midi</SelectItem>
                <SelectItem value="toute_journee">Toute la journée</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Nouveau site</Label>
            <Select 
              value={selectedSiteId} 
              onValueChange={(value) => {
                setSelectedSiteId(value);
                // Reset type intervention si on quitte le bloc
                if (value !== BLOC_OPERATOIRE_SITE_ID) {
                  setSelectedTypeInterventionId('');
                }
              }}
            >
              <SelectTrigger>
                <SelectValue />
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

          {/* Afficher le sélecteur de type d'intervention seulement pour le bloc */}
          {selectedSiteId === BLOC_OPERATOIRE_SITE_ID && (
            <div className="space-y-2">
              <Label>Type d'intervention *</Label>
              <Select value={selectedTypeInterventionId} onValueChange={setSelectedTypeInterventionId}>
                <SelectTrigger>
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

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Annuler
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={loading}
            className="bg-gradient-to-r from-teal-500 to-cyan-600"
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Réaffecter
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
