import { MedecinWeekCalendar } from '@/components/medecins/MedecinWeekCalendar';

interface MedecinCalendarDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  medecinId: string;
  medecinNom: string;
}

export function MedecinCalendarDialog({ open, onOpenChange, medecinId, medecinNom }: MedecinCalendarDialogProps) {
  return (
    <MedecinWeekCalendar
      open={open}
      onOpenChange={onOpenChange}
      medecinId={medecinId}
      medecinNom={medecinNom}
    />
  );
}
