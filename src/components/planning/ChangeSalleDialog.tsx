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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Loader2, AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface ChangeSalleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  operation: {
    id: string;
    date: string;
    periode: 'matin' | 'apres_midi';
    salle_assignee: string;
    type_intervention_nom: string;
  };
  onSuccess: () => void;
}

const SALLES = ['rouge', 'verte', 'jaune'];

export function ChangeSalleDialog({
  open,
  onOpenChange,
  operation,
  onSuccess,
}: ChangeSalleDialogProps) {
  const [loading, setLoading] = useState(false);
  const [selectedSalle, setSelectedSalle] = useState('');
  const [conflict, setConflict] = useState<{
    id: string;
    type_intervention_nom: string;
  } | null>(null);
  const [action, setAction] = useState<'change' | 'swap'>('change');
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      setSelectedSalle('');
      setConflict(null);
      setAction('change');
    }
  }, [open]);

  const checkConflict = async (salle: string) => {
    try {
      const { data, error } = await supabase
        .from('planning_genere_bloc_operatoire')
        .select('id, type_intervention:types_intervention(nom)')
        .eq('date', operation.date)
        .eq('periode', operation.periode)
        .eq('salle_assignee', salle)
        .neq('id', operation.id)
        .neq('statut', 'annule')
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setConflict({
          id: data.id,
          type_intervention_nom: data.type_intervention?.nom || 'Intervention inconnue',
        });
      } else {
        setConflict(null);
      }
    } catch (error) {
      console.error('Error checking conflict:', error);
    }
  };

  const handleSalleChange = (salle: string) => {
    setSelectedSalle(salle);
    checkConflict(salle);
  };

  const handleSubmit = async () => {
    if (!selectedSalle) {
      toast({
        title: 'Attention',
        description: 'Veuillez sélectionner une salle',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      if (conflict && action === 'swap') {
        // Swap the two operations' rooms
        const { error: error1 } = await supabase
          .from('planning_genere_bloc_operatoire')
          .update({ salle_assignee: selectedSalle })
          .eq('id', operation.id);

        if (error1) throw error1;

        const { error: error2 } = await supabase
          .from('planning_genere_bloc_operatoire')
          .update({ salle_assignee: operation.salle_assignee })
          .eq('id', conflict.id);

        if (error2) throw error2;

        toast({
          title: 'Succès',
          description: 'Salles échangées avec succès',
        });
      } else {
        // Simply change the room (conflict was resolved or there was none)
        const { error } = await supabase
          .from('planning_genere_bloc_operatoire')
          .update({ salle_assignee: selectedSalle })
          .eq('id', operation.id);

        if (error) throw error;

        toast({
          title: 'Succès',
          description: 'Salle modifiée avec succès',
        });
      }

      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error changing room:', error);
      toast({
        title: 'Erreur',
        description: error.message || 'Erreur lors du changement de salle',
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
          <DialogTitle>Changer de salle</DialogTitle>
          <DialogDescription>
            {operation.type_intervention_nom} - {operation.periode === 'matin' ? 'Matin' : 'Après-midi'}
            <br />
            Salle actuelle: <strong>{operation.salle_assignee}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Nouvelle salle</Label>
            <RadioGroup value={selectedSalle} onValueChange={handleSalleChange}>
              {SALLES.filter(s => s !== operation.salle_assignee).map((salle) => (
                <div key={salle} className="flex items-center space-x-2">
                  <RadioGroupItem value={salle} id={`salle-${salle}`} />
                  <Label htmlFor={`salle-${salle}`} className="capitalize cursor-pointer">
                    Salle {salle}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          {conflict && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <div className="space-y-2">
                  <p>
                    La salle {selectedSalle} est déjà occupée par : <strong>{conflict.type_intervention_nom}</strong>
                  </p>
                  <div className="space-y-2 mt-3">
                    <Label>Action à effectuer</Label>
                    <RadioGroup value={action} onValueChange={(v) => setAction(v as 'change' | 'swap')}>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="swap" id="action-swap" />
                        <Label htmlFor="action-swap" className="cursor-pointer">
                          Échanger les salles (recommandé)
                        </Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="change" id="action-change" />
                        <Label htmlFor="action-change" className="cursor-pointer">
                          Forcer le changement (peut créer un conflit)
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>
                </div>
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Annuler
          </Button>
          <Button onClick={handleSubmit} disabled={loading || !selectedSalle}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {conflict && action === 'swap' ? 'Échanger' : 'Changer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
