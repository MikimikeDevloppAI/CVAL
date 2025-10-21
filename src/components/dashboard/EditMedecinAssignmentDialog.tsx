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
    // 1. Récupérer les sites où le médecin a des horaires
    const { data: horairesData } = await supabase
      .from('horaires_base_medecins')
      .select('site_id, sites(id, nom)')
      .eq('medecin_id', medecinId)
      .eq('actif', true);

    // 2. Extraire les sites uniques
    const siteIds = new Set<string>();
    const sitesFromHoraires: Site[] = [];
    
    horairesData?.forEach((horaire: any) => {
      if (horaire.sites && !siteIds.has(horaire.sites.id)) {
        const nomLower = horaire.sites.nom.toLowerCase();
        // Exclure bloc opératoire
        if (!nomLower.includes('bloc opératoire')) {
          siteIds.add(horaire.sites.id);
          sitesFromHoraires.push({
            id: horaire.sites.id,
            nom: horaire.sites.nom
          });
        }
      }
    });

    // 3. Ajouter le site Administratif s'il n'est pas déjà présent
    const adminSiteId = '00000000-0000-0000-0000-000000000001';
    if (!siteIds.has(adminSiteId)) {
      const { data: adminSite } = await supabase
        .from('sites')
        .select('id, nom')
        .eq('id', adminSiteId)
        .eq('actif', true)
        .single();
      
      if (adminSite) {
        sitesFromHoraires.push(adminSite);
      }
    }

    // 4. Trier par nom
    sitesFromHoraires.sort((a, b) => a.nom.localeCompare(b.nom));
    setSites(sitesFromHoraires);
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
