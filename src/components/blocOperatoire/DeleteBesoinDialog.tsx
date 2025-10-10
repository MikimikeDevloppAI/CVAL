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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';

interface Site {
  id: string;
  nom: string;
}

interface DeleteBesoinDialogProps {
  besoinId: string;
  medecinName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function DeleteBesoinDialog({
  besoinId,
  medecinName,
  open,
  onOpenChange,
  onSuccess,
}: DeleteBesoinDialogProps) {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const fetchSites = async () => {
      const { data, error } = await supabase
        .from('sites')
        .select('id, nom')
        .neq('nom', 'Clinique La Vallée - Bloc opératoire')
        .eq('actif', true)
        .order('nom');

      if (error) {
        console.error('Erreur lors du chargement des sites:', error);
        return;
      }

      setSites(data || []);
    };

    if (open) {
      fetchSites();
      setSelectedSiteId('');
    }
  }, [open]);

  const handleDelete = async () => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('besoin_effectif')
        .delete()
        .eq('id', besoinId);

      if (error) throw error;

      toast({
        title: 'Succès',
        description: 'Besoin supprimé avec succès',
      });

      onOpenChange(false);
      onSuccess();
    } catch (error) {
      console.error('Erreur lors de la suppression:', error);
      toast({
        title: 'Erreur',
        description: 'Erreur lors de la suppression',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleReassign = async () => {
    if (!selectedSiteId) {
      toast({
        title: 'Attention',
        description: 'Veuillez sélectionner un site',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('besoin_effectif')
        .update({ site_id: selectedSiteId })
        .eq('id', besoinId);

      if (error) throw error;

      toast({
        title: 'Succès',
        description: 'Médecin réassigné avec succès',
      });

      onOpenChange(false);
      onSuccess();
    } catch (error) {
      console.error('Erreur lors de la réassignation:', error);
      toast({
        title: 'Erreur',
        description: 'Erreur lors de la réassignation',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Supprimer l'opération</DialogTitle>
          <DialogDescription>
            Voulez-vous réassigner {medecinName} à un autre site ou supprimer définitivement ce besoin ?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="site">Réassigner à un site (optionnel)</Label>
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
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Annuler
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={loading}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Supprimer
          </Button>
          <Button
            onClick={handleReassign}
            disabled={loading || !selectedSiteId}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Réassigner
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
