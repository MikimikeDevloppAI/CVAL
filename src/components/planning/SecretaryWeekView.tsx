import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Clock, MapPin, X } from 'lucide-react';
import { useState } from 'react';
import { DeleteSecretaryDialog } from './DeleteSecretaryDialog';

interface SecretaryAssignment {
  date: string;
  periode: 'matin' | 'apres_midi';
  site_nom?: string;
  medecins: string[];
  is_1r?: boolean;
  is_2f?: boolean;
  type_assignation: 'site' | 'administratif';
}

interface SecretaryWeekViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  secretaryId: string;
  secretaryName: string;
  assignments: SecretaryAssignment[];
  weekDays: Date[];
  onRefresh?: () => void;
}

export function SecretaryWeekView({
  open,
  onOpenChange,
  secretaryId,
  secretaryName,
  assignments,
  weekDays,
  onRefresh,
}: SecretaryWeekViewProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [secretaryToDelete, setSecretaryToDelete] = useState<{
    id: string;
    nom: string;
    date: string;
    hasMatin: boolean;
    hasApresMidi: boolean;
  } | null>(null);

  const handleDeleteClick = (date: string, hasMatin: boolean, hasApresMidi: boolean) => {
    setSecretaryToDelete({
      id: secretaryId,
      nom: secretaryName,
      date,
      hasMatin,
      hasApresMidi,
    });
    setDeleteDialogOpen(true);
  };

  // Group assignments by date
  const assignmentsByDate = weekDays.map(day => {
    const dateStr = format(day, 'yyyy-MM-dd');
    const dayAssignments = assignments.filter(a => a.date === dateStr);
    const matin = dayAssignments.find(a => a.periode === 'matin');
    const apresMidi = dayAssignments.find(a => a.periode === 'apres_midi');
    
    return {
      date: day,
      dateStr,
      matin,
      apresMidi,
    };
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-xl">
            Planning de {secretaryName}
          </SheetTitle>
        </SheetHeader>
        
        <div className="mt-6 space-y-4">
          {assignmentsByDate.map(({ date, dateStr, matin, apresMidi }) => (
            <Card key={dateStr} className="p-4">
              <div className="mb-3 pb-2 border-b">
                <h3 className="font-semibold text-lg">
                  {format(date, 'EEEE d MMMM', { locale: fr })}
                </h3>
              </div>
              
              <div className="space-y-3">
                {/* Matin - Afficher uniquement si assigné */}
                {matin && (
                  <div className="flex gap-3">
                    <div className="flex items-center gap-2 w-32 text-sm font-medium">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      07:30 - 12:00
                    </div>
                    <div className="flex-1">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            {matin.type_assignation === 'administratif' ? (
                              <Badge variant="outline" className="bg-gray-100">
                                Administratif
                              </Badge>
                            ) : (
                              <>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <MapPin className="h-4 w-4 text-primary" />
                                  <span className="font-medium">{matin.site_nom}</span>
                                  {matin.is_1r && (
                                    <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-800">
                                      1R
                                    </Badge>
                                  )}
                                  {matin.is_2f && (
                                    <Badge variant="outline" className="text-xs">
                                      2F
                                    </Badge>
                                  )}
                                </div>
                                {matin.medecins.length > 0 && (
                                  <div className="text-sm text-muted-foreground">
                                    {matin.medecins.join(', ')}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                          {onRefresh && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                              onClick={() => handleDeleteClick(dateStr, true, !!apresMidi)}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Après-midi - Afficher uniquement si assigné */}
                {apresMidi && (
                  <div className="flex gap-3">
                    <div className="flex items-center gap-2 w-32 text-sm font-medium">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      13:00 - 17:00
                    </div>
                    <div className="flex-1">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            {apresMidi.type_assignation === 'administratif' ? (
                              <Badge variant="outline" className="bg-gray-100">
                                Administratif
                              </Badge>
                            ) : (
                              <>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <MapPin className="h-4 w-4 text-primary" />
                                  <span className="font-medium">{apresMidi.site_nom}</span>
                                  {apresMidi.is_1r && (
                                    <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-800">
                                      1R
                                    </Badge>
                                  )}
                                  {apresMidi.is_2f && (
                                    <Badge variant="outline" className="text-xs">
                                      2F
                                    </Badge>
                                  )}
                                </div>
                                {apresMidi.medecins.length > 0 && (
                                  <div className="text-sm text-muted-foreground">
                                    {apresMidi.medecins.join(', ')}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                          {onRefresh && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                              onClick={() => handleDeleteClick(dateStr, !!matin, true)}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Message si aucune assignation */}
                {!matin && !apresMidi && (
                  <div className="text-sm text-muted-foreground italic text-center py-2">
                    Aucune assignation ce jour
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      </SheetContent>
      
      {secretaryToDelete && (
        <DeleteSecretaryDialog
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          secretaryId={secretaryToDelete.id}
          secretaryName={secretaryToDelete.nom}
          date={secretaryToDelete.date}
          hasMatinAssignment={secretaryToDelete.hasMatin}
          hasApresMidiAssignment={secretaryToDelete.hasApresMidi}
          onSuccess={() => {
            onRefresh?.();
            onOpenChange(false);
          }}
        />
      )}
    </Sheet>
  );
}
