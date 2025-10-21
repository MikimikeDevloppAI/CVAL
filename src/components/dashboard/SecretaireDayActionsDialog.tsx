import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ArrowLeftRight, Trash2, Loader2, Edit } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { ExchangeSecretaireDialog } from './ExchangeSecretaireDialog';
import { EditSecretaireAssignmentDialog } from './EditSecretaireAssignmentDialog';
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

interface SecretaireDayActionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  secretaireId: string;
  secretaireNom: string;
  date: string;
  onRefresh: () => void;
}

export function SecretaireDayActionsDialog({
  open,
  onOpenChange,
  secretaireId,
  secretaireNom,
  date,
  onRefresh,
}: SecretaireDayActionsDialogProps) {
  const [exchangeOpen, setExchangeOpen] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [siteId, setSiteId] = useState<string>('');
  const [periode, setPeriode] = useState<'matin' | 'apres_midi' | 'journee'>('matin');
  const [besoinOperationId, setBesoinOperationId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      fetchCapaciteData();
    }
  }, [open, secretaireId, date]);

  const fetchCapaciteData = async () => {
    setLoading(true);
    try {
      const { data: capacites } = await supabase
        .from('capacite_effective')
        .select('site_id, besoin_operation_id, demi_journee')
        .eq('secretaire_id', secretaireId)
        .eq('date', date)
        .eq('actif', true);

      if (capacites && capacites.length > 0) {
        setSiteId(capacites[0].site_id);
        setBesoinOperationId(capacites[0].besoin_operation_id);
        
        // Determine periode
        const hasMatin = capacites.some(c => c.demi_journee === 'matin');
        const hasAM = capacites.some(c => c.demi_journee === 'apres_midi');
        
        if (hasMatin && hasAM) {
          setPeriode('journee');
        } else if (hasMatin) {
          setPeriode('matin');
        } else {
          setPeriode('apres_midi');
        }
      }
    } catch (error) {
      console.error('Error fetching capacite data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const { error } = await supabase
        .from('capacite_effective')
        .delete()
        .eq('secretaire_id', secretaireId)
        .eq('date', date);

      if (error) throw error;

      toast({
        title: 'Succès',
        description: 'Secrétaire retirée avec succès',
      });

      onRefresh();
      onOpenChange(false);
    } catch (error) {
      console.error('Error deleting:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible de supprimer',
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
      setDeleteConfirmOpen(false);
    }
  };

  if (loading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Actions pour {secretaireNom}</DialogTitle>
          </DialogHeader>

            <div className="space-y-3 py-4">
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => {
                  setReassignOpen(true);
                  onOpenChange(false);
                }}
                disabled={!siteId}
              >
                <Edit className="h-4 w-4 mr-2" />
                Réaffecter
              </Button>

              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => {
                  setExchangeOpen(true);
                  onOpenChange(false);
                }}
                disabled={!siteId}
              >
                <ArrowLeftRight className="h-4 w-4 mr-2" />
                Échanger
              </Button>

              <Button
                variant="outline"
                className="w-full justify-start text-destructive hover:text-destructive"
                onClick={() => setDeleteConfirmOpen(true)}
                disabled={deleting}
              >
                {deleting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Suppression...
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4 mr-2" />
                    Supprimer
                  </>
                )}
              </Button>
            </div>
        </DialogContent>
      </Dialog>

      <EditSecretaireAssignmentDialog
        open={reassignOpen}
        onOpenChange={setReassignOpen}
        secretaire={{ id: secretaireId, capacite_id: '', nom: secretaireNom, periode, is_1r: false, is_2f: false, is_3f: false }}
        date={date}
        siteId={siteId || ''}
        onSuccess={onRefresh}
      />

      <ExchangeSecretaireDialog
        open={exchangeOpen}
        onOpenChange={setExchangeOpen}
        secretaireId={secretaireId}
        secretaireNom={secretaireNom}
        date={date}
        siteId={siteId}
        periode={periode}
        besoinOperationId={besoinOperationId}
        onSuccess={onRefresh}
      />

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer la suppression</AlertDialogTitle>
            <AlertDialogDescription>
              Êtes-vous sûr de vouloir retirer {secretaireNom} de ce jour ?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground"
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
