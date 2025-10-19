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
    <SecretaireForm 
      secretaire={secretaire}
      onSuccess={onSuccess}
    />
  );
}
