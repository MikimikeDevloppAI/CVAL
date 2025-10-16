import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Loader2 } from 'lucide-react';

interface OptimizationProgressDialogProps {
  open: boolean;
  message?: string;
  subtitle?: string;
}

export function OptimizationProgressDialog({ open, message = "Optimisation en cours", subtitle = "Veuillez patienter..." }: OptimizationProgressDialogProps) {
  return (
    <Dialog open={open}>
      <DialogContent 
        className="sm:max-w-[300px] border-0 shadow-lg [&>button]:hidden" 
        onPointerDownOutside={(e) => e.preventDefault()} 
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{message}</DialogTitle>
          <DialogDescription>{subtitle}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center justify-center gap-4 py-6">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
          <div className="text-center space-y-1">
            <p className="font-medium text-base">{message}</p>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
