import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AddHoraireSecretaireDialogProps {
  onAddNew: () => void;
}

export function AddHoraireSecretaireDialog({ onAddNew }: AddHoraireSecretaireDialogProps) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onAddNew}
      className="w-full border-dashed border-teal-500/30 hover:border-teal-500/50 hover:bg-teal-500/5 text-teal-600 dark:text-teal-400"
    >
      <Plus className="h-3 w-3 mr-2" />
      Ajouter un jour
    </Button>
  );
}