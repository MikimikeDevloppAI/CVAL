import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { format, eachDayOfInterval } from 'date-fns';
import { fr } from 'date-fns/locale';
import { User, Clock, MapPin, Loader2, X } from 'lucide-react';
import { DeleteSecretaryDialog } from './DeleteSecretaryDialog';

const SALLE_COLORS: Record<string, string> = {
  rouge: 'bg-red-100 text-red-700 border-red-300',
  verte: 'bg-green-100 text-green-700 border-green-300',
  jaune: 'bg-yellow-100 text-yellow-700 border-yellow-300'
};

interface SecretaryPlanningViewProps {
  startDate: Date;
  endDate: Date;
}

interface SecretaryAssignment {
  id: string;
  date: string;
  periode: 'matin' | 'apres_midi';
  type_assignation: 'site' | 'administratif' | 'bloc';
  site_id?: string;
  site_nom?: string;
  is_1r: boolean;
  is_2f: boolean;
  is_3f: boolean;
  ordre: number;
  type_besoin_bloc?: string;
  salle_assignee?: string;
}

interface SecretaryData {
  id: string;
  name: string;
  totalAssignments: number;
  siteAssignments: number;
  adminAssignments: number;
  blocAssignments: number;
  sites: string[];
  is1RCount: number;
  is2FCount: number;
  is3FCount: number;
  weekSchedule: Array<{
    date: Date;
    dateStr: string;
    matin?: SecretaryAssignment;
    apresMidi?: SecretaryAssignment;
  }>;
}

export function SecretaryPlanningView({ startDate, endDate }: SecretaryPlanningViewProps) {
  const [loading, setLoading] = useState(true);
  const [secretaries, setSecretaries] = useState<SecretaryData[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [secretaryToDelete, setSecretaryToDelete] = useState<{
    id: string;
    nom: string;
    date: string;
    hasMatin: boolean;
    hasApresMidi: boolean;
  } | null>(null);

  useEffect(() => {
    fetchSecretaryPlanning();

    // Real-time updates
    const channel = supabase
      .channel('secretary-planning-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'planning_genere_personnel'
        },
        () => {
          fetchSecretaryPlanning();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [startDate, endDate]);

  const fetchSecretaryPlanning = async () => {
    try {
      setLoading(true);
      const startDateStr = format(startDate, 'yyyy-MM-dd');
      const endDateStr = format(endDate, 'yyyy-MM-dd');

      // Fetch planning personnel data with secretaries and sites
      const { data: personnelData, error: personnelError } = await supabase
        .from('planning_genere_personnel')
        .select(`
          *,
          secretaire:secretaires(first_name, name),
          site:sites(nom),
          bloc:planning_genere_bloc_operatoire(salle_assignee)
        `)
        .gte('date', startDateStr)
        .lte('date', endDateStr)
        .not('secretaire_id', 'is', null)
        .order('date')
        .order('periode')
        .order('ordre');

      if (personnelError) throw personnelError;

      // Get all days in the week (Monday to Friday)
      const weekDays = eachDayOfInterval({ start: startDate, end: endDate })
        .filter(d => {
          const dow = d.getDay();
          return dow !== 0 && dow !== 6; // Exclude weekends
        });

      // Group by secretary
      const secretaryMap = new Map<string, SecretaryData>();

      personnelData?.forEach(assignment => {
        const secId = assignment.secretaire_id;
        if (!secId) return;

        const secName = assignment.secretaire
          ? `${assignment.secretaire.first_name} ${assignment.secretaire.name}`
          : 'Secrétaire inconnue';

        if (!secretaryMap.has(secId)) {
          const weekSchedule = weekDays.map(day => ({
            date: day,
            dateStr: format(day, 'yyyy-MM-dd'),
            matin: undefined,
            apresMidi: undefined,
          }));

          secretaryMap.set(secId, {
            id: secId,
            name: secName,
            totalAssignments: 0,
            siteAssignments: 0,
            adminAssignments: 0,
            blocAssignments: 0,
            sites: [],
            is1RCount: 0,
            is2FCount: 0,
            is3FCount: 0,
            weekSchedule,
          });
        }

        const secData = secretaryMap.get(secId)!;
        secData.totalAssignments++;

        if (assignment.type_assignation === 'site') {
          secData.siteAssignments++;
          const siteName = assignment.site?.nom || 'Site inconnu';
          if (!secData.sites.includes(siteName)) {
            secData.sites.push(siteName);
          }
        } else if (assignment.type_assignation === 'administratif') {
          secData.adminAssignments++;
        } else if (assignment.type_assignation === 'bloc') {
          secData.blocAssignments++;
        }

        if (assignment.is_1r) secData.is1RCount++;
        if (assignment.is_2f) secData.is2FCount++;
        if (assignment.is_3f) secData.is3FCount++;

        // Add to week schedule
        const daySchedule = secData.weekSchedule.find(d => d.dateStr === assignment.date);
        if (daySchedule) {
          const assignmentData: SecretaryAssignment = {
            id: assignment.id,
            date: assignment.date,
            periode: assignment.periode,
            type_assignation: (assignment.type_assignation || 'site') as 'site' | 'administratif' | 'bloc',
            site_id: assignment.site_id,
            site_nom: assignment.site?.nom,
            is_1r: assignment.is_1r,
            is_2f: assignment.is_2f,
            is_3f: assignment.is_3f,
            ordre: assignment.ordre,
            type_besoin_bloc: assignment.type_besoin_bloc,
            salle_assignee: assignment.bloc?.salle_assignee
          };

          if (assignment.periode === 'matin') {
            daySchedule.matin = assignmentData;
          } else {
            daySchedule.apresMidi = assignmentData;
          }
        }
      });

      // Convert to array and sort alphabetically
      const sortedSecretaries = Array.from(secretaryMap.values()).sort(
        (a, b) => a.name.localeCompare(b.name, 'fr')
      );

      setSecretaries(sortedSecretaries);
    } catch (error) {
      console.error('Error fetching secretary planning:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteClick = (secretaryId: string, secretaryName: string, date: string, hasMatin: boolean, hasApresMidi: boolean) => {
    setSecretaryToDelete({
      id: secretaryId,
      nom: secretaryName,
      date,
      hasMatin,
      hasApresMidi,
    });
    setDeleteDialogOpen(true);
  };

  const getAssignmentBadge = (assignment: SecretaryAssignment) => {
    if (assignment.type_assignation === 'administratif') {
      return (
        <Badge variant="outline" className="bg-gray-100 text-xs">
          Administratif
        </Badge>
      );
    }

    if (assignment.type_assignation === 'bloc') {
      const salleColor = assignment.salle_assignee 
        ? SALLE_COLORS[assignment.salle_assignee.toLowerCase()] || 'bg-purple-100 text-purple-800'
        : 'bg-purple-100 text-purple-800';
      
      return (
        <div className="flex items-center gap-1 flex-wrap">
          {assignment.salle_assignee && (
            <Badge variant="outline" className={`text-xs border ${salleColor}`}>
              Salle {assignment.salle_assignee}
            </Badge>
          )}
          <Badge variant="outline" className="bg-purple-100 text-purple-800 text-xs">
            {assignment.type_besoin_bloc || 'Personnel'}
          </Badge>
        </div>
      );
    }

    return (
      <div className="flex items-center gap-1 flex-wrap">
        <MapPin className="h-3 w-3 text-primary flex-shrink-0" />
            <span className="font-medium text-sm">
              {assignment.site_nom}
            </span>
        {assignment.is_1r && (
          <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-800">
            1R
          </Badge>
        )}
        {assignment.is_2f && (
          <Badge variant="outline" className="text-xs">
            2F
          </Badge>
        )}
        {assignment.is_3f && (
          <Badge variant="outline" className="text-xs bg-green-100 text-green-800">
            3F
          </Badge>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Chargement du planning par secrétaire...</p>
        </CardContent>
      </Card>
    );
  }

  if (secretaries.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">
          Aucune assignation de secrétaire pour cette semaine
        </CardContent>
      </Card>
    );
  }

  return (
    <>
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
                        // Check if we can merge: same site (or both admin) for both periods
                        const canMerge = matin && apresMidi && 
                          matin.site_id === apresMidi.site_id &&
                          matin.type_assignation === apresMidi.type_assignation;

                        if (canMerge) {
                          // Full day at the same place
                          return (
                            <div className="flex gap-2 items-center">
                              <div className="flex items-center gap-1 w-32 text-xs font-medium text-muted-foreground flex-shrink-0">
                                <Clock className="h-3 w-3" />
                                Toute la journée
                              </div>
                              <div className="flex-1 min-w-0">
                                {getAssignmentBadge(matin)}
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDeleteClick(secretary.id, secretary.name, dateStr, true, true)}
                                className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          );
                        }

                        // Separate morning and afternoon display
                        return (
                          <>
                            {/* Morning */}
                            <div className="flex gap-2 items-center">
                              <div className="flex items-center gap-1 w-32 text-xs font-medium text-muted-foreground flex-shrink-0">
                                <Clock className="h-3 w-3" />
                                Matin
                              </div>
                              <div className="flex-1 min-w-0">
                                {matin ? (
                                  getAssignmentBadge(matin)
                                ) : (
                                  <span className="text-xs text-muted-foreground italic">-</span>
                                )}
                              </div>
                              {matin && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDeleteClick(secretary.id, secretary.name, dateStr, true, !!apresMidi)}
                                  className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              )}
                            </div>

                            {/* Afternoon */}
                            <div className="flex gap-2 items-center">
                              <div className="flex items-center gap-1 w-32 text-xs font-medium text-muted-foreground flex-shrink-0">
                                <Clock className="h-3 w-3" />
                                Après-midi
                              </div>
                              <div className="flex-1 min-w-0">
                                {apresMidi ? (
                                  getAssignmentBadge(apresMidi)
                                ) : (
                                  <span className="text-xs text-muted-foreground italic">-</span>
                                )}
                              </div>
                              {apresMidi && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDeleteClick(secretary.id, secretary.name, dateStr, !!matin, true)}
                                  className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                                >
                                  <X className="h-3 w-3" />
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
      </div>

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
            fetchSecretaryPlanning();
            setSecretaryToDelete(null);
          }}
        />
      )}
    </>
  );
}
