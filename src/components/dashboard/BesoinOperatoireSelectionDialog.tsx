import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, ClipboardList, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

interface BesoinOperation {
  id: string;
  nom: string;
  code: string;
}

interface BesoinOperatoireSelectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: string;
  period: 'matin' | 'apres_midi';
  secretaireName: string;
  targetSiteName: string;
  onSelect: (besoinOperationId: string) => void;
}

export function BesoinOperatoireSelectionDialog({
  open,
  onOpenChange,
  date,
  period,
  secretaireName,
  targetSiteName,
  onSelect,
}: BesoinOperatoireSelectionDialogProps) {
  const [loading, setLoading] = useState(true);
  const [besoinsLibres, setBesoinsLibres] = useState<BesoinOperation[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      fetchBesoinsLibres();
    }
  }, [open, date, period]);

  const fetchBesoinsLibres = async () => {
    setLoading(true);
    setError(null);

    try {
      // Récupérer tous les besoins opératoires actifs
      const { data: besoins, error: besoinsError } = await supabase
        .from('besoins_operations')
        .select('id, nom, code')
        .eq('actif', true)
        .order('nom');

      if (besoinsError) throw besoinsError;

      // Récupérer les assignations existantes pour ce jour/période
      const { data: assigned, error: assignedError } = await supabase
        .from('capacite_effective')
        .select('besoin_operation_id')
        .eq('date', date)
        .eq('demi_journee', period)
        .not('besoin_operation_id', 'is', null);

      if (assignedError) throw assignedError;

      // Filtrer pour garder seulement les besoins libres
      const assignedIds = new Set(assigned?.map(a => a.besoin_operation_id) || []);
      const libres = (besoins || []).filter(b => !assignedIds.has(b.id));

      setBesoinsLibres(libres);

      if (libres.length === 0) {
        setError('Aucun besoin opératoire libre ce jour-là pour cette période.');
      }
    } catch (err) {
      console.error('Erreur lors du chargement des besoins:', err);
      setError('Erreur lors du chargement des besoins opératoires.');
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = (besoinId: string) => {
    onSelect(besoinId);
    onOpenChange(false);
  };

  const periodLabel = period === 'matin' ? 'matin' : 'après-midi';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-primary" />
            Choisir le besoin opératoire
          </DialogTitle>
          <DialogDescription>
            Sélectionnez le besoin opératoire pour assigner{' '}
            <span className="font-semibold text-foreground">{secretaireName}</span>{' '}
            à <span className="font-semibold text-foreground">{targetSiteName}</span>{' '}
            le {periodLabel}.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <AlertTriangle className="h-12 w-12 text-amber-500 mb-3" />
              <p className="text-sm text-muted-foreground">{error}</p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => onOpenChange(false)}
              >
                Fermer
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto">
              {besoinsLibres.map((besoin) => (
                <Button
                  key={besoin.id}
                  variant="outline"
                  className={cn(
                    "w-full justify-start gap-3 h-12",
                    "hover:bg-primary/10 hover:border-primary/50"
                  )}
                  onClick={() => handleSelect(besoin.id)}
                >
                  <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10">
                    <span className="text-xs font-bold text-primary">{besoin.code}</span>
                  </div>
                  <span className="font-medium">{besoin.nom}</span>
                </Button>
              ))}
            </div>
          )}

          {!loading && !error && (
            <Button
              variant="ghost"
              className="w-full mt-4"
              onClick={() => onOpenChange(false)}
            >
              Annuler
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
