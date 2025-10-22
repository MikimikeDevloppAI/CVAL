import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Trash2, Edit, ArrowLeftRight, Loader2, MapPin, Calendar, Clock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { ExchangeSecretaireDialog } from './ExchangeSecretaireDialog';
import { EditSecretaireAssignmentDialog } from './EditSecretaireAssignmentDialog';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
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

interface SecretaireActionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  secretaireId: string;
  secretaireNom: string;
  date: string;
  siteId: string;
  periode: 'matin' | 'apres_midi' | 'journee';
  besoinOperationId?: string | null;
  onRefresh: () => void;
}

export function SecretaireActionsDialog({
  open,
  onOpenChange,
  secretaireId,
  secretaireNom,
  date,
  siteId,
  periode,
  besoinOperationId,
  onRefresh,
}: SecretaireActionsDialogProps) {
  const [exchangeOpen, setExchangeOpen] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [siteNom, setSiteNom] = useState<string>('');
  const [besoinNom, setBesoinNom] = useState<string>('');
  const [salleNom, setSalleNom] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (open) {
      fetchCreneauInfo();
    }
  }, [open, siteId, besoinOperationId]);

  const fetchCreneauInfo = async () => {
    setLoading(true);
    try {
      // Fetch site name
      const { data: siteData } = await supabase
        .from('sites')
        .select('nom')
        .eq('id', siteId)
        .single();

      if (siteData) {
        setSiteNom(siteData.nom);
      }

      // If at bloc operatoire, fetch besoin and salle
      if (besoinOperationId) {
        const { data: besoinData } = await supabase
          .from('besoins_operations')
          .select('nom')
          .eq('id', besoinOperationId)
          .single();

        if (besoinData) {
          setBesoinNom(besoinData.nom);
        }

        // Fetch salle from capacite_effective
        const periodeValue = periode === 'journee' ? 'matin' : periode;
        const { data: capaciteData } = await supabase
          .from('capacite_effective')
          .select(`
            planning_genere_bloc_operatoire_id,
            planning_genere_bloc_operatoire:planning_genere_bloc_operatoire_id (
              salle_assignee,
              salles_operation:salle_assignee (
                name
              )
            )
          `)
          .eq('secretaire_id', secretaireId)
          .eq('date', date)
          .eq('demi_journee', periodeValue)
          .eq('besoin_operation_id', besoinOperationId)
          .not('planning_genere_bloc_operatoire_id', 'is', null)
          .single();

        if (capaciteData?.planning_genere_bloc_operatoire?.salles_operation?.name) {
          setSalleNom(capaciteData.planning_genere_bloc_operatoire.salles_operation.name);
        }
      }
    } catch (error) {
      console.error('Error fetching creneau info:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      // Build the query to filter by the specific period(s)
      let query = supabase
        .from('capacite_effective')
        .delete()
        .eq('secretaire_id', secretaireId)
        .eq('date', date);

      // Filter by the specific demi-journee(s)
      if (periode === 'journee') {
        // For full day, delete both periods
        query = query.in('demi_journee', ['matin', 'apres_midi']);
      } else {
        // For specific half-day, only delete that period
        query = query.eq('demi_journee', periode);
      }

      const { error } = await query;

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

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Actions pour {secretaireNom}</DialogTitle>
          </DialogHeader>

          {/* Créneau Info */}
          {!loading && (
            <div className="space-y-3 p-4 rounded-lg bg-muted/50 border border-border/50">
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="h-4 w-4 text-primary" />
                <span className="font-medium">
                  {format(new Date(date), 'EEEE d MMMM yyyy', { locale: fr })}
                </span>
              </div>
              
              <div className="flex items-center gap-2 text-sm">
                <Clock className="h-4 w-4 text-primary" />
                <Badge 
                  variant="outline" 
                  className={cn(
                    "text-xs px-2 py-0.5",
                    periode === 'matin' 
                      ? 'bg-blue-500 text-white border-blue-500' 
                      : 'bg-yellow-500 text-white border-yellow-500'
                  )}
                >
                  {periode === 'matin' ? 'Matin' : periode === 'apres_midi' ? 'Après-midi' : 'Journée'}
                </Badge>
              </div>

              <div className="flex items-center gap-2 text-sm">
                <MapPin className="h-4 w-4 text-primary" />
                <span className="font-medium">{siteNom}</span>
              </div>

              {besoinOperationId && (
                <>
                  {besoinNom && (
                    <div className="pt-2 border-t border-border/30">
                      <p className="text-xs text-muted-foreground mb-1">Besoin opérationnel</p>
                      <p className="text-sm font-medium">{besoinNom}</p>
                    </div>
                  )}
                  {salleNom && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Salle</p>
                      <p className="text-sm font-medium">{salleNom}</p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <div className="space-y-3 py-4">
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => {
                setReassignOpen(true);
              }}
            >
              <Edit className="h-4 w-4 mr-2" />
              Réaffecter
            </Button>

            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => {
                setExchangeOpen(true);
              }}
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
        siteId={siteId}
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
