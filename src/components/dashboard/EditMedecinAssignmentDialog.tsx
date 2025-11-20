import { EditBesoinMedecinDialog } from "@/components/shared/EditBesoinMedecinDialog";

interface EditMedecinAssignmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  medecinId: string;
  medecinNom: string;
  date: string;
  currentSiteId: string;
  periode: 'matin' | 'apres_midi' | 'journee';
  onSuccess: () => void;
}

export function EditMedecinAssignmentDialog({
  open,
  onOpenChange,
  medecinId,
  medecinNom,
  date,
  currentSiteId,
  periode,
  onSuccess
}: EditMedecinAssignmentDialogProps) {
  return (
    <EditBesoinMedecinDialog
      open={open}
      onOpenChange={onOpenChange}
      medecinId={medecinId}
      medecinNom={medecinNom}
      date={date}
      initialSiteId={currentSiteId}
      initialPeriod={periode === 'journee' ? 'toute_journee' : periode}
      onSuccess={onSuccess}
    />
  );
}
