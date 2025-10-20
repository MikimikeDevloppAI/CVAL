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
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

interface AvailableSecretary {
  capacite_id: string | null; // null si pas de capacité existante
  secretaire_id: string;
  first_name: string;
  name: string;
  current_site_name: string | null; // null si pas encore assignée
  has_capacity: boolean;
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

const BLOC_OPERATOIRE_SITE_ID = '86f1047f-c4ff-441f-a064-42ee2f8ef37a';

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
  const [selectedSecretaireId, setSelectedSecretaireId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      fetchAvailableSecretaries();
      setSelectedSecretaireId('');
    }
  }, [open, date, periode]);

  const fetchAvailableSecretaries = async () => {
    try {
      setLoading(true);
      
      // Get the besoin code to check competency
      const { data: besoinData, error: besoinError } = await supabase
        .from('besoins_operations')
        .select('code')
        .eq('id', besoinId)
        .single();

      if (besoinError) throw besoinError;
      const besoinCode = besoinData?.code;

      // Fetch all active secretaries with their competencies and capacities for this date/periode
      const { data: secretairesData, error: secretairesError } = await supabase
        .from('secretaires')
        .select(`
          id,
          first_name,
          name,
          secretaires_besoins_operations (
            besoins_operations (
              code
            )
          )
        `)
        .eq('actif', true);

      if (secretairesError) throw secretairesError;

      // Get all capacities for this date/periode (all sites)
      const { data: capacitesData, error: capacitesError } = await supabase
        .from('capacite_effective')
        .select(`
          id,
          secretaire_id,
          site_id,
          sites (
            nom
          ),
          planning_genere_bloc_operatoire_id,
          besoin_operation_id
        `)
        .eq('date', date)
        .eq('demi_journee', periode)
        .eq('actif', true);

      if (capacitesError) throw capacitesError;

      // Filter secretaries based on competency and map with their current assignment
      const formatted: AvailableSecretary[] = [];
      
      for (const sec of secretairesData || []) {
        // Direct match: check if the secretary has this exact besoin code
        const hasCompetency = sec.secretaires_besoins_operations?.some(
          sbo => sbo.besoins_operations.code === besoinCode
        );
        
        if (!hasCompetency) {
          continue;
        }

        // Find their capacity for this date/periode
        const capacity = capacitesData?.find(c => c.secretaire_id === sec.id);

        // Only show if:
        // 1. They have a capacity but NOT already assigned to this operation
        // 2. They don't have a capacity at all (we'll create it)
        const isAlreadyAssignedToThisOperation = 
          capacity?.planning_genere_bloc_operatoire_id === operationId && 
          capacity?.besoin_operation_id === besoinId;

        if (isAlreadyAssignedToThisOperation) {
          continue; // Skip - already assigned to this exact operation/role
        }

        formatted.push({
          capacite_id: capacity?.id || null,
          secretaire_id: sec.id,
          first_name: sec.first_name || '',
          name: sec.name || '',
          current_site_name: capacity?.sites?.nom || null,
          has_capacity: !!capacity
        });
      }

      setAvailableSecretaries(formatted);
    } catch (error) {
      console.error('Error fetching available secretaries:', error);
      toast.error('Erreur lors du chargement des secrétaires disponibles');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!selectedSecretaireId) {
      toast.error('Veuillez sélectionner une secrétaire');
      return;
    }

    try {
      setSubmitting(true);
      
      const selectedSecretary = availableSecretaries.find(s => s.secretaire_id === selectedSecretaireId);
      if (!selectedSecretary) {
        throw new Error('Secrétaire non trouvée');
      }

      if (selectedSecretary.has_capacity && selectedSecretary.capacite_id) {
        // Update existing capacity: change site to Bloc and assign to operation
        const { error } = await supabase
          .from('capacite_effective')
          .update({
            site_id: BLOC_OPERATOIRE_SITE_ID,
            planning_genere_bloc_operatoire_id: operationId,
            besoin_operation_id: besoinId,
          })
          .eq('id', selectedSecretary.capacite_id);

        if (error) throw error;
      } else {
        // Create new capacity for this secretary
        const { error } = await supabase
          .from('capacite_effective')
          .insert({
            date: date,
            demi_journee: periode,
            secretaire_id: selectedSecretaireId,
            site_id: BLOC_OPERATOIRE_SITE_ID,
            planning_genere_bloc_operatoire_id: operationId,
            besoin_operation_id: besoinId,
            actif: true
          });

        if (error) throw error;
      }

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
              Aucune secrétaire qualifiée disponible
            </div>
          ) : (
            <RadioGroup value={selectedSecretaireId} onValueChange={setSelectedSecretaireId}>
              <div className="space-y-2">
                {availableSecretaries.map((secretary) => (
                  <div
                    key={secretary.secretaire_id}
                    className="flex items-center space-x-2 rounded-lg border border-border p-3 hover:bg-accent/50 transition-colors"
                  >
                    <RadioGroupItem
                      value={secretary.secretaire_id}
                      id={secretary.secretaire_id}
                    />
                    <Label
                      htmlFor={secretary.secretaire_id}
                      className="flex-1 cursor-pointer"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">
                          {secretary.first_name} {secretary.name}
                        </span>
                        {secretary.current_site_name && (
                          <Badge variant="outline" className="ml-2">
                            {secretary.current_site_name}
                          </Badge>
                        )}
                        {!secretary.has_capacity && (
                          <Badge variant="secondary" className="ml-2">
                            Nouvelle capacité
                          </Badge>
                        )}
                      </div>
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
            disabled={!selectedSecretaireId || submitting}
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Assigner
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
