import { useState } from 'react';
import { AssignmentResult } from '@/types/planning';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Building2, User } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { SecretaryWeekView } from './SecretaryWeekView';

interface PlanningGridViewProps {
  assignments: AssignmentResult[];
  weekDays: Date[];
}

export function PlanningGridView({ assignments, weekDays }: PlanningGridViewProps) {
  const [selectedSecretary, setSelectedSecretary] = useState<{
    name: string;
    id: string;
  } | null>(null);

  // Grouper par jour
  const assignmentsByDay = weekDays.map(day => {
    const dateStr = format(day, 'yyyy-MM-dd');
    const dayAssignments = assignments.filter(a => a.date === dateStr);
    
    // Grouper par site
    const sites = [...new Set(dayAssignments.map(a => a.site_id))];
    const siteGroups = sites.map(siteId => {
      const siteAssignments = dayAssignments.filter(a => a.site_id === siteId);
      const siteName = siteAssignments[0]?.site_nom || '';
      
      const matin = siteAssignments.find(a => a.periode === 'matin');
      const apresMidi = siteAssignments.find(a => a.periode === 'apres_midi');
      
      // Calculer les totaux
      const totalSecretaires = (matin?.nombre_assigne || 0) + (apresMidi?.nombre_assigne || 0);
      const totalRequis = (matin?.nombre_requis || 0) + (apresMidi?.nombre_requis || 0);
      
      return {
        siteId,
        siteName,
        matin,
        apresMidi,
        totalSecretaires,
        totalRequis
      };
    });
    
    return {
      date: day,
      dateStr,
      siteGroups
    };
  });

  const getStatusClass = (status?: 'satisfait' | 'arrondi_inferieur' | 'non_satisfait') => {
    if (!status) return 'bg-muted/30';
    switch (status) {
      case 'satisfait':
        return 'bg-green-50 border-green-200';
      case 'arrondi_inferieur':
        return 'bg-yellow-50 border-yellow-200';
      case 'non_satisfait':
        return 'bg-red-50 border-red-200';
    }
  };

  // Get all secretaries from assignments
  const allSecretaries = new Map<string, string>();
  for (const assignment of assignments) {
    for (const sec of assignment.secretaires) {
      allSecretaries.set(sec.id, sec.nom);
    }
  }

  // Get assignments for selected secretary
  const getSecretaryAssignments = (secretaryId: string) => {
    return assignments
      .filter(a => a.secretaires.some(s => s.id === secretaryId))
      .map(a => {
        const sec = a.secretaires.find(s => s.id === secretaryId)!;
        return {
          date: a.date,
          periode: a.periode,
          site_nom: a.site_nom,
          medecins: a.medecins,
          is_1r: sec.is_1r,
          is_2f: sec.is_2f,
          type_assignation: 'site' as const,
        };
      });
  };

  return (
    <>
      <div className="space-y-6">
        {assignmentsByDay.map(({ date, dateStr, siteGroups }) => (
          <Card key={dateStr}>
            <CardHeader className="bg-primary/5 pb-4">
              <CardTitle className="text-lg">
                {format(date, 'EEEE d MMMM yyyy', { locale: fr })}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="space-y-6">
                {siteGroups.map(({ siteId, siteName, matin, apresMidi, totalSecretaires, totalRequis }) => (
                  <div key={siteId} className="border rounded-lg overflow-hidden">
                    <div className="bg-primary/5 px-4 py-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Building2 className="h-5 w-5 text-primary" />
                          <span className="font-medium">{siteName}</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <div className="text-xs text-muted-foreground">Secrétaires</div>
                            <div className="font-semibold text-sm">
                              {totalSecretaires} / {totalRequis}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse">
                        <thead>
                          <tr className="bg-muted/50">
                            <th className="text-left p-3 font-medium text-sm border-b w-32">Horaire</th>
                            <th className="text-left p-3 font-medium text-sm border-b">Médecins</th>
                            <th className="text-left p-3 font-medium text-sm border-b">Secrétaires assignées</th>
                            <th className="text-center p-3 font-medium text-sm border-b w-24">Nombre</th>
                            <th className="text-center p-3 font-medium text-sm border-b w-32">Statut</th>
                          </tr>
                        </thead>
                        <tbody>
                          {/* Matin */}
                          <tr className={`border-b ${getStatusClass(matin?.status)}`}>
                            <td className="p-3">
                              <div className="font-medium">07:30 - 12:00</div>
                            </td>
                            <td className="p-3">
                              {matin && matin.medecins && matin.medecins.length > 0 ? (
                                <div className="space-y-1">
                                  {matin.medecins.map((med, idx) => (
                                    <div key={idx} className="text-sm font-medium">
                                      {med}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-sm text-muted-foreground">-</span>
                              )}
                            </td>
                            <td className="p-3">
                              {matin ? (
                                <div className="space-y-1">
                                  {matin.secretaires.map(sec => (
                                    <button
                                      key={sec.id}
                                      onClick={() => setSelectedSecretary({ name: sec.nom, id: sec.id })}
                                      className="flex items-center gap-2 text-sm hover:bg-primary/10 px-2 py-1 rounded transition-colors"
                                    >
                                      <User className="h-3 w-3 text-primary" />
                                      <span className="underline decoration-dotted">{sec.nom}</span>
                                      {matin.site_fermeture && sec.is_1r && (
                                        <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-800">1R</Badge>
                                      )}
                                      {matin.site_fermeture && sec.is_2f && (
                                        <Badge variant="outline" className="text-xs">2F</Badge>
                                      )}
                                    </button>
                                  ))}
                                  {matin.secretaires.length === 0 && (
                                    <span className="text-sm text-muted-foreground">Aucune assignation</span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-sm text-muted-foreground">Pas de besoin</span>
                              )}
                            </td>
                            <td className="p-3 text-center">
                              {matin ? (
                                <span className="font-medium">
                                  {matin.nombre_assigne} / {matin.nombre_requis}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </td>
                            <td className="p-3 text-center">
                              {matin?.status === 'satisfait' && (
                                <Badge className="bg-green-600">Satisfait</Badge>
                              )}
                              {matin?.status === 'arrondi_inferieur' && (
                                <Badge className="bg-yellow-600">Partiel</Badge>
                              )}
                              {matin?.status === 'non_satisfait' && (
                                <Badge variant="destructive">Non satisfait</Badge>
                              )}
                            </td>
                          </tr>
                          
                          {/* Après-midi */}
                          <tr className={getStatusClass(apresMidi?.status)}>
                            <td className="p-3">
                              <div className="font-medium">13:00 - 17:00</div>
                            </td>
                            <td className="p-3">
                              {apresMidi && apresMidi.medecins && apresMidi.medecins.length > 0 ? (
                                <div className="space-y-1">
                                  {apresMidi.medecins.map((med, idx) => (
                                    <div key={idx} className="text-sm font-medium">
                                      {med}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-sm text-muted-foreground">-</span>
                              )}
                            </td>
                            <td className="p-3">
                              {apresMidi ? (
                                <div className="space-y-1">
                                  {apresMidi.secretaires.map(sec => (
                                    <button
                                      key={sec.id}
                                      onClick={() => setSelectedSecretary({ name: sec.nom, id: sec.id })}
                                      className="flex items-center gap-2 text-sm hover:bg-primary/10 px-2 py-1 rounded transition-colors"
                                    >
                                      <User className="h-3 w-3 text-primary" />
                                      <span className="underline decoration-dotted">{sec.nom}</span>
                                      {apresMidi.site_fermeture && sec.is_1r && (
                                        <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-800">1R</Badge>
                                      )}
                                      {apresMidi.site_fermeture && sec.is_2f && (
                                        <Badge variant="outline" className="text-xs">2F</Badge>
                                      )}
                                    </button>
                                  ))}
                                  {apresMidi.secretaires.length === 0 && (
                                    <span className="text-sm text-muted-foreground">Aucune assignation</span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-sm text-muted-foreground">Pas de besoin</span>
                              )}
                            </td>
                            <td className="p-3 text-center">
                              {apresMidi ? (
                                <span className="font-medium">
                                  {apresMidi.nombre_assigne} / {apresMidi.nombre_requis}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </td>
                            <td className="p-3 text-center">
                              {apresMidi?.status === 'satisfait' && (
                                <Badge className="bg-green-600">Satisfait</Badge>
                              )}
                              {apresMidi?.status === 'arrondi_inferieur' && (
                                <Badge className="bg-yellow-600">Partiel</Badge>
                              )}
                              {apresMidi?.status === 'non_satisfait' && (
                                <Badge variant="destructive">Non satisfait</Badge>
                              )}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {selectedSecretary && (
        <SecretaryWeekView
          open={true}
          onOpenChange={(open) => !open && setSelectedSecretary(null)}
          secretaryName={selectedSecretary.name}
          assignments={getSecretaryAssignments(selectedSecretary.id)}
          weekDays={weekDays}
        />
      )}
    </>
  );
}
