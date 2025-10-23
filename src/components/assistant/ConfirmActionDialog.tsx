import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock, User, FileText } from "lucide-react";

interface AbsenceAction {
  type: 'absence';
  data: {
    person_id: string;
    person_name: string;
    person_type: 'medecin' | 'secretaire';
    type: 'conges' | 'maladie' | 'formation' | 'autre';
    date_debut: string;
    date_fin: string;
    demi_journee: 'matin' | 'apres_midi' | 'toute_journee';
    motif?: string;
  };
}

interface AbsenceBatchAction {
  type: 'absence_batch';
  data: {
    person_id: string;
    person_name: string;
    person_type: 'medecin' | 'secretaire';
    type: 'conges' | 'maladie' | 'formation' | 'autre';
    dates: string[];
    demi_journee: 'matin' | 'apres_midi' | 'toute_journee';
    motif?: string;
  };
}

interface CreneauMedecinAction {
  type: 'creneau_medecin';
  data: {
    medecin_id: string;
    medecin_name: string;
    site_id: string;
    site_name: string;
    date: string;
    demi_journee: 'matin' | 'apres_midi' | 'toute_journee';
    type_intervention_id?: string;
    type_intervention_name?: string;
  };
}

interface OperationAction {
  type: 'operation';
  data: {
    medecin_id: string;
    medecin_name: string;
    type_intervention_id: string;
    type_intervention_name: string;
    date: string;
    periode: 'matin' | 'apres_midi';
    site_id: string;
    site_name: string;
  };
}

interface JourFerieAction {
  type: 'jour_ferie';
  data: {
    date: string;
    nom: string;
  };
}

type PendingAction = AbsenceAction | AbsenceBatchAction | CreneauMedecinAction | OperationAction | JourFerieAction;

interface ConfirmActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: PendingAction | null;
  onConfirm: () => void;
  isLoading: boolean;
}

export function ConfirmActionDialog({
  open,
  onOpenChange,
  action,
  onConfirm,
  isLoading
}: ConfirmActionDialogProps) {
  if (!action) return null;

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('fr-FR', { 
      weekday: 'long', 
      day: 'numeric', 
      month: 'long', 
      year: 'numeric' 
    });
  };

  const getAbsenceTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      conges: 'Congés',
      maladie: 'Maladie',
      formation: 'Formation',
      autre: 'Autre'
    };
    return labels[type] || type;
  };

  const getPeriodLabel = (period: string) => {
    const labels: Record<string, string> = {
      matin: 'Matin',
      apres_midi: 'Après-midi',
      toute_journee: 'Journée complète'
    };
    return labels[period] || period;
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {(action.type === 'absence' || action.type === 'absence_batch') ? (
              <>
                <User className="h-5 w-5 text-primary" />
                Confirmer la création {action.type === 'absence_batch' ? 'des absences' : 'de l\'absence'}
              </>
            ) : action.type === 'creneau_medecin' ? (
              <>
                <Calendar className="h-5 w-5 text-primary" />
                Confirmer la création du créneau
              </>
            ) : action.type === 'operation' ? (
              <>
                <Calendar className="h-5 w-5 text-primary" />
                Confirmer la création de l'opération
              </>
            ) : (
              <>
                <Calendar className="h-5 w-5 text-primary" />
                Confirmer la création du jour férié
              </>
            )}
          </AlertDialogTitle>
          <AlertDialogDescription>
            Vérifiez les informations ci-dessous avant de confirmer.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4 py-4">
          {(action.type === 'absence' || action.type === 'absence_batch') ? (
            <>
              <div className="flex items-start gap-3">
                <User className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div className="flex-1 space-y-1">
                  <p className="text-sm font-medium">Personne</p>
                  <p className="text-sm text-muted-foreground">
                    {action.data.person_name}
                    <Badge variant="outline" className="ml-2 text-xs">
                      {action.data.person_type === 'medecin' ? 'Médecin' : 'Secrétaire'}
                    </Badge>
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <FileText className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div className="flex-1 space-y-1">
                  <p className="text-sm font-medium">Type d'absence</p>
                  <Badge variant="secondary">
                    {getAbsenceTypeLabel(action.data.type)}
                  </Badge>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Calendar className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div className="flex-1 space-y-1">
                  <p className="text-sm font-medium">Période</p>
                  {action.type === 'absence_batch' ? (
                    <p className="text-sm text-muted-foreground">
                      {action.data.dates.length} jour{action.data.dates.length > 1 ? 's' : ''}, du {formatDate(action.data.dates[0])} au {formatDate(action.data.dates[action.data.dates.length - 1])}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Du {formatDate(action.data.date_debut)}
                      {action.data.date_debut !== action.data.date_fin && (
                        <> au {formatDate(action.data.date_fin)}</>
                      )}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Clock className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div className="flex-1 space-y-1">
                  <p className="text-sm font-medium">Demi-journée</p>
                  <Badge variant="outline">
                    {getPeriodLabel(action.data.demi_journee)}
                  </Badge>
                </div>
              </div>

              {action.data.motif && (
                <div className="flex items-start gap-3">
                  <FileText className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <div className="flex-1 space-y-1">
                    <p className="text-sm font-medium">Motif</p>
                    <p className="text-sm text-muted-foreground">{action.data.motif}</p>
                  </div>
                </div>
              )}
            </>
          ) : action.type === 'creneau_medecin' ? (
            <>
              <div className="flex items-start gap-3">
                <User className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div className="flex-1 space-y-1">
                  <p className="text-sm font-medium">Médecin</p>
                  <p className="text-sm text-muted-foreground">{action.data.medecin_name}</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <FileText className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div className="flex-1 space-y-1">
                  <p className="text-sm font-medium">Site</p>
                  <Badge variant="secondary">{action.data.site_name}</Badge>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Calendar className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div className="flex-1 space-y-1">
                  <p className="text-sm font-medium">Date</p>
                  <p className="text-sm text-muted-foreground">{formatDate(action.data.date)}</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Clock className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div className="flex-1 space-y-1">
                  <p className="text-sm font-medium">Période</p>
                  <Badge variant="outline">{getPeriodLabel(action.data.demi_journee)}</Badge>
                </div>
              </div>

              {action.data.type_intervention_name && (
                <div className="flex items-start gap-3">
                  <FileText className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <div className="flex-1 space-y-1">
                    <p className="text-sm font-medium">Type d'intervention</p>
                    <p className="text-sm text-muted-foreground">{action.data.type_intervention_name}</p>
                  </div>
                </div>
              )}
            </>
          ) : action.type === 'operation' ? (
            <>
              <div className="flex items-start gap-3">
                <User className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div className="flex-1 space-y-1">
                  <p className="text-sm font-medium">Médecin</p>
                  <p className="text-sm text-muted-foreground">{action.data.medecin_name}</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <FileText className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div className="flex-1 space-y-1">
                  <p className="text-sm font-medium">Type d'intervention</p>
                  <Badge variant="secondary">{action.data.type_intervention_name}</Badge>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Calendar className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div className="flex-1 space-y-1">
                  <p className="text-sm font-medium">Date</p>
                  <p className="text-sm text-muted-foreground">{formatDate(action.data.date)}</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Clock className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div className="flex-1 space-y-1">
                  <p className="text-sm font-medium">Période</p>
                  <Badge variant="outline">{getPeriodLabel(action.data.periode)}</Badge>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-start gap-3">
                <Calendar className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div className="flex-1 space-y-1">
                  <p className="text-sm font-medium">Date</p>
                  <p className="text-sm text-muted-foreground">
                    {formatDate(action.data.date)}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <FileText className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div className="flex-1 space-y-1">
                  <p className="text-sm font-medium">Nom</p>
                  <p className="text-sm text-muted-foreground">{action.data.nom}</p>
                </div>
              </div>
            </>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>Annuler</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={isLoading}>
            {isLoading ? 'Création...' : 'Confirmer'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
