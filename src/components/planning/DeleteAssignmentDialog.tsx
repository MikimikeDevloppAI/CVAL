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
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface DeleteAssignmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignmentId: string;
  secretaryName: string;
  onSuccess?: () => void;
}

export function DeleteAssignmentDialog({
  open,
  onOpenChange,
  assignmentId,
  secretaryName,
  onSuccess,
}: DeleteAssignmentDialogProps) {
  const handleDelete = async () => {
    try {
      const { error } = await supabase
        .from('planning_genere_personnel')
        .delete()
        .eq('id', assignmentId);

      if (error) throw error;

      toast.success('Assignation supprimée avec succès');
      onSuccess?.();
      onOpenChange(false);
    } catch (error) {
      console.error('Error deleting assignment:', error);
      toast.error('Erreur lors de la suppression');
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Confirmer la suppression</AlertDialogTitle>
          <AlertDialogDescription>
            Êtes-vous sûr de vouloir supprimer l'assignation de <strong>{secretaryName}</strong> ?
            Cette action est irréversible.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Annuler</AlertDialogCancel>
          <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive/90">
            Supprimer
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
