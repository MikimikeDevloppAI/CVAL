import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Trash2, Edit, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { EditMedecinAssignmentDialog } from './EditMedecinAssignmentDialog';
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

interface MedecinActionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  medecinId: string;
  medecinNom: string;
  medecinPrenom: string;
  date: string;
  siteId: string;
  periode: 'matin' | 'apres_midi' | 'journee';
  onRefresh: () => void;
}

export function MedecinActionsDialog({
  open,
  onOpenChange,
  medecinId,
  medecinNom,
  medecinPrenom,
  date,
  siteId,
  periode,
  onRefresh,
}: MedecinActionsDialogProps) {
  const [reassignOpen, setReassignOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selectedPeriode, setSelectedPeriode] = useState<'matin' | 'apres_midi' | 'journee'>(periode);
  const [showPeriodSelector, setShowPeriodSelector] = useState(false);
  const [actionType, setActionType] = useState<'reassign' | 'delete' | null>(null);
  const [reassignBesoinIds, setReassignBesoinIds] = useState<string[]>([]);

  const handleActionClick = (action: 'reassign' | 'delete') => {
    setActionType(action);
    if (periode === 'journee') {
      // Si c'est une journée complète, demander quelle période modifier
      setShowPeriodSelector(true);
    } else {
      // Si c'est une demi-journée, utiliser directement cette période
      setSelectedPeriode(periode);
      if (action === 'reassign') {
        setReassignOpen(true);
      } else {
        setDeleteConfirmOpen(true);
      }
    }
  };

  const handlePeriodSelected = async (selectedPeriod: 'matin' | 'apres_midi' | 'journee') => {
    setSelectedPeriode(selectedPeriod);
    setShowPeriodSelector(false);
    
    if (actionType === 'reassign') {
      // Fetch besoin IDs for the selected period
      const demiJournees: ('matin' | 'apres_midi')[] = selectedPeriod === 'journee' 
        ? ['matin', 'apres_midi'] 
        : [selectedPeriod as 'matin' | 'apres_midi'];
      
      const { data: besoins } = await supabase
        .from('besoin_effectif')
        .select('id')
        .eq('medecin_id', medecinId)
        .eq('date', date)
        .eq('site_id', siteId)
        .eq('type', 'medecin')
        .eq('actif', true)
        .in('demi_journee', demiJournees);
      
      setReassignBesoinIds(besoins?.map(b => b.id) || []);
      setReassignOpen(true);
    } else if (actionType === 'delete') {
      setDeleteConfirmOpen(true);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      // Build the query to filter by the specific period(s)
      let query = supabase
        .from('besoin_effectif')
        .delete()
        .eq('medecin_id', medecinId)
        .eq('date', date)
        .eq('site_id', siteId);

      // Filter by the specific demi-journee(s)
      if (selectedPeriode === 'journee') {
        // For full day, delete both periods
        query = query.in('demi_journee', ['matin', 'apres_midi']);
      } else {
        // For specific half-day, only delete that period
        query = query.eq('demi_journee', selectedPeriode);
      }

      const { error } = await query;

      if (error) throw error;

      toast({
        title: 'Succès',
        description: 'Médecin retiré avec succès',
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

  const nomComplet = `${medecinPrenom} ${medecinNom}`;

  return (
    <>
      <Dialog open={open && !showPeriodSelector} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Actions pour {nomComplet}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-4">
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => handleActionClick('reassign')}
            >
              <Edit className="h-4 w-4 mr-2" />
              Réaffecter à un autre site
            </Button>

            <Button
              variant="outline"
              className="w-full justify-start text-destructive hover:text-destructive"
              onClick={() => handleActionClick('delete')}
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

      {/* Period Selector Dialog */}
      <Dialog open={showPeriodSelector} onOpenChange={setShowPeriodSelector}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Sélectionner la période</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-4">
            <p className="text-sm text-muted-foreground mb-4">
              Quelle période souhaitez-vous {actionType === 'reassign' ? 'réaffecter' : 'supprimer'} ?
            </p>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => handlePeriodSelected('matin')}
            >
              Matin uniquement
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => handlePeriodSelected('apres_midi')}
            >
              Après-midi uniquement
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => handlePeriodSelected('journee')}
            >
              Toute la journée
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <EditMedecinAssignmentDialog
        open={reassignOpen}
        onOpenChange={setReassignOpen}
        medecinId={medecinId}
        medecinNom={nomComplet}
        date={date}
        currentSiteId={siteId}
        periode={selectedPeriode}
        besoinIds={reassignBesoinIds}
        onSuccess={onRefresh}
      />

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer la suppression</AlertDialogTitle>
            <AlertDialogDescription>
              Êtes-vous sûr de vouloir retirer {nomComplet} de ce jour ?
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
