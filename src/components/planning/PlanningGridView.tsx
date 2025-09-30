import { AssignmentResult } from '@/types/planning';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { AlertTriangle } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';

interface PlanningGridViewProps {
  assignments: AssignmentResult[];
  weekDays: Date[];
}

export function PlanningGridView({ assignments, weekDays }: PlanningGridViewProps) {
  const getAssignmentForDatePeriod = (date: Date, period: 'matin' | 'apres_midi', siteId: string) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    return assignments.find(
      a => a.date === dateStr && a.periode === period && a.site_id === siteId
    );
  };

  const sites = [...new Set(assignments.map(a => ({ id: a.site_id, nom: a.site_nom })))];

  const getStatusColor = (status: 'satisfait' | 'arrondi_inferieur' | 'non_satisfait') => {
    switch (status) {
      case 'satisfait':
        return 'bg-green-100 border-green-300 text-green-900';
      case 'arrondi_inferieur':
        return 'bg-yellow-100 border-yellow-300 text-yellow-900';
      case 'non_satisfait':
        return 'bg-red-100 border-red-300 text-red-900';
    }
  };

  return (
    <div className="space-y-6">
      {weekDays.map(day => (
        <Card key={day.toISOString()} className="p-6">
          <h3 className="text-lg font-semibold mb-4">
            {format(day, 'EEEE d MMMM yyyy', { locale: fr })}
          </h3>
          
          <div className="space-y-4">
            {sites.map(site => (
              <div key={site.id} className="border rounded-lg overflow-hidden">
                <div className="bg-muted px-4 py-2 font-medium">
                  {site.nom}
                </div>
                
                {/* Matin */}
                <div className="p-4 border-b">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="text-sm font-medium mb-2">🌅 Matin (07:30 - 12:00)</div>
                      {(() => {
                        const assignment = getAssignmentForDatePeriod(day, 'matin', site.id);
                        if (!assignment) {
                          return <div className="text-sm text-muted-foreground">Aucun besoin</div>;
                        }
                        
                        return (
                          <div className={`p-3 rounded border ${getStatusColor(assignment.status)}`}>
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-medium">
                                {assignment.nombre_assigne} / {assignment.nombre_requis} secrétaires
                              </span>
                              <div className="flex gap-1">
                                {assignment.has_1r && (
                                  <Badge variant="secondary" className="text-xs">1R</Badge>
                                )}
                                {assignment.has_2f && (
                                  <Badge variant="secondary" className="text-xs">2F</Badge>
                                )}
                              </div>
                            </div>
                            <div className="space-y-1">
                              {assignment.secretaires.map(sec => (
                                <div key={sec.id} className="text-sm flex items-center gap-2">
                                  {sec.nom}
                                  {sec.is_backup && (
                                    <Badge variant="outline" className="text-xs">Backup</Badge>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>
                
                {/* Après-midi */}
                <div className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="text-sm font-medium mb-2">🌆 Après-midi (13:00 - 17:00)</div>
                      {(() => {
                        const assignment = getAssignmentForDatePeriod(day, 'apres_midi', site.id);
                        if (!assignment) {
                          return <div className="text-sm text-muted-foreground">Aucun besoin</div>;
                        }
                        
                        return (
                          <div className={`p-3 rounded border ${getStatusColor(assignment.status)}`}>
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-medium">
                                {assignment.nombre_assigne} / {assignment.nombre_requis} secrétaires
                              </span>
                              <div className="flex gap-1">
                                {assignment.has_1r && (
                                  <Badge variant="secondary" className="text-xs">1R</Badge>
                                )}
                                {assignment.has_2f && (
                                  <Badge variant="secondary" className="text-xs">2F</Badge>
                                )}
                              </div>
                            </div>
                            <div className="space-y-1">
                              {assignment.secretaires.map(sec => (
                                <div key={sec.id} className="text-sm flex items-center gap-2">
                                  {sec.nom}
                                  {sec.is_backup && (
                                    <Badge variant="outline" className="text-xs">Backup</Badge>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
