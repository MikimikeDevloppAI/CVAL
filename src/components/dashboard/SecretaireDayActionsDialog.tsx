import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ArrowLeftRight, Trash2, Loader2, Edit, User, Sun, Moon, Clock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { ExchangeSecretaireDialog } from './ExchangeSecretaireDialog';
import { EditSecretaireAssignmentDialog } from './EditSecretaireAssignmentDialog';
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

interface SecretaireDayActionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  secretaireId: string;
  secretaireNom: string;
  date: string;
  initialPeriode?: 'matin' | 'apres_midi' | 'journee';
  onRefresh: () => void;
  // Callback pour mise à jour optimiste des flags (évite le refresh)
  onOptimisticFlagUpdate?: (secretaireId: string, date: string, flag: '1R' | '2F' | '3F', value: boolean) => void;
}

export function SecretaireDayActionsDialog({
  open,
  onOpenChange,
  secretaireId,
  secretaireNom,
  date,
  initialPeriode,
  onRefresh,
  onOptimisticFlagUpdate,
}: SecretaireDayActionsDialogProps) {
  const [exchangeOpen, setExchangeOpen] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [siteId, setSiteId] = useState<string>('');
  const [siteName, setSiteName] = useState<string>('');
  const [periode, setPeriode] = useState<'matin' | 'apres_midi' | 'journee'>('matin');
  const [besoinOperationId, setBesoinOperationId] = useState<string | null>(null);

  // Flags 1R, 2F, 3F
  const [is1R, setIs1R] = useState(false);
  const [is2F, setIs2F] = useState(false);
  const [is3F, setIs3F] = useState(false);

  useEffect(() => {
    if (open) {
      if (initialPeriode) {
        setPeriode(initialPeriode);
      }
      fetchCapaciteData(initialPeriode);
    }
  }, [open, secretaireId, date, initialPeriode]);

  const fetchCapaciteData = async (preferredPeriode?: 'matin' | 'apres_midi' | 'journee') => {
    setLoading(true);
    try {
      const { data: capacites } = await supabase
        .from('capacite_effective')
        .select(`
          site_id,
          besoin_operation_id,
          demi_journee,
          is_1r,
          is_2f,
          is_3f,
          sites (nom)
        `)
        .eq('secretaire_id', secretaireId)
        .eq('date', date)
        .eq('actif', true);

      if (capacites && capacites.length > 0) {
        setSiteId(capacites[0].site_id);
        setBesoinOperationId(capacites[0].besoin_operation_id);
        setSiteName((capacites[0].sites as any)?.nom || '');

        // Récupérer les flags depuis la première entrée
        setIs1R(capacites[0].is_1r || false);
        setIs2F(capacites[0].is_2f || false);
        setIs3F(capacites[0].is_3f || false);

        const hasMatin = capacites.some(c => c.demi_journee === 'matin');
        const hasAM = capacites.some(c => c.demi_journee === 'apres_midi');

        if (!preferredPeriode) {
          if (hasMatin && hasAM) {
            setPeriode('journee');
          } else if (hasMatin) {
            setPeriode('matin');
          } else if (hasAM) {
            setPeriode('apres_midi');
          }
        }
      }
    } catch (error) {
      console.error('Error fetching capacite data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSuccess = () => {
    onRefresh();
    onOpenChange(false);
    setExchangeOpen(false);
    setReassignOpen(false);
  };

  const handleToggleFlag = async (flag: '1R' | '2F' | '3F') => {
    setSaving(true);
    try {
      const newValue = flag === '1R' ? !is1R : flag === '2F' ? !is2F : !is3F;
      const updateField = flag === '1R' ? 'is_1r' : flag === '2F' ? 'is_2f' : 'is_3f';

      // Mettre à jour l'état local immédiatement (optimistic)
      if (flag === '1R') setIs1R(newValue);
      else if (flag === '2F') setIs2F(newValue);
      else setIs3F(newValue);

      // Mise à jour optimiste du parent (évite le refresh)
      if (onOptimisticFlagUpdate) {
        onOptimisticFlagUpdate(secretaireId, date, flag, newValue);
      }

      toast.success(`${flag} ${newValue ? 'activé' : 'désactivé'}`);

      // Mettre à jour la base de données en arrière-plan
      const { error } = await supabase
        .from('capacite_effective')
        .update({ [updateField]: newValue })
        .eq('secretaire_id', secretaireId)
        .eq('date', date)
        .eq('actif', true);

      if (error) {
        // En cas d'erreur, revenir à l'état précédent
        if (flag === '1R') setIs1R(!newValue);
        else if (flag === '2F') setIs2F(!newValue);
        else setIs3F(!newValue);

        // Rollback côté parent aussi
        if (onOptimisticFlagUpdate) {
          onOptimisticFlagUpdate(secretaireId, date, flag, !newValue);
        }

        throw error;
      }

      // Pas de onRefresh - la mise à jour optimiste suffit
    } catch (error) {
      console.error('Error updating flag:', error);
      toast.error('Erreur lors de la mise à jour');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      let query = supabase
        .from('capacite_effective')
        .delete()
        .eq('secretaire_id', secretaireId)
        .eq('date', date);

      if (periode === 'journee') {
        query = query.in('demi_journee', ['matin', 'apres_midi']);
      } else {
        query = query.eq('demi_journee', periode);
      }

      const { error } = await query;

      if (error) throw error;

      toast.success('Assistant médical retiré avec succès');
      handleSuccess();
    } catch (error) {
      console.error('Error deleting:', error);
      toast.error('Impossible de supprimer');
    } finally {
      setDeleting(false);
      setDeleteConfirmOpen(false);
    }
  };

  const periodLabels = {
    matin: { label: 'Matin', icon: Sun, color: 'text-blue-600 bg-blue-100 dark:bg-blue-900/50' },
    apres_midi: { label: 'Après-midi', icon: Moon, color: 'text-amber-600 bg-amber-100 dark:bg-amber-900/50' },
    journee: { label: 'Journée', icon: Clock, color: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-900/50' },
  };

  const PeriodIcon = periodLabels[periode].icon;

  if (loading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md p-0 overflow-hidden">
          {/* Header avec gradient */}
          <div className="bg-gradient-to-r from-cyan-500 to-blue-600 p-6 text-white">
            <div className="flex items-center gap-4">
              <div className="flex items-center justify-center w-14 h-14 rounded-xl bg-white/20 backdrop-blur-sm">
                <User className="h-7 w-7" />
              </div>
              <div className="flex-1">
                <DialogTitle className="text-xl font-bold text-white mb-1">
                  {secretaireNom}
                </DialogTitle>
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold",
                    periodLabels[periode].color
                  )}>
                    <PeriodIcon className="h-3.5 w-3.5" />
                    {periodLabels[periode].label}
                  </span>
                  {siteName && (
                    <span className="text-white/80 text-sm">
                      • {siteName}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-6">
            {/* Section Flags */}
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Rôles
              </h3>
              <div className="flex gap-2">
                <button
                  onClick={() => handleToggleFlag('1R')}
                  disabled={saving}
                  className={cn(
                    "flex-1 py-3 px-4 rounded-xl font-bold text-lg transition-all duration-200",
                    "border-2 hover:scale-105",
                    is1R
                      ? "bg-gradient-to-br from-purple-500 to-purple-600 text-white border-purple-500 shadow-lg shadow-purple-500/25"
                      : "bg-muted/50 text-muted-foreground border-border hover:border-purple-300 hover:bg-purple-50 dark:hover:bg-purple-950/30"
                  )}
                >
                  1R
                </button>
                <button
                  onClick={() => handleToggleFlag('2F')}
                  disabled={saving}
                  className={cn(
                    "flex-1 py-3 px-4 rounded-xl font-bold text-lg transition-all duration-200",
                    "border-2 hover:scale-105",
                    is2F
                      ? "bg-gradient-to-br from-orange-500 to-orange-600 text-white border-orange-500 shadow-lg shadow-orange-500/25"
                      : "bg-muted/50 text-muted-foreground border-border hover:border-orange-300 hover:bg-orange-50 dark:hover:bg-orange-950/30"
                  )}
                >
                  2F
                </button>
                <button
                  onClick={() => handleToggleFlag('3F')}
                  disabled={saving}
                  className={cn(
                    "flex-1 py-3 px-4 rounded-xl font-bold text-lg transition-all duration-200",
                    "border-2 hover:scale-105",
                    is3F
                      ? "bg-gradient-to-br from-pink-500 to-pink-600 text-white border-pink-500 shadow-lg shadow-pink-500/25"
                      : "bg-muted/50 text-muted-foreground border-border hover:border-pink-300 hover:bg-pink-50 dark:hover:bg-pink-950/30"
                  )}
                >
                  3F
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-2 text-center">
                Cliquez pour activer/désactiver un rôle
              </p>
            </div>

            {/* Section Actions */}
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Actions
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <Button
                  variant="outline"
                  className="h-auto py-4 flex flex-col items-center gap-2 hover:bg-primary/5 hover:border-primary/50"
                  onClick={() => setReassignOpen(true)}
                  disabled={!siteId}
                >
                  <Edit className="h-5 w-5 text-primary" />
                  <span className="text-sm font-medium">Réaffecter</span>
                </Button>

                <Button
                  variant="outline"
                  className="h-auto py-4 flex flex-col items-center gap-2 hover:bg-blue-50 hover:border-blue-300 dark:hover:bg-blue-950/30"
                  onClick={() => setExchangeOpen(true)}
                  disabled={!siteId}
                >
                  <ArrowLeftRight className="h-5 w-5 text-blue-600" />
                  <span className="text-sm font-medium">Échanger</span>
                </Button>
              </div>
            </div>

            {/* Bouton Supprimer */}
            <Button
              variant="ghost"
              className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
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
                  Retirer de ce jour
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <EditSecretaireAssignmentDialog
        open={reassignOpen}
        onOpenChange={setReassignOpen}
        secretaire={{ id: secretaireId, capacite_id: '', nom: secretaireNom, periode, is_1r: is1R, is_2f: is2F, is_3f: is3F }}
        date={date}
        siteId={siteId || ''}
        onSuccess={handleSuccess}
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
        onSuccess={handleSuccess}
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
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
