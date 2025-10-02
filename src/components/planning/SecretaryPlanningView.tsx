import { useState } from 'react';
import { AssignmentResult } from '@/types/planning';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { User, Calendar, MapPin } from 'lucide-react';
import { SecretaryWeekView } from './SecretaryWeekView';

interface SecretaryPlanningViewProps {
  assignments: AssignmentResult[];
  weekDays: Date[];
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
}

export function SecretaryPlanningView({ assignments, weekDays }: SecretaryPlanningViewProps) {
  const [selectedSecretary, setSelectedSecretary] = useState<string | null>(null);
  const [selectedSecretaryData, setSelectedSecretaryData] = useState<{
    name: string;
    assignments: Array<{
      date: string;
      periode: 'matin' | 'apres_midi';
      site_nom?: string;
      medecins: string[];
      is_1r?: boolean;
      is_2f?: boolean;
      type_assignation: 'site' | 'administratif';
    }>;
  } | null>(null);

  // Regrouper les assignations par secrétaire
  const secretaryMap = new Map<string, SecretaryData>();

  assignments.forEach(assignment => {
    assignment.secretaires.forEach(sec => {
      const key = sec.id;
      const name = sec.nom;

      if (!secretaryMap.has(key)) {
        secretaryMap.set(key, {
          id: key,
          name,
          totalAssignments: 0,
          siteAssignments: 0,
          adminAssignments: 0,
          sites: [],
          is1RCount: 0,
          is2FCount: 0,
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
    });
  });

  // Convertir en tableau et trier par nombre d'assignations
  const secretaries = Array.from(secretaryMap.values()).sort(
    (a, b) => b.totalAssignments - a.totalAssignments
  );

  const handleSecretaryClick = (secretaryId: string, secretaryName: string) => {
    // Récupérer toutes les assignations de cette secrétaire
    const secretaryAssignments = assignments
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
          type_assignation: a.type_assignation || 'site',
        };
      });

    setSelectedSecretaryData({
      name: secretaryName,
      assignments: secretaryAssignments,
    });
    setSelectedSecretary(secretaryId);
  };

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {secretaries.map(secretary => (
          <Card
            key={secretary.id}
            className="cursor-pointer hover:shadow-lg transition-shadow"
            onClick={() => handleSecretaryClick(secretary.id, secretary.name)}
          >
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5 text-primary" />
                <span className="truncate">{secretary.name}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Calendar className="h-4 w-4" />
                  <span>Assignations</span>
                </div>
                <Badge variant="secondary" className="text-base font-semibold">
                  {secretary.totalAssignments}
                </Badge>
              </div>

              {secretary.siteAssignments > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Sur site</span>
                    <span className="font-medium">{secretary.siteAssignments}</span>
                  </div>
                  {secretary.sites.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {secretary.sites.slice(0, 3).map(site => (
                        <Badge key={site} variant="outline" className="text-xs">
                          {site.split(' - ')[0]}
                        </Badge>
                      ))}
                      {secretary.sites.length > 3 && (
                        <Badge variant="outline" className="text-xs">
                          +{secretary.sites.length - 3}
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
              )}

              {secretary.adminAssignments > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Administratif</span>
                  <span className="font-medium">{secretary.adminAssignments}</span>
                </div>
              )}

              {(secretary.is1RCount > 0 || secretary.is2FCount > 0) && (
                <div className="flex gap-2 pt-2 border-t">
                  {secretary.is1RCount > 0 && (
                    <Badge variant="secondary" className="bg-blue-100 text-blue-800">
                      1R: {secretary.is1RCount}
                    </Badge>
                  )}
                  {secretary.is2FCount > 0 && (
                    <Badge variant="outline">
                      2F: {secretary.is2FCount}
                    </Badge>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {selectedSecretaryData && (
        <SecretaryWeekView
          open={selectedSecretary !== null}
          onOpenChange={(open) => {
            if (!open) {
              setSelectedSecretary(null);
              setSelectedSecretaryData(null);
            }
          }}
          secretaryName={selectedSecretaryData.name}
          assignments={selectedSecretaryData.assignments}
          weekDays={weekDays}
        />
      )}
    </>
  );
}
