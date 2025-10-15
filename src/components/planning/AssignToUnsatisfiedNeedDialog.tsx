import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { getAvailableSecretariesForSite, getAvailableSecretariesForBloc } from '@/lib/planningHelpers';

interface AssignToUnsatisfiedNeedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  need: {
    date: string;
    periode: 'matin' | 'apres_midi';
    type: 'site' | 'bloc';
    site_id?: string;
    site_nom?: string;
    type_besoin_bloc?: string;
    planning_genere_personnel_id?: string;
  };
  onSuccess: () => void;
}

export function AssignToUnsatisfiedNeedDialog({
  open,
  onOpenChange,
  need,
  onSuccess,
}: AssignToUnsatisfiedNeedDialogProps) {
  const [loading, setLoading] = useState(false);
  const [availableSecretaries, setAvailableSecretaries] = useState<any[]>([]);
  const [selectedSecretaryId, setSelectedSecretaryId] = useState<string>('');
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      fetchAvailableSecretaries();
    } else {
      setSelectedSecretaryId('');
    }
  }, [open, need]);

  const fetchAvailableSecretaries = async () => {
    setLoading(true);
    try {
      let secretaries;
      if (need.type === 'site' && need.site_id) {
        secretaries = await getAvailableSecretariesForSite(
          need.date,
          need.periode,
          need.site_id
        );
      } else if (need.type === 'bloc' && need.type_besoin_bloc) {
        secretaries = await getAvailableSecretariesForBloc(
          need.date,
          need.periode,
          need.type_besoin_bloc
        );
      } else {
        secretaries = [];
      }
      setAvailableSecretaries(secretaries);
    } catch (error) {
      console.error('Error fetching available secretaries:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible de charger les secrétaires disponibles',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAssign = async () => {
    if (!selectedSecretaryId) {
      toast({
        title: 'Attention',
        description: 'Veuillez sélectionner une secrétaire',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      if (need.type === 'bloc' && need.planning_genere_personnel_id) {
        // Update existing row for bloc
        const { error } = await supabase
          .from('planning_genere_personnel')
          .update({ secretaire_id: selectedSecretaryId })
          .eq('id', need.planning_genere_personnel_id);

        if (error) throw error;
      } else if (need.type === 'site' && need.site_id) {
        // Get max ordre for this site/date/periode
        const { data: existingAssignments, error: fetchError } = await supabase
          .from('planning_genere_personnel')
          .select('ordre')
          .eq('date', need.date)
          .eq('periode', need.periode)
          .eq('site_id', need.site_id)
          .eq('type_assignation', 'site')
          .order('ordre', { ascending: false })
          .limit(1);

        if (fetchError) throw fetchError;

        const maxOrdre = existingAssignments && existingAssignments.length > 0
          ? existingAssignments[0].ordre
          : 0;

        // Insert new assignment
        const { error: insertError } = await supabase
          .from('planning_genere_personnel')
          .insert({
            date: need.date,
            periode: need.periode,
            site_id: need.site_id,
            secretaire_id: selectedSecretaryId,
            type_assignation: 'site',
            ordre: maxOrdre + 1,
            is_1r: false,
            is_2f: false,
            is_3f: false,
          });

        if (insertError) throw insertError;
      }

      toast({
        title: 'Succès',
        description: 'Secrétaire assignée avec succès',
      });
      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error assigning secretary:', error);
      toast({
        title: 'Erreur',
        description: error.message || 'Erreur lors de l\'assignation',
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
          <DialogTitle>Assigner une secrétaire</DialogTitle>
          <DialogDescription>
            {need.type === 'site'
              ? `${need.site_nom} - ${need.periode === 'matin' ? 'Matin' : 'Après-midi'}`
              : `Bloc opératoire - ${need.type_besoin_bloc || 'Personnel'} - ${need.periode === 'matin' ? 'Matin' : 'Après-midi'}`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Secrétaire disponible</Label>
            <Select
              value={selectedSecretaryId}
              onValueChange={setSelectedSecretaryId}
              disabled={loading || availableSecretaries.length === 0}
            >
              <SelectTrigger>
                <SelectValue placeholder="Sélectionner une secrétaire" />
              </SelectTrigger>
              <SelectContent>
                {availableSecretaries.map((sec) => (
                  <SelectItem key={sec.id} value={sec.id}>
                    {sec.first_name} {sec.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {availableSecretaries.length === 0 && !loading && (
              <p className="text-sm text-muted-foreground">
                Aucune secrétaire disponible pour ce créneau
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Annuler
          </Button>
          <Button onClick={handleAssign} disabled={loading || !selectedSecretaryId}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Assigner
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
