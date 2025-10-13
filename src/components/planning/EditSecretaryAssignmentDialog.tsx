interface EditSecretaryAssignmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  secretaryId: string;
  date: string;
  period: 'matin' | 'apres_midi';
  siteId?: string;
  onSuccess: () => void;
}

export function EditSecretaryAssignmentDialog({
  open,
  onOpenChange,
  secretaryId,
  date,
  period,
  siteId,
  onSuccess,
}: EditSecretaryAssignmentDialogProps) {
  // TODO: Component needs refactoring to use new planning architecture
  return null;
}
