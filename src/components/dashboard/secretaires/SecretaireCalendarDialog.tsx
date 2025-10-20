import { SecretaireMonthCalendar } from '@/components/secretaires/SecretaireMonthCalendar';

interface SecretaireCalendarDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  secretaireId: string;
  secretaireNom: string;
}

export function SecretaireCalendarDialog({ 
  open, 
  onOpenChange, 
  secretaireId, 
  secretaireNom 
}: SecretaireCalendarDialogProps) {
  return (
    <SecretaireMonthCalendar
      open={open}
      onOpenChange={onOpenChange}
      secretaireId={secretaireId}
      secretaireNom={secretaireNom}
    />
  );
}
