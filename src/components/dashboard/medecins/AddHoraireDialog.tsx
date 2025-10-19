import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AddHoraireDialogProps {
  onAddNew: () => void;
}

export function AddHoraireDialog({ onAddNew }: AddHoraireDialogProps) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onAddNew}
      className="w-full border-dashed border-cyan-500/30 hover:border-cyan-500/50 hover:bg-cyan-500/5 text-cyan-600 dark:text-cyan-400"
    >
      <Plus className="h-3 w-3 mr-2" />
      Ajouter un jour
    </Button>
  );
}
