import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Clock, Sun, Moon } from 'lucide-react';

interface PeriodSelectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  personName: string;
  targetSiteName: string;
  onSelect: (period: 'journee' | 'matin' | 'apres_midi') => void;
}

export function PeriodSelectionDialog({
  open,
  onOpenChange,
  personName,
  targetSiteName,
  onSelect,
}: PeriodSelectionDialogProps) {
  const handleSelect = (period: 'journee' | 'matin' | 'apres_midi') => {
    onSelect(period);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            Choisir la période
          </DialogTitle>
          <DialogDescription>
            <span className="font-semibold text-foreground">{personName}</span> est assigné(e) pour la journée entière.
            <br />
            Quelle période souhaitez-vous déplacer vers <span className="font-semibold text-foreground">{targetSiteName}</span> ?
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 mt-4">
          <Button
            variant="outline"
            className="w-full justify-start gap-3 h-14 hover:bg-emerald-50 hover:border-emerald-300 dark:hover:bg-emerald-950/30"
            onClick={() => handleSelect('journee')}
          >
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/50">
              <Clock className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="flex flex-col items-start">
              <span className="font-semibold">Journée entière</span>
              <span className="text-xs text-muted-foreground">Déplacer matin et après-midi</span>
            </div>
          </Button>

          <Button
            variant="outline"
            className="w-full justify-start gap-3 h-14 hover:bg-blue-50 hover:border-blue-300 dark:hover:bg-blue-950/30"
            onClick={() => handleSelect('matin')}
          >
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/50">
              <Sun className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="flex flex-col items-start">
              <span className="font-semibold">Matin seulement</span>
              <span className="text-xs text-muted-foreground">Garder l'après-midi à l'ancien site</span>
            </div>
          </Button>

          <Button
            variant="outline"
            className="w-full justify-start gap-3 h-14 hover:bg-amber-50 hover:border-amber-300 dark:hover:bg-amber-950/30"
            onClick={() => handleSelect('apres_midi')}
          >
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900/50">
              <Moon className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="flex flex-col items-start">
              <span className="font-semibold">Après-midi seulement</span>
              <span className="text-xs text-muted-foreground">Garder le matin à l'ancien site</span>
            </div>
          </Button>

          <Button
            variant="ghost"
            className="w-full mt-2"
            onClick={() => onOpenChange(false)}
          >
            Annuler
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
