import { useState } from 'react';
import { AssignmentResult } from '@/types/planning';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { User, Calendar, MapPin, Clock, Edit } from 'lucide-react';
import { EditSecretaryAssignmentDialog } from './EditSecretaryAssignmentDialog';

interface SecretaryPlanningViewProps {
  assignments: AssignmentResult[];
  weekDays: Date[];
  onRefresh?: () => void;
}

interface EditDialogState {
  secretaryId: string;
  date: string;
  period: 'matin' | 'apres_midi';
  siteId?: string;
}

interface SecretaryData {
  id: string;
  name: string;
  totalAssignments: number;
  siteAssignments: number;
  adminAssignments: number;
  sites: string[];
  is1RCount: number;
  is2FCount: number;
  weekSchedule: Array<{
    date: Date;
    dateStr: string;
    matin?: {
      site_nom?: string;
      site_id?: string;
      medecins: string[];
      is_1r?: boolean;
      is_2f?: boolean;
      type_assignation: 'site' | 'administratif';
    };
    apresMidi?: {
      site_nom?: string;
      site_id?: string;
      medecins: string[];
      is_1r?: boolean;
      is_2f?: boolean;
      type_assignation: 'site' | 'administratif';
    };
  }>;
}

export function SecretaryPlanningView({ assignments, weekDays, onRefresh }: SecretaryPlanningViewProps) {
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editDialogState, setEditDialogState] = useState<EditDialogState | null>(null);

  const handleEditClick = (secretaryId: string, dateStr: string, period: 'matin' | 'apres_midi', siteId?: string) => {
    setEditDialogState({ secretaryId, date: dateStr, period, siteId });
    setEditDialogOpen(true);
  };
  // Filtrer les jours ouvrés (lundi à vendredi)
  const weekdaysOnly = weekDays.filter(d => {
    const dow = d.getDay();
    return dow !== 0 && dow !== 6;
  });

  // Regrouper les assignations par secrétaire
  const secretaryMap = new Map<string, SecretaryData>();

  assignments.forEach(assignment => {
    assignment.secretaires.forEach(sec => {
      const key = sec.id;
      const name = sec.nom;

      if (!secretaryMap.has(key)) {
        // Créer le planning de la semaine pour cette secrétaire
        const weekSchedule = weekdaysOnly.map(day => {
          const dateStr = format(day, 'yyyy-MM-dd');
          return {
            date: day,
            dateStr,
            matin: undefined,
            apresMidi: undefined,
          };
        });

        secretaryMap.set(key, {
          id: key,
          name,
          totalAssignments: 0,
          siteAssignments: 0,
          adminAssignments: 0,
          sites: [],
          is1RCount: 0,
          is2FCount: 0,
          weekSchedule,
        });
      }

      const data = secretaryMap.get(key)!;
      data.totalAssignments++;

      if (assignment.type_assignation === 'site') {
        data.siteAssignments++;
        if (assignment.site_nom && !data.sites.includes(assignment.site_nom)) {
          data.sites.push(assignment.site_nom);
        }
      } else {
        data.adminAssignments++;
      }

      if (sec.is_1r) data.is1RCount++;
      if (sec.is_2f) data.is2FCount++;

      // Ajouter l'assignation au planning de la semaine
      const daySchedule = data.weekSchedule.find(d => d.dateStr === assignment.date);
      if (daySchedule) {
        const assignmentData = {
          site_nom: assignment.site_nom,
          site_id: assignment.site_id,
          medecins: assignment.medecins,
          is_1r: sec.is_1r,
          is_2f: sec.is_2f,
          type_assignation: assignment.type_assignation || 'site',
        };

        if (assignment.periode === 'matin') {
          daySchedule.matin = assignmentData;
        } else {
          daySchedule.apresMidi = assignmentData;
        }
      }
    });
  });

  // Convertir en tableau et trier par nombre d'assignations
  const secretaries = Array.from(secretaryMap.values()).sort(
    (a, b) => b.totalAssignments - a.totalAssignments
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {secretaries.map(secretary => (
        <Card key={secretary.id} className="overflow-hidden">
          <CardHeader className="bg-white">
            <div className="space-y-3">
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5 text-primary" />
                <span className="truncate">{secretary.name}</span>
              </CardTitle>
            </div>
          </CardHeader>
          
          <CardContent className="pt-4">
            <div className="space-y-3">
              {secretary.weekSchedule
                .filter(({ matin, apresMidi }) => matin || apresMidi)
                .map(({ date, dateStr, matin, apresMidi }) => (
                <div key={dateStr} className="border rounded-lg p-3 hover:bg-muted/30 transition-colors">
                  <div className="mb-2 pb-2 border-b">
                    <h4 className="font-medium text-sm">
                      {format(date, 'EEEE d MMM', { locale: fr })}
                    </h4>
                  </div>
                  
                  <div className="space-y-2">
                    {(() => {
                      // Déterminer si on peut regrouper : même site (ou les 2 administratifs) matin ET après-midi
                      const canMerge = matin && apresMidi && 
                        matin.site_id === apresMidi.site_id &&
                        matin.type_assignation === apresMidi.type_assignation;

                      if (canMerge) {
                        // Journée complète au même endroit
                        return (
                          <div className="flex gap-2 items-center">
                            <div className="flex items-center gap-1 w-24 text-xs font-medium text-muted-foreground flex-shrink-0">
                              <Clock className="h-3 w-3" />
                              07:30-17:00
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="space-y-1">
                                {matin.type_assignation === 'administratif' ? (
                                  <Badge variant="outline" className="bg-gray-100 text-xs">
                                    Administratif
                                  </Badge>
                                ) : (
                                  <>
                                    <div className="flex items-center gap-1 flex-wrap">
                                      <MapPin className="h-3 w-3 text-primary flex-shrink-0" />
                                      <span className="font-medium text-sm">
                                        {matin.site_nom}
                                      </span>
                                      {(matin.is_1r || apresMidi.is_1r) && (
                                        <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-800">
                                          1R
                                        </Badge>
                                      )}
                                      {(matin.is_2f || apresMidi.is_2f) && (
                                        <Badge variant="outline" className="text-xs">
                                          2F
                                        </Badge>
                                      )}
                                    </div>
                                  </>
                                )}
                              </div>
                            </div>
                            {onRefresh && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleEditClick(secretary.id, dateStr, 'matin', matin.site_id)}
                                className="h-8 w-8 p-0"
                              >
                                <Edit className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        );
                      }

                      // Affichage séparé matin et après-midi
                      return (
                        <>
                          {/* Matin */}
                          <div className="flex gap-2 items-center">
                            <div className="flex items-center gap-1 w-24 text-xs font-medium text-muted-foreground flex-shrink-0">
                              <Clock className="h-3 w-3" />
                              07:30-12:00
                            </div>
                            <div className="flex-1 min-w-0">
                              {matin ? (
                                <div className="space-y-1">
                                  {matin.type_assignation === 'administratif' ? (
                                    <Badge variant="outline" className="bg-gray-100 text-xs">
                                      Administratif
                                    </Badge>
                                  ) : (
                                    <>
                                      <div className="flex items-center gap-1 flex-wrap">
                                        <MapPin className="h-3 w-3 text-primary flex-shrink-0" />
                                        <span className="font-medium text-sm truncate">
                                          {matin.site_nom?.split(' - ')[0]}
                                        </span>
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
                                    </>
                                  )}
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground italic">-</span>
                              )}
                            </div>
                            {matin && onRefresh && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleEditClick(secretary.id, dateStr, 'matin', matin.site_id)}
                                className="h-8 w-8 p-0"
                              >
                                <Edit className="h-3 w-3" />
                              </Button>
                            )}
                          </div>

                          {/* Après-midi */}
                          <div className="flex gap-2 items-center">
                            <div className="flex items-center gap-1 w-24 text-xs font-medium text-muted-foreground flex-shrink-0">
                              <Clock className="h-3 w-3" />
                              13:00-17:00
                            </div>
                            <div className="flex-1 min-w-0">
                              {apresMidi ? (
                                <div className="space-y-1">
                                  {apresMidi.type_assignation === 'administratif' ? (
                                    <Badge variant="outline" className="bg-gray-100 text-xs">
                                      Administratif
                                    </Badge>
                                  ) : (
                                    <>
                                      <div className="flex items-center gap-1 flex-wrap">
                                        <MapPin className="h-3 w-3 text-primary flex-shrink-0" />
                                        <span className="font-medium text-sm truncate">
                                          {apresMidi.site_nom?.split(' - ')[0]}
                                        </span>
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
                                    </>
                                  )}
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground italic">-</span>
                              )}
                            </div>
                            {apresMidi && onRefresh && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleEditClick(secretary.id, dateStr, 'apres_midi', apresMidi.site_id)}
                                className="h-8 w-8 p-0"
                              >
                                <Edit className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}

      {editDialogState && (
        <EditSecretaryAssignmentDialog
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          secretaryId={editDialogState.secretaryId}
          date={editDialogState.date}
          period={editDialogState.period}
          siteId={editDialogState.siteId}
          onSuccess={() => {
            if (onRefresh) onRefresh();
          }}
        />
      )}
    </div>
  );
}
