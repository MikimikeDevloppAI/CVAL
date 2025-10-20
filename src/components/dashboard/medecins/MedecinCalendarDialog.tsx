import { MedecinMonthCalendar } from '@/components/medecins/MedecinMonthCalendar';

interface MedecinCalendarDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  medecinId: string;
  medecinNom: string;
}

export function MedecinCalendarDialog({ open, onOpenChange, medecinId, medecinNom }: MedecinCalendarDialogProps) {
  return (
    <MedecinMonthCalendar
      open={open}
      onOpenChange={onOpenChange}
      medecinId={medecinId}
      medecinNom={medecinNom}
    />
  );
}
