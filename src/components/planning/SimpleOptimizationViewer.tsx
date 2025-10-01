import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Users, Building2, Clock, CheckCircle, AlertCircle } from 'lucide-react';

interface SimpleAssignment {
  date: string;
  periode: 'matin' | 'apres_midi';
  specialite_id: string;
  besoin_arrondi: number;
  secretaires_assignees: {
    nom_complet: string;
    secretaire_id?: string;
    backup_id?: string;
  }[];
  taux_satisfaction: number;
}

interface AdministratifGroup {
  date: string;
  periode: string;
  secretaires: {
    nom_complet: string;
    secretaire_id?: string;
    backup_id?: string;
  }[];
}

interface SimpleOptimizationViewerProps {
  result: {
    assignments: SimpleAssignment[];
    administratif: AdministratifGroup[];
    stats: {
      total_secretaires: number;
      assignees_specialites: number;
      assignees_administratif: number;
    };
  };
  specialites: { id: string; nom: string }[];
}

export function SimpleOptimizationViewer({ result, specialites }: SimpleOptimizationViewerProps) {
  const getSpecialiteNom = (specialiteId: string) => {
    return specialites.find(s => s.id === specialiteId)?.nom || 'Spécialité inconnue';
  };

  const formatPeriode = (periode: string) => {
    return periode === 'matin' ? 'Matin' : 'Après-midi';
  };

  const getSatisfactionColor = (taux: number) => {
    if (taux >= 100) return 'bg-green-500';
    if (taux >= 80) return 'bg-orange-500';
    return 'bg-red-500';
  };

  // Group by date
  const byDate = new Map<string, SimpleAssignment[]>();
  for (const assignment of result.assignments) {
    if (!byDate.has(assignment.date)) {
      byDate.set(assignment.date, []);
    }
    byDate.get(assignment.date)!.push(assignment);
  }

  // Group administratif by date
  const adminByDate = new Map<string, AdministratifGroup[]>();
  for (const admin of result.administratif) {
    if (!adminByDate.has(admin.date)) {
      adminByDate.set(admin.date, []);
    }
    adminByDate.get(admin.date)!.push(admin);
  }

  const dates = Array.from(new Set([...byDate.keys(), ...adminByDate.keys()])).sort();

  return (
    <div className="space-y-6">
      {/* Stats globales */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Résumé de l'optimisation
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-3xl font-bold text-primary">{result.stats.total_secretaires}</div>
              <div className="text-sm text-muted-foreground">Total secrétaires</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-green-600">{result.stats.assignees_specialites}</div>
              <div className="text-sm text-muted-foreground">Assignées aux spécialités</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-orange-600">{result.stats.assignees_administratif}</div>
              <div className="text-sm text-muted-foreground">En administratif</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Par jour */}
      {dates.map(date => {
        const assignments = byDate.get(date) || [];
        const administratif = adminByDate.get(date) || [];

        return (
          <Card key={date}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                {format(new Date(date), 'EEEE d MMMM yyyy', { locale: fr })}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Matin */}
              {(assignments.some(a => a.periode === 'matin') || administratif.some(a => a.periode === 'matin')) && (
                <div>
                  <h4 className="font-semibold mb-3 flex items-center gap-2">
                    <Badge variant="outline">Matin</Badge>
                  </h4>
                  
                  {/* Assignments par spécialité */}
                  <div className="space-y-3 mb-4">
                    {assignments
                      .filter(a => a.periode === 'matin')
                      .map((assignment, idx) => (
                        <div key={idx} className="border rounded-lg p-3">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <Building2 className="h-4 w-4 text-muted-foreground" />
                              <span className="font-medium">{getSpecialiteNom(assignment.specialite_id)}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              {assignment.taux_satisfaction >= 100 ? (
                                <CheckCircle className="h-4 w-4 text-green-600" />
                              ) : (
                                <AlertCircle className="h-4 w-4 text-orange-600" />
                              )}
                              <Badge className={getSatisfactionColor(assignment.taux_satisfaction)}>
                                {assignment.secretaires_assignees.length}/{assignment.besoin_arrondi} ({assignment.taux_satisfaction.toFixed(0)}%)
                              </Badge>
                            </div>
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {assignment.secretaires_assignees.map(s => s.nom_complet).join(', ') || 'Aucune secrétaire assignée'}
                          </div>
                        </div>
                      ))}
                  </div>

                  {/* Administratif */}
                  {administratif.filter(a => a.periode === 'matin').map((admin, idx) => (
                    <div key={idx} className="border border-orange-200 bg-orange-50 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Users className="h-4 w-4 text-orange-600" />
                        <span className="font-medium text-orange-900">Administratif ({admin.secretaires.length})</span>
                      </div>
                      <div className="text-sm text-orange-800">
                        {admin.secretaires.map(s => s.nom_complet).join(', ')}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <Separator />

              {/* Après-midi */}
              {(assignments.some(a => a.periode === 'apres_midi') || administratif.some(a => a.periode === 'apres_midi')) && (
                <div>
                  <h4 className="font-semibold mb-3 flex items-center gap-2">
                    <Badge variant="outline">Après-midi</Badge>
                  </h4>
                  
                  {/* Assignments par spécialité */}
                  <div className="space-y-3 mb-4">
                    {assignments
                      .filter(a => a.periode === 'apres_midi')
                      .map((assignment, idx) => (
                        <div key={idx} className="border rounded-lg p-3">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <Building2 className="h-4 w-4 text-muted-foreground" />
                              <span className="font-medium">{getSpecialiteNom(assignment.specialite_id)}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              {assignment.taux_satisfaction >= 100 ? (
                                <CheckCircle className="h-4 w-4 text-green-600" />
                              ) : (
                                <AlertCircle className="h-4 w-4 text-orange-600" />
                              )}
                              <Badge className={getSatisfactionColor(assignment.taux_satisfaction)}>
                                {assignment.secretaires_assignees.length}/{assignment.besoin_arrondi} ({assignment.taux_satisfaction.toFixed(0)}%)
                              </Badge>
                            </div>
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {assignment.secretaires_assignees.map(s => s.nom_complet).join(', ') || 'Aucune secrétaire assignée'}
                          </div>
                        </div>
                      ))}
                  </div>

                  {/* Administratif */}
                  {administratif.filter(a => a.periode === 'apres_midi').map((admin, idx) => (
                    <div key={idx} className="border border-orange-200 bg-orange-50 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Users className="h-4 w-4 text-orange-600" />
                        <span className="font-medium text-orange-900">Administratif ({admin.secretaires.length})</span>
                      </div>
                      <div className="text-sm text-orange-800">
                        {admin.secretaires.map(s => s.nom_complet).join(', ')}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
