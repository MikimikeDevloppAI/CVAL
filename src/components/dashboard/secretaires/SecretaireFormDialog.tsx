import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SecretaireForm } from '@/components/secretaires/SecretaireForm';
import type { Secretaire } from './useSecretaires';

interface SecretaireFormDialogProps {
  secretaire: Secretaire | null;
  onSuccess: () => void;
  onBack: () => void;
}

export function SecretaireFormDialog({ secretaire, onSuccess, onBack }: SecretaireFormDialogProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Retour
        </Button>
        <h2 className="text-2xl font-bold bg-gradient-to-r from-teal-500 to-cyan-600 bg-clip-text text-transparent">
          {secretaire ? 'Modifier la secrétaire' : 'Ajouter une secrétaire'}
        </h2>
      </div>
      
      <SecretaireForm 
        secretaire={secretaire}
        onSuccess={onSuccess}
      />
    </div>
  );
}
