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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface Secretaire {
  id: string;
  capacite_id: string;
  nom: string;
  periode: 'matin' | 'apres_midi' | 'journee';
  is_1r: boolean;
  is_2f: boolean;
  is_3f: boolean;
}

interface Site {
  id: string;
  nom: string;
}

interface EditSecretaireAssignmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  secretaire: Secretaire;
  date: string;
  siteId: string;
  onSuccess: () => void;
}

export function EditSecretaireAssignmentDialog({
  open,
  onOpenChange,
  secretaire,
  date,
  siteId,
  onSuccess,
}: EditSecretaireAssignmentDialogProps) {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState(siteId);
  const [periode, setPeriode] = useState(secretaire.periode);
  const [responsibility, setResponsibility] = useState<'1r' | '2f' | '3f' | null>(
    secretaire.is_1r ? '1r' : secretaire.is_2f ? '2f' : secretaire.is_3f ? '3f' : null
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      fetchSites();
      setSelectedSiteId(siteId);
      setPeriode(secretaire.periode);
      setResponsibility(
        secretaire.is_1r ? '1r' : secretaire.is_2f ? '2f' : secretaire.is_3f ? '3f' : null
      );
    }
  }, [open, secretaire, siteId]);

  const fetchSites = async () => {
    const { data: sitesData } = await supabase
      .from('sites')
      .select('id, nom')
      .eq('actif', true)
      .order('nom');

    if (sitesData) {
      // Filter out administrative and bloc opératoire sites
      const filteredSites = sitesData.filter(site => {
        const nomLower = site.nom.toLowerCase();
        return !nomLower.includes('administratif') && !nomLower.includes('bloc opératoire');
      });
      setSites(filteredSites);
    }
  };

  const handleSubmit = async () => {
    // Validate responsibility requires full day
    if (responsibility && periode !== 'journee') {
      toast({
        title: 'Attention',
        description: 'Une responsabilité nécessite une assignation pour toute la journée',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      // Delete old assignments
      const { error: deleteError } = await supabase
        .from('capacite_effective')
        .delete()
        .eq('secretaire_id', secretaire.id)
        .eq('date', date);

      if (deleteError) throw deleteError;

      // Create new assignments
      const entries: Array<{ demi_journee: 'matin' | 'apres_midi' }> = periode === 'journee'
        ? [{ demi_journee: 'matin' }, { demi_journee: 'apres_midi' }]
        : [{ demi_journee: periode as 'matin' | 'apres_midi' }];

      for (const entry of entries) {
        const { error } = await supabase
          .from('capacite_effective')
          .insert([{
            date,
            secretaire_id: secretaire.id,
            site_id: selectedSiteId,
            demi_journee: entry.demi_journee,
            is_1r: responsibility === '1r',
            is_2f: responsibility === '2f',
            is_3f: responsibility === '3f',
            actif: true,
          }]);

        if (error) throw error;
      }

      toast({
        title: 'Succès',
        description: 'Assignation modifiée avec succès',
      });

      onSuccess();
    } catch (error: any) {
      console.error('Error updating secretaire:', error);
      toast({
        title: 'Erreur',
        description: error.message || 'Impossible de modifier l\'assignation',
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
            Modifier l'assignation
          </DialogTitle>
          <DialogDescription>
            Secrétaire : {secretaire.nom}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Site</Label>
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

          <div className="space-y-2">
            <Label>Période</Label>
            <RadioGroup value={periode} onValueChange={(v: any) => setPeriode(v)}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="matin" id="edit-sec-matin" />
                <Label htmlFor="edit-sec-matin" className="font-normal cursor-pointer">
                  Matin
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="apres_midi" id="edit-sec-apres_midi" />
                <Label htmlFor="edit-sec-apres_midi" className="font-normal cursor-pointer">
                  Après-midi
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="journee" id="edit-sec-journee" />
                <Label htmlFor="edit-sec-journee" className="font-normal cursor-pointer">
                  Journée complète
                </Label>
              </div>
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label>Responsabilité (optionnelle)</Label>
            <div className="flex flex-col space-y-2">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="edit-resp-1r"
                  checked={responsibility === '1r'}
                  onCheckedChange={(checked) => {
                    setResponsibility(checked ? '1r' : null);
                    if (checked) setPeriode('journee');
                  }}
                />
                <Label htmlFor="edit-resp-1r" className="font-normal cursor-pointer">
                  1R
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="edit-resp-2f"
                  checked={responsibility === '2f'}
                  onCheckedChange={(checked) => {
                    setResponsibility(checked ? '2f' : null);
                    if (checked) setPeriode('journee');
                  }}
                />
                <Label htmlFor="edit-resp-2f" className="font-normal cursor-pointer">
                  2F
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="edit-resp-3f"
                  checked={responsibility === '3f'}
                  onCheckedChange={(checked) => {
                    setResponsibility(checked ? '3f' : null);
                    if (checked) setPeriode('journee');
                  }}
                />
                <Label htmlFor="edit-resp-3f" className="font-normal cursor-pointer">
                  3F
                </Label>
              </div>
            </div>
            {responsibility && (
              <p className="text-xs text-muted-foreground">
                Une responsabilité implique automatiquement une présence toute la journée
              </p>
            )}
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
            Enregistrer
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
