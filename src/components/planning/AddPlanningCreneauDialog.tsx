interface AddPlanningCreneauDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultDate?: string;
  onSuccess: () => void;
}

export function AddPlanningCreneauDialog({
  open,
  onOpenChange,
  defaultDate,
  onSuccess,
}: AddPlanningCreneauDialogProps) {
  // TODO: Component needs refactoring to use new planning architecture
  return null;
}
