import { useState } from 'react';
import { AssignmentResult } from '@/types/planning';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { SecretaryWeekView } from './SecretaryWeekView';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface PlanningGridViewProps {
  assignments: AssignmentResult[];
  weekDays: Date[];
  onRefresh?: () => void;
}

export function PlanningGridView({ assignments, weekDays, onRefresh }: PlanningGridViewProps) {
  const [selectedSecretary, setSelectedSecretary] = useState<{
    name: string;
    id: string;
  } | null>(null);

  // Filtrer uniquement les jours ouvrés
  const weekdaysOnly = weekDays.filter(d => {
    const dow = d.getDay();
    return dow !== 0 && dow !== 6;
  });

  // Grouper par site
  const sites = [...new Set(assignments.map(a => a.site_id))];
  
  const assignmentsBySite = sites.map(siteId => {
    const siteAssignments = assignments.filter(a => a.site_id === siteId);
    const siteName = siteAssignments[0]?.site_nom || 'Administratif';

    const dayGroups = weekdaysOnly.map(day => {
      const dateStr = format(day, 'yyyy-MM-dd');
      const dayAssignments = siteAssignments.filter(a => a.date === dateStr);
      
      const matin = dayAssignments.find(a => a.periode === 'matin');
      const apresMidi = dayAssignments.find(a => a.periode === 'apres_midi');
      
      return {
        date: day,
        dateStr,
        matin,
        apresMidi,
      };
    });
    
    return {
      siteId,
      siteName,
      dayGroups,
    };
  });

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
      <div className="rounded-md border bg-background">
        <div className="overflow-auto max-h-[calc(100vh-250px)]">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10 shadow-sm">
              <TableRow>
                <TableHead className="sticky left-0 bg-background z-20 min-w-[200px] font-semibold border-r">
                  Site
                </TableHead>
                {weekdaysOnly.map((day) => (
                  <TableHead key={day.toISOString()} className="text-center min-w-[180px]">
                    <div className="font-semibold">
                      {format(day, 'EEEE', { locale: fr })}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {format(day, 'dd/MM/yyyy')}
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignmentsBySite.map(({ siteId, siteName, dayGroups }) => (
                <TableRow key={siteId}>
                  <TableCell className="sticky left-0 bg-background z-10 font-medium border-r">
                    {siteName}
                  </TableCell>
                  {dayGroups.map(({ dateStr, matin, apresMidi }) => (
                    <TableCell key={dateStr} className="p-2">
                      <div className="space-y-2">
                        {/* Matin */}
                        <div className="border rounded p-2 bg-muted/30">
                          <div className="text-xs font-medium text-muted-foreground mb-1">
                            Matin
                          </div>
                          {matin ? (
                            <div className="space-y-1">
                              <div className="flex items-center gap-1 flex-wrap">
                                {matin.secretaires.map((sec) => (
                                  <button
                                    key={sec.id}
                                    onClick={() => setSelectedSecretary({ id: sec.id, name: sec.nom })}
                                    className="text-xs hover:underline cursor-pointer flex items-center gap-1"
                                  >
                                    <span>{sec.nom}</span>
                                    {(sec.is_1r || sec.is_2f) && (
                                      <Badge variant="outline" className="text-[10px] px-1 py-0">
                                        {sec.is_1r && '1R'}
                                        {sec.is_2f && '2F'}
                                      </Badge>
                                    )}
                                  </button>
                                ))}
                              </div>
                              {matin.nombre_assigne < matin.nombre_requis && (
                                <Badge variant="destructive" className="text-[10px]">
                                  {matin.nombre_assigne}/{matin.nombre_requis}
                                </Badge>
                              )}
                            </div>
                          ) : (
                            <div className="text-xs text-muted-foreground">-</div>
                          )}
                        </div>

                        {/* Après-midi */}
                        <div className="border rounded p-2 bg-muted/30">
                          <div className="text-xs font-medium text-muted-foreground mb-1">
                            Après-midi
                          </div>
                          {apresMidi ? (
                            <div className="space-y-1">
                              <div className="flex items-center gap-1 flex-wrap">
                                {apresMidi.secretaires.map((sec) => (
                                  <button
                                    key={sec.id}
                                    onClick={() => setSelectedSecretary({ id: sec.id, name: sec.nom })}
                                    className="text-xs hover:underline cursor-pointer flex items-center gap-1"
                                  >
                                    <span>{sec.nom}</span>
                                    {(sec.is_1r || sec.is_2f) && (
                                      <Badge variant="outline" className="text-[10px] px-1 py-0">
                                        {sec.is_1r && '1R'}
                                        {sec.is_2f && '2F'}
                                      </Badge>
                                    )}
                                  </button>
                                ))}
                              </div>
                              {apresMidi.nombre_assigne < apresMidi.nombre_requis && (
                                <Badge variant="destructive" className="text-[10px]">
                                  {apresMidi.nombre_assigne}/{apresMidi.nombre_requis}
                                </Badge>
                              )}
                            </div>
                          ) : (
                            <div className="text-xs text-muted-foreground">-</div>
                          )}
                        </div>
                      </div>
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {selectedSecretary && (
        <SecretaryWeekView
          open={!!selectedSecretary}
          onOpenChange={(open) => !open && setSelectedSecretary(null)}
          secretaryId={selectedSecretary.id}
          secretaryName={selectedSecretary.name}
          assignments={getSecretaryAssignments(selectedSecretary.id)}
          weekDays={weekDays}
          onRefresh={onRefresh}
        />
      )}
    </>
  );
}
