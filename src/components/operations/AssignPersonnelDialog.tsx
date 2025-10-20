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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { canPerformBlocRole, getTypeBesoinLabel } from '@/lib/blocHelpers';

interface AvailableSecretary {
  capacite_id: string;
  secretaire_id: string;
  first_name: string;
  name: string;
}

interface AssignPersonnelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  operationId: string;
  date: string;
  periode: 'matin' | 'apres_midi';
  besoinId: string;
  besoinNom: string;
  onSuccess: () => void;
}

export const AssignPersonnelDialog = ({
  open,
  onOpenChange,
  operationId,
  date,
  periode,
  besoinId,
  besoinNom,
  onSuccess,
}: AssignPersonnelDialogProps) => {
  const [availableSecretaries, setAvailableSecretaries] = useState<AvailableSecretary[]>([]);
  const [selectedCapaciteId, setSelectedCapaciteId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      fetchAvailableSecretaries();
      setSelectedCapaciteId('');
    }
  }, [open, date, periode]);

  const fetchAvailableSecretaries = async () => {
    try {
      setLoading(true);
      
      // First, get the besoin code to check competency
      const { data: besoinData, error: besoinError } = await supabase
        .from('besoins_operations')
        .select('code')
        .eq('id', besoinId)
        .single();

      if (besoinError) throw besoinError;

      const besoinCode = besoinData?.code;

      // Fetch available secretaries with their competencies
      const { data, error } = await supabase
        .from('capacite_effective')
        .select(`
          id,
          secretaire_id,
          secretaires (
            id,
            first_name,
            name,
            secretaires_besoins_operations (
              besoins_operations (
                code
              )
            )
          )
        `)
        .eq('date', date)
        .eq('demi_journee', periode)
        .is('planning_genere_bloc_operatoire_id', null)
        .is('besoin_operation_id', null)
        .eq('actif', true);

      if (error) throw error;

      // Filter secretaries based on their competencies
      const formatted = data
        ?.filter(item => {
          if (!item.secretaires) return false;
          
          const secretaire = {
            id: item.secretaires.id,
            besoins_operations: item.secretaires.secretaires_besoins_operations
          };
          
          return canPerformBlocRole(secretaire, besoinCode);
        })
        .map(item => ({
          capacite_id: item.id,
          secretaire_id: item.secretaire_id!,
          first_name: item.secretaires!.first_name || '',
          name: item.secretaires!.name || '',
        })) || [];

      setAvailableSecretaries(formatted);
    } catch (error) {
      console.error('Error fetching available secretaries:', error);
      toast.error('Erreur lors du chargement des secrétaires disponibles');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!selectedCapaciteId) {
      toast.error('Veuillez sélectionner une secrétaire');
      return;
    }

    try {
      setSubmitting(true);
      
      // Get the Bloc Opératoire site ID
      const { data: blocSite, error: siteError } = await supabase
        .from('sites')
        .select('id')
        .eq('nom', 'Bloc opératoire')
        .single();

      if (siteError) throw siteError;

      const { error } = await supabase
        .from('capacite_effective')
        .update({
          planning_genere_bloc_operatoire_id: operationId,
          besoin_operation_id: besoinId,
          site_id: blocSite.id,
        })
        .eq('id', selectedCapaciteId);

      if (error) throw error;

      toast.success('Personnel assigné avec succès');
      onSuccess();
      onOpenChange(false);
    } catch (error) {
      console.error('Error assigning personnel:', error);
      toast.error('Erreur lors de l\'assignation du personnel');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Assigner du personnel</DialogTitle>
          <DialogDescription>
            Personnel qualifié pour : <strong>{besoinNom}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : availableSecretaries.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Aucune secrétaire disponible pour cette période
            </div>
          ) : (
            <RadioGroup value={selectedCapaciteId} onValueChange={setSelectedCapaciteId}>
              <div className="space-y-2">
                {availableSecretaries.map((secretary) => (
                  <div
                    key={secretary.capacite_id}
                    className="flex items-center space-x-2 rounded-lg border border-border p-3 hover:bg-accent/50 transition-colors"
                  >
                    <RadioGroupItem
                      value={secretary.capacite_id}
                      id={secretary.capacite_id}
                    />
                    <Label
                      htmlFor={secretary.capacite_id}
                      className="flex-1 cursor-pointer font-medium"
                    >
                      {secretary.first_name} {secretary.name}
                    </Label>
                  </div>
                ))}
              </div>
            </RadioGroup>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Annuler
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!selectedCapaciteId || submitting}
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Assigner
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
