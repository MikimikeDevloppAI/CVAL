import { SecretaireWeekCalendar } from '@/components/secretaires/SecretaireWeekCalendar';

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
    <SecretaireWeekCalendar
      open={open}
      onOpenChange={onOpenChange}
      secretaireId={secretaireId}
      secretaireNom={secretaireNom}
    />
  );
}
