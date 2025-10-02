import { AssignmentResult } from '@/types/planning';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { UserCog, Stethoscope, Edit } from 'lucide-react';
import { useState } from 'react';
import { EditPlanningCreneauDialog } from './EditPlanningCreneauDialog';

interface MILPOptimizationViewProps {
  assignments: AssignmentResult[];
  weekDays: Date[];
  specialites: { id: string; nom: string }[];
  onRefresh?: () => void;
}

interface PlanningCreneauForEdit {
  id: string;
  date: string;
  heure_debut: string;
  heure_fin: string;
  site_id?: string;
  type_assignation?: string;
  secretaires_ids?: string[];
  backups_ids?: string[];
}

export function MILPOptimizationView({ assignments, weekDays, specialites, onRefresh }: MILPOptimizationViewProps) {
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedCreneau, setSelectedCreneau] = useState<PlanningCreneauForEdit | null>(null);
  
  const handleEditClick = (assignment: AssignmentResult) => {
    // Créer un objet créneau pour l'édition
    const creneau: PlanningCreneauForEdit = {
      id: assignment.creneau_besoin_id,
      date: assignment.date,
      heure_debut: assignment.periode === 'matin' ? '07:30:00' : '13:00:00',
      heure_fin: assignment.periode === 'matin' ? '12:00:00' : '17:00:00',
      site_id: assignment.site_id,
      type_assignation: assignment.type_assignation || 'site',
      secretaires_ids: assignment.secretaires.filter(s => !s.is_backup).map(s => s.id),
      backups_ids: assignment.secretaires.filter(s => s.is_backup).map(s => s.id),
    };
    setSelectedCreneau(creneau);
    setEditDialogOpen(true);
  };

  // Filtrer les jours ouvrés (lundi à vendredi)
  const weekdaysOnly = weekDays.filter(d => {
    const dow = d.getDay();
    return dow !== 0 && dow !== 6;
  });

  // Obtenir la liste unique des spécialités qui ont des assignations
  const specialitesWithAssignments = new Set<string>();
  assignments.forEach(a => {
    if (a.site_id) {
      // Trouver les besoins pour obtenir la spécialité
      specialitesWithAssignments.add(a.site_nom);
    }
  });

  const getSpecialiteNom = (siteName: string) => {
    // Extraire la spécialité du nom du site
    const parts = siteName.split(' - ');
    return parts.length > 1 ? parts[1] : siteName;
  };

  const getSatisfactionColor = (assigned: number, required: number) => {
    if (assigned === 0 || required === 0) return 'bg-gray-200 text-gray-700';
    const percentage = (assigned / required) * 100;
    if (percentage >= 100) return 'bg-green-100 text-green-800 border-green-300';
    if (percentage >= 80) return 'bg-orange-100 text-orange-800 border-orange-300';
    return 'bg-red-100 text-red-800 border-red-300';
  };

  const getSatisfactionPercentage = (assigned: number, required: number) => {
    if (required === 0) return 0;
    return Math.round((assigned / required) * 100);
  };

  // Grouper par site/spécialité
  const groupedBySite = Array.from(specialitesWithAssignments).map(siteName => {
    const siteAssignments = assignments.filter(a => a.site_nom === siteName);
    
    // Grouper par jour et demi-journée
    const dayGroups = weekdaysOnly.map(day => {
      const dateStr = format(day, 'yyyy-MM-dd');
      const matin = siteAssignments.find(a => a.date === dateStr && a.periode === 'matin');
      const apresMidi = siteAssignments.find(a => a.date === dateStr && a.periode === 'apres_midi');
      
      return {
        date: day,
        dateStr,
        matin,
        apresMidi,
      };
    });

    return {
      siteName,
      specialite: getSpecialiteNom(siteName),
      dayGroups,
    };
  });

  // Grouper les assignations administratives
  const adminAssignments = assignments.filter(a => a.type_assignation === 'administratif');
  const adminDayGroups = weekdaysOnly.map(day => {
    const dateStr = format(day, 'yyyy-MM-dd');
    const matin = adminAssignments.find(a => a.date === dateStr && a.periode === 'matin');
    const apresMidi = adminAssignments.find(a => a.date === dateStr && a.periode === 'apres_midi');
    
    return {
      date: day,
      dateStr,
      matin,
      apresMidi,
    };
  });

  return (
    <div className="space-y-6">
      {groupedBySite.map(({ siteName, specialite, dayGroups }) => (
        <Card key={siteName}>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>{siteName}</span>
              <Badge variant="outline">{specialite}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {dayGroups.map(({ date, matin, apresMidi }) => (
                <div key={date.toISOString()} className="border rounded-lg p-4">
                  <h4 className="font-semibold mb-3 text-lg">
                    {format(date, 'EEEE d MMMM', { locale: fr })}
                  </h4>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Matin */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <h5 className="font-medium text-sm text-muted-foreground">Matin</h5>
                        <div className="flex items-center gap-2">
                          {matin && onRefresh && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEditClick(matin)}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                          )}
                          {matin && (
                            <Badge 
                              variant="outline" 
                              className={getSatisfactionColor(matin.nombre_assigne, matin.nombre_requis)}
                            >
                              {getSatisfactionPercentage(matin.nombre_assigne, matin.nombre_requis)}% 
                              ({matin.nombre_assigne}/{matin.nombre_requis})
                            </Badge>
                          )}
                        </div>
                      </div>
                      {matin && matin.medecins && matin.medecins.length > 0 && (
                        <div className="mb-2">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                            <Stethoscope className="h-3 w-3" />
                            <span>Médecins</span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {matin.medecins.map((medecin, idx) => (
                              <Badge key={idx} variant="outline" className="text-xs">
                                {medecin}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      {matin && matin.secretaires.length > 0 ? (
                        <div className="space-y-1">
                          {matin.secretaires.map((sec, idx) => (
                            <div 
                              key={idx}
                              className="flex items-center gap-2 text-sm p-2 bg-muted/50 rounded"
                            >
                              <span className="font-medium">{sec.nom}</span>
                              {sec.is_backup && (
                                <Badge variant="secondary" className="text-xs">Backup</Badge>
                              )}
                              {sec.is_1r && (
                                <Badge variant="default" className="text-xs">1R</Badge>
                              )}
                              {sec.is_2f && (
                                <Badge variant="default" className="text-xs">2F</Badge>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground italic">Aucune assignation</p>
                      )}
                    </div>

                    {/* Après-midi */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <h5 className="font-medium text-sm text-muted-foreground">Après-midi</h5>
                        <div className="flex items-center gap-2">
                          {apresMidi && onRefresh && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEditClick(apresMidi)}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                          )}
                          {apresMidi && (
                            <Badge 
                              variant="outline"
                              className={getSatisfactionColor(apresMidi.nombre_assigne, apresMidi.nombre_requis)}
                            >
                              {getSatisfactionPercentage(apresMidi.nombre_assigne, apresMidi.nombre_requis)}%
                              ({apresMidi.nombre_assigne}/{apresMidi.nombre_requis})
                            </Badge>
                          )}
                        </div>
                      </div>
                      {apresMidi && apresMidi.medecins && apresMidi.medecins.length > 0 && (
                        <div className="mb-2">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                            <Stethoscope className="h-3 w-3" />
                            <span>Médecins</span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {apresMidi.medecins.map((medecin, idx) => (
                              <Badge key={idx} variant="outline" className="text-xs">
                                {medecin}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      {apresMidi && apresMidi.secretaires.length > 0 ? (
                        <div className="space-y-1">
                          {apresMidi.secretaires.map((sec, idx) => (
                            <div 
                              key={idx}
                              className="flex items-center gap-2 text-sm p-2 bg-muted/50 rounded"
                            >
                              <span className="font-medium">{sec.nom}</span>
                              {sec.is_backup && (
                                <Badge variant="secondary" className="text-xs">Backup</Badge>
                              )}
                              {sec.is_1r && (
                                <Badge variant="default" className="text-xs">1R</Badge>
                              )}
                              {sec.is_2f && (
                                <Badge variant="default" className="text-xs">2F</Badge>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground italic">Aucune assignation</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}

      {/* Assignations Administratives */}
      {adminAssignments.length > 0 && (
        <Card className="border-primary/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserCog className="h-5 w-5" />
              <span>Assignations Administratives</span>
              <Badge variant="secondary">Non affecté à un site</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {adminDayGroups.map(({ date, matin, apresMidi }) => (
                <div key={date.toISOString()} className="border rounded-lg p-4">
                  <h4 className="font-semibold mb-3 text-lg">
                    {format(date, 'EEEE d MMMM', { locale: fr })}
                  </h4>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Matin */}
                    <div className="space-y-2">
                      <h5 className="font-medium text-sm text-muted-foreground">Matin</h5>
                      {matin && matin.medecins && matin.medecins.length > 0 && (
                        <div className="mb-2">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                            <Stethoscope className="h-3 w-3" />
                            <span>Médecins concernés</span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {matin.medecins.map((medecin, idx) => (
                              <Badge key={idx} variant="outline" className="text-xs">
                                {medecin}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      {matin && matin.secretaires.length > 0 ? (
                        <div className="space-y-1">
                          {matin.secretaires.map((sec, idx) => (
                            <div 
                              key={idx}
                              className="flex items-center gap-2 text-sm p-2 bg-muted/50 rounded"
                            >
                              <span className="font-medium">{sec.nom}</span>
                              {sec.is_backup && (
                                <Badge variant="secondary" className="text-xs">Backup</Badge>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground italic">Aucune assignation</p>
                      )}
                    </div>

                    {/* Après-midi */}
                    <div className="space-y-2">
                      <h5 className="font-medium text-sm text-muted-foreground">Après-midi</h5>
                      {apresMidi && apresMidi.medecins && apresMidi.medecins.length > 0 && (
                        <div className="mb-2">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                            <Stethoscope className="h-3 w-3" />
                            <span>Médecins concernés</span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {apresMidi.medecins.map((medecin, idx) => (
                              <Badge key={idx} variant="outline" className="text-xs">
                                {medecin}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      {apresMidi && apresMidi.secretaires.length > 0 ? (
                        <div className="space-y-1">
                          {apresMidi.secretaires.map((sec, idx) => (
                            <div 
                              key={idx}
                              className="flex items-center gap-2 text-sm p-2 bg-muted/50 rounded"
                            >
                              <span className="font-medium">{sec.nom}</span>
                              {sec.is_backup && (
                                <Badge variant="secondary" className="text-xs">Backup</Badge>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground italic">Aucune assignation</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <EditPlanningCreneauDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        creneau={selectedCreneau}
        onSuccess={() => {
          if (onRefresh) onRefresh();
        }}
      />
    </div>
  );
}
