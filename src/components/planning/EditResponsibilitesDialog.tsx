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
import { Loader2 } from 'lucide-react';

interface EditResponsibilitesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignment: {
    id: string;
    secretaire_nom: string;
    date: string;
    periode: 'matin' | 'apres_midi';
    site_nom: string;
    current: 'none' | '1R' | '2F' | '3F';
  };
  onSuccess: () => void;
}

export function EditResponsibilitesDialog({
  open,
  onOpenChange,
  assignment,
  onSuccess,
}: EditResponsibilitesDialogProps) {
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<'none' | '1R' | '2F' | '3F'>('none');
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      setSelected(assignment.current);
    }
  }, [open, assignment]);

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('planning_genere_personnel')
        .update({
          is_1r: selected === '1R',
          is_2f: selected === '2F',
          is_3f: selected === '3F',
        })
        .eq('id', assignment.id);

      if (error) throw error;

      toast({
        title: 'Succès',
        description: 'Responsabilité modifiée avec succès',
      });
      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error updating responsibility:', error);
      toast({
        title: 'Erreur',
        description: error.message || 'Erreur lors de la modification',
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
          <DialogTitle>Modifier la responsabilité</DialogTitle>
          <DialogDescription>
            {assignment.secretaire_nom} - {assignment.site_nom}
            <br />
            {assignment.periode === 'matin' ? 'Matin' : 'Après-midi'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-3">
            <Label>Responsabilité</Label>
            <RadioGroup value={selected} onValueChange={(v) => setSelected(v as typeof selected)}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="none" id="resp-none" />
                <Label htmlFor="resp-none" className="cursor-pointer font-normal">
                  Aucune responsabilité
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="1R" id="resp-1r" />
                <Label htmlFor="resp-1r" className="cursor-pointer font-normal">
                  1R (Premier responsable)
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="2F" id="resp-2f" />
                <Label htmlFor="resp-2f" className="cursor-pointer font-normal">
                  2F (Deuxième de fermeture)
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="3F" id="resp-3f" />
                <Label htmlFor="resp-3f" className="cursor-pointer font-normal">
                  3F (Troisième de fermeture)
                </Label>
              </div>
            </RadioGroup>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Annuler
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
