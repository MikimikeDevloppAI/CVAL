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
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      fetchSites();
      setSelectedSiteId(currentSiteId);
    }
  }, [open, currentSiteId]);

  const fetchSites = async () => {
    const { data: sitesData } = await supabase
      .from('sites')
      .select('id, nom')
      .eq('actif', true)
      .order('nom');

    if (sitesData) {
      setSites(sitesData);
    }
  };

  const handleSubmit = async () => {
    if (selectedSiteId === currentSiteId) {
      toast({
        title: 'Information',
        description: 'Aucune modification à effectuer',
      });
      onOpenChange(false);
      return;
    }

    setLoading(true);
    try {
      // Update site_id for all besoins effectifs of this medecin on this date
      const { error } = await supabase
        .from('besoin_effectif')
        .update({ site_id: selectedSiteId })
        .eq('medecin_id', medecinId)
        .eq('date', date)
        .eq('site_id', currentSiteId)
        .eq('type', 'medecin');

      if (error) throw error;

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
            Réaffecter le médecin
          </DialogTitle>
          <DialogDescription>
            Médecin : {medecinNom}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Nouveau site</Label>
            <Select value={selectedSiteId} onValueChange={setSelectedSiteId}>
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
