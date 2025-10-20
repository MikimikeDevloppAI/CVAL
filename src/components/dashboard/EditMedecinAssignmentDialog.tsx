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
import { Loader2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface Medecin {
  id: string;
  besoin_id: string;
  nom: string;
  periode: 'matin' | 'apres_midi' | 'journee';
}

interface Site {
  id: string;
  nom: string;
}

interface EditMedecinAssignmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  medecin: Medecin;
  date: string;
  siteId: string;
  onSuccess: () => void;
}

export function EditMedecinAssignmentDialog({
  open,
  onOpenChange,
  medecin,
  date,
  siteId,
  onSuccess,
}: EditMedecinAssignmentDialogProps) {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState(siteId);
  const [periode, setPeriode] = useState(medecin.periode);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      fetchSites();
      setSelectedSiteId(siteId);
      setPeriode(medecin.periode);
    }
  }, [open, medecin, siteId]);

  const fetchSites = async () => {
    const { data } = await supabase
      .from('sites')
      .select('id, nom')
      .eq('actif', true)
      .order('nom');

    if (data) {
      setSites(data);
    }
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      // Delete old assignments
      const { error: deleteError } = await supabase
        .from('besoin_effectif')
        .delete()
        .eq('medecin_id', medecin.id)
        .eq('date', date);

      if (deleteError) throw deleteError;

      // Create new assignments
      const entries = periode === 'journee'
        ? [{ demi_journee: 'matin' }, { demi_journee: 'apres_midi' }]
        : [{ demi_journee: periode }];

      for (const entry of entries) {
        const { error } = await supabase
          .from('besoin_effectif')
          .insert([{
            date,
            medecin_id: medecin.id,
            site_id: selectedSiteId,
            type: 'medecin',
            demi_journee: entry.demi_journee,
            actif: true,
          }]);

        if (error) throw error;
      }

      toast({
        title: 'Succès',
        description: 'Assignation modifiée avec succès',
      });

      onSuccess();
    } catch (error) {
      console.error('Error updating medecin:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible de modifier l\'assignation',
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
          <DialogTitle className="bg-gradient-to-r from-cyan-500 to-teal-600 bg-clip-text text-transparent">
            Modifier l'assignation
          </DialogTitle>
          <DialogDescription>
            Médecin : {medecin.nom}
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
                <RadioGroupItem value="matin" id="edit-matin" />
                <Label htmlFor="edit-matin" className="font-normal cursor-pointer">
                  Matin
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="apres_midi" id="edit-apres_midi" />
                <Label htmlFor="edit-apres_midi" className="font-normal cursor-pointer">
                  Après-midi
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="journee" id="edit-journee" />
                <Label htmlFor="edit-journee" className="font-normal cursor-pointer">
                  Journée complète
                </Label>
              </div>
            </RadioGroup>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Annuler
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={loading}
            className="bg-gradient-to-r from-cyan-500 to-teal-600"
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Enregistrer
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
