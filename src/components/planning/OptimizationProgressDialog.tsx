import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Loader2 } from 'lucide-react';

interface OptimizationProgressDialogProps {
  open: boolean;
}

export function OptimizationProgressDialog({ open }: OptimizationProgressDialogProps) {
  return (
    <Dialog open={open}>
      <DialogContent 
        className="sm:max-w-[300px] border-0 shadow-lg [&>button]:hidden" 
        onPointerDownOutside={(e) => e.preventDefault()} 
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <div className="flex flex-col items-center justify-center gap-4 py-6">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
          <div className="text-center space-y-1">
            <p className="font-medium text-base">Optimisation en cours</p>
            <p className="text-sm text-muted-foreground">Veuillez patienter...</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
