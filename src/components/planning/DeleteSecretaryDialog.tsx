import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface DeleteSecretaryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  secretaryId: string;
  secretaryName: string;
  date: string;
  hasMatinAssignment: boolean;
  hasApresMidiAssignment: boolean;
  onSuccess?: () => void;
}

export function DeleteSecretaryDialog({
  open,
  onOpenChange,
  secretaryId,
  secretaryName,
  date,
  hasMatinAssignment,
  hasApresMidiAssignment,
  onSuccess,
}: DeleteSecretaryDialogProps) {
  const [deleteOption, setDeleteOption] = useState<'both' | 'matin' | 'apres_midi'>('both');

  const handleDelete = async () => {
    try {
      const periods: string[] = [];
      if (deleteOption === 'both') {
        if (hasMatinAssignment) periods.push('matin');
        if (hasApresMidiAssignment) periods.push('apres_midi');
      } else if (deleteOption === 'matin' && hasMatinAssignment) {
        periods.push('matin');
      } else if (deleteOption === 'apres_midi' && hasApresMidiAssignment) {
        periods.push('apres_midi');
      }

      for (const periode of periods) {
        const heure_debut = periode === 'matin' ? '07:30:00' : '13:00:00';

        // Récupérer le créneau
        const { data: creneau, error: fetchError } = await supabase
          .from('planning_genere')
          .select('*')
          .eq('date', date)
          .eq('heure_debut', heure_debut)
          .single();

        if (fetchError) {
          console.error('Erreur lors de la récupération du créneau:', fetchError);
          continue;
        }

        if (!creneau) continue;

        // Retirer la secrétaire des tableaux
        const newSecretaires = (creneau.secretaires_ids || []).filter((id: string) => id !== secretaryId);
        const newBackups = (creneau.backups_ids || []).filter((id: string) => id !== secretaryId);

        // Retirer également des responsables si c'est le cas
        const updates: any = {
          secretaires_ids: newSecretaires,
          backups_ids: newBackups,
        };

        if (creneau.responsable_1r_id === secretaryId) {
          updates.responsable_1r_id = null;
        }
        if (creneau.responsable_2f_id === secretaryId) {
          updates.responsable_2f_id = null;
        }
        if (creneau.responsable_3f_id === secretaryId) {
          updates.responsable_3f_id = null;
        }

        // Mettre à jour le créneau
        const { error: updateError } = await supabase
          .from('planning_genere')
          .update(updates)
          .eq('id', creneau.id);

        if (updateError) {
          throw updateError;
        }
      }

      toast.success('Secrétaire supprimée du planning avec succès');
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      console.error('Erreur lors de la suppression:', error);
      toast.error('Erreur lors de la suppression de la secrétaire');
    }
  };

  // Déterminer les options disponibles
  const showBothOption = hasMatinAssignment && hasApresMidiAssignment;
  const showMatinOption = hasMatinAssignment;
  const showApresMidiOption = hasApresMidiAssignment;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Supprimer {secretaryName}</AlertDialogTitle>
          <AlertDialogDescription>
            Quelle période souhaitez-vous supprimer pour cette secrétaire ?
          </AlertDialogDescription>
        </AlertDialogHeader>

        <RadioGroup value={deleteOption} onValueChange={(value: any) => setDeleteOption(value)}>
          {showBothOption && (
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="both" id="both" />
              <Label htmlFor="both">Toute la journée (Matin + Après-midi)</Label>
            </div>
          )}
          {showMatinOption && (
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="matin" id="matin" />
              <Label htmlFor="matin">Matin uniquement</Label>
            </div>
          )}
          {showApresMidiOption && (
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="apres_midi" id="apres_midi" />
              <Label htmlFor="apres_midi">Après-midi uniquement</Label>
            </div>
          )}
        </RadioGroup>

        <AlertDialogFooter>
          <AlertDialogCancel>Annuler</AlertDialogCancel>
          <AlertDialogAction onClick={handleDelete}>Confirmer la suppression</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
