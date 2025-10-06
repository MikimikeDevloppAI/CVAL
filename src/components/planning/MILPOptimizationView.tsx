import { AssignmentResult } from '@/types/planning';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
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
  type?: string;
  medecins_ids?: string[];
  responsable_1r_id?: string;
  responsable_2f_id?: string;
  statut?: string;
  version_planning?: number;
}

export function MILPOptimizationView({ assignments, weekDays, specialites, onRefresh }: MILPOptimizationViewProps) {
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedCreneau, setSelectedCreneau] = useState<PlanningCreneauForEdit | null>(null);
  
  const handleEditClick = async (assignment: AssignmentResult) => {
    // Récupérer le vrai créneau depuis la base de données
    const { supabase } = await import('@/integrations/supabase/client');
    const { data, error } = await supabase
      .from('planning_genere')
      .select('*')
      .eq('date', assignment.date)
      .eq('heure_debut', assignment.periode === 'matin' ? '07:30:00' : '13:00:00')
      .eq('site_id', assignment.site_id)
      .maybeSingle();

    if (error || !data) {
      console.error('Erreur lors de la récupération du créneau:', error);
      return;
    }

    const creneau: PlanningCreneauForEdit = {
      id: data.id,
      date: data.date,
      heure_debut: data.heure_debut,
      heure_fin: data.heure_fin,
      site_id: data.site_id,
      type_assignation: data.type_assignation || 'site',
      secretaires_ids: data.secretaires_ids || [],
      backups_ids: data.backups_ids || [],
      type: data.type,
      medecins_ids: data.medecins_ids,
      responsable_1r_id: data.responsable_1r_id,
      responsable_2f_id: data.responsable_2f_id,
      statut: data.statut,
      version_planning: data.version_planning,
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
      <div className="space-y-4">
        {groupedBySite.map(({ siteName, specialite, dayGroups }) => (
          <Card key={siteName} className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between text-lg">
                <span className="truncate">{siteName}</span>
                <Badge variant="outline" className="ml-2 flex-shrink-0">{specialite}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-5 gap-4">
                {dayGroups.map(({ date, matin, apresMidi }) => {
                  // Déterminer si on peut fusionner matin et après-midi
                  const canMerge = matin && apresMidi && 
                    JSON.stringify(matin.secretaires.map(s => s.id).sort()) === 
                    JSON.stringify(apresMidi.secretaires.map(s => s.id).sort());

                  // Calculer les pourcentages matin et après-midi
                  const percentMatin = matin ? getSatisfactionPercentage(matin.nombre_assigne, matin.nombre_requis) : 0;
                  const percentAM = apresMidi ? getSatisfactionPercentage(apresMidi.nombre_assigne, apresMidi.nombre_requis) : 0;
                  const sameSatisfaction = percentMatin === percentAM;

                  // Regrouper les médecins matin/après-midi
                  const medecinsMatinSet = new Set(matin?.medecins || []);
                  const medecinsAMSet = new Set(apresMidi?.medecins || []);
                  const medecinsBoth = [...medecinsMatinSet].filter(m => medecinsAMSet.has(m));
                  const medecinsMatinOnly = [...medecinsMatinSet].filter(m => !medecinsAMSet.has(m));
                  const medecinsAMOnly = [...medecinsAMSet].filter(m => !medecinsMatinSet.has(m));

                  if (canMerge) {
                    // Affichage fusionné (journée complète)
                    return (
                      <div key={date.toISOString()} className="border rounded-lg overflow-hidden flex flex-col">
                        <div className="bg-muted/30 px-3 py-2 text-center border-b">
                          <div className="font-medium text-xs">
                            {format(date, 'EEE', { locale: fr })}
                          </div>
                          <div className="text-lg font-semibold">
                            {format(date, 'd', { locale: fr })}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {format(date, 'MMM', { locale: fr })}
                          </div>
                        </div>
                        
                        <div className="p-3 space-y-3 flex-1">
                          {/* Secrétaires */}
                          {matin!.secretaires.map((sec, idx) => (
                            <div key={idx} className="border rounded-lg p-2 space-y-2 bg-card hover:bg-accent/5 transition-colors">
                              <div className="flex flex-col gap-1">
                                <div className="flex items-center gap-1">
                                  <span className="font-medium text-xs line-clamp-2">{sec.nom}</span>
                                  {onRefresh && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-5 w-5 p-0 ml-auto flex-shrink-0"
                                      onClick={() => handleEditClick(matin!)}
                                    >
                                      <Edit className="h-3 w-3" />
                                    </Button>
                                  )}
                                </div>
                                
                                {(sec.is_1r || sec.is_2f || sec.is_backup) && (
                                  <div className="flex gap-1">
                                    {sec.is_backup && (
                                      <Badge variant="secondary" className="text-xs px-1.5 py-0">Backup</Badge>
                                    )}
                                    {sec.is_1r && (
                                      <Badge className="text-xs px-1.5 py-0 bg-blue-100 text-blue-800">1R</Badge>
                                    )}
                                    {sec.is_2f && (
                                      <Badge variant="outline" className="text-xs px-1.5 py-0">2F</Badge>
                                    )}
                                  </div>
                                )}
                              </div>

                              <div className="flex gap-0.5 h-1.5">
                                <div className="flex-1 rounded-l bg-primary" title="Matin" />
                                <div className="flex-1 rounded-r bg-primary" title="Après-midi" />
                              </div>

                              <div className="text-xs text-muted-foreground">
                                <span className="font-medium">Journée</span>
                              </div>

                              {sameSatisfaction ? (
                                <Badge 
                                  variant="outline" 
                                  className={`text-xs w-full justify-center py-0 ${getSatisfactionColor(matin!.nombre_assigne, matin!.nombre_requis)}`}
                                >
                                  {percentMatin}%
                                </Badge>
                              ) : (
                                <div className="flex gap-1">
                                  <Badge 
                                    variant="outline" 
                                    className={`text-xs flex-1 justify-center py-0 ${getSatisfactionColor(matin!.nombre_assigne, matin!.nombre_requis)}`}
                                  >
                                    M:{percentMatin}%
                                  </Badge>
                                  <Badge 
                                    variant="outline" 
                                    className={`text-xs flex-1 justify-center py-0 ${getSatisfactionColor(apresMidi!.nombre_assigne, apresMidi!.nombre_requis)}`}
                                  >
                                    AM:{percentAM}%
                                  </Badge>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  }

                  // Affichage séparé (matin et/ou après-midi seulement)
                  return (
                    <div key={date.toISOString()} className="border rounded-lg overflow-hidden flex flex-col">
                      <div className="bg-muted/30 px-3 py-2 text-center border-b">
                        <div className="font-medium text-xs">
                          {format(date, 'EEE', { locale: fr })}
                        </div>
                        <div className="text-lg font-semibold">
                          {format(date, 'd', { locale: fr })}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {format(date, 'MMM', { locale: fr })}
                        </div>
                      </div>
                      
                      <div className="p-3 space-y-3 flex-1">
                        {(() => {
                          const allSecretaires = new Map();
                          
                          if (matin) {
                            matin.secretaires.forEach(sec => {
                              if (!allSecretaires.has(sec.id)) {
                                allSecretaires.set(sec.id, { ...sec, periods: ['matin'] });
                              } else {
                                allSecretaires.get(sec.id).periods.push('matin');
                              }
                            });
                          }
                          
                          if (apresMidi) {
                            apresMidi.secretaires.forEach(sec => {
                              if (!allSecretaires.has(sec.id)) {
                                allSecretaires.set(sec.id, { ...sec, periods: ['apresMidi'] });
                              } else {
                                allSecretaires.get(sec.id).periods.push('apresMidi');
                              }
                            });
                          }

                          if (allSecretaires.size === 0) {
                            return (
                              <div className="text-xs text-muted-foreground text-center py-4">
                                Aucune assignation
                              </div>
                            );
                          }

                          return Array.from(allSecretaires.values()).map((sec, idx) => {
                            const hasMatin = sec.periods.includes('matin');
                            const hasApresMidi = sec.periods.includes('apresMidi');
                            const isFullDay = hasMatin && hasApresMidi;
                            const assignment = hasMatin ? matin : apresMidi;
                            
                            return (
                              <div key={idx} className="border rounded-lg p-2 space-y-2 bg-card hover:bg-accent/5 transition-colors">
                                <div className="flex flex-col gap-1">
                                  <div className="flex items-center gap-1">
                                    <span className="font-medium text-xs line-clamp-2">{sec.nom}</span>
                                    {assignment && onRefresh && (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-5 w-5 p-0 ml-auto flex-shrink-0"
                                        onClick={() => handleEditClick(assignment)}
                                      >
                                        <Edit className="h-3 w-3" />
                                      </Button>
                                    )}
                                  </div>
                                  
                                  {(sec.is_1r || sec.is_2f || sec.is_backup) && (
                                    <div className="flex gap-1">
                                      {sec.is_backup && (
                                        <Badge variant="secondary" className="text-xs px-1.5 py-0">Backup</Badge>
                                      )}
                                      {sec.is_1r && (
                                        <Badge className="text-xs px-1.5 py-0 bg-blue-100 text-blue-800">1R</Badge>
                                      )}
                                      {sec.is_2f && (
                                        <Badge variant="outline" className="text-xs px-1.5 py-0">2F</Badge>
                                      )}
                                    </div>
                                  )}
                                </div>

                                <div className="flex gap-0.5 h-1.5">
                                  <div 
                                    className={`flex-1 rounded-l ${hasMatin ? 'bg-primary' : 'bg-muted'}`}
                                    title={hasMatin ? 'Matin' : ''}
                                  />
                                  <div 
                                    className={`flex-1 rounded-r ${hasApresMidi ? 'bg-primary' : 'bg-muted'}`}
                                    title={hasApresMidi ? 'Après-midi' : ''}
                                  />
                                </div>

                                <div className="text-xs text-muted-foreground">
                                  {isFullDay ? (
                                    <span className="font-medium">Journée</span>
                                  ) : hasMatin ? (
                                    <span className="font-medium">Matin</span>
                                  ) : (
                                    <span className="font-medium">AM</span>
                                  )}
                                </div>

                                {matin && apresMidi ? (
                                  sameSatisfaction ? (
                                    <Badge 
                                      variant="outline" 
                                      className={`text-xs w-full justify-center py-0 ${getSatisfactionColor(matin.nombre_assigne, matin.nombre_requis)}`}
                                    >
                                      {percentMatin}%
                                    </Badge>
                                  ) : (
                                    <div className="flex gap-1">
                                      <Badge 
                                        variant="outline" 
                                        className={`text-xs flex-1 justify-center py-0 ${getSatisfactionColor(matin.nombre_assigne, matin.nombre_requis)}`}
                                      >
                                        M:{percentMatin}%
                                      </Badge>
                                      <Badge 
                                        variant="outline" 
                                        className={`text-xs flex-1 justify-center py-0 ${getSatisfactionColor(apresMidi.nombre_assigne, apresMidi.nombre_requis)}`}
                                      >
                                        AM:{percentAM}%
                                      </Badge>
                                    </div>
                                  )
                                ) : matin ? (
                                  <Badge 
                                    variant="outline" 
                                    className={`text-xs w-full justify-center py-0 ${getSatisfactionColor(matin.nombre_assigne, matin.nombre_requis)}`}
                                  >
                                    {percentMatin}%
                                  </Badge>
                                ) : apresMidi ? (
                                  <Badge 
                                    variant="outline" 
                                    className={`text-xs w-full justify-center py-0 ${getSatisfactionColor(apresMidi.nombre_assigne, apresMidi.nombre_requis)}`}
                                  >
                                    {percentAM}%
                                  </Badge>
                                ) : null}
                              </div>
                            );
                          });
                        })()}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

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
              {adminDayGroups.map(({ date, matin, apresMidi }) => {
                // Déterminer si on peut fusionner matin et après-midi
                const canMerge = matin && apresMidi && 
                  JSON.stringify(matin.secretaires.map(s => s.id).sort()) === 
                  JSON.stringify(apresMidi.secretaires.map(s => s.id).sort());

                if (canMerge) {
                  // Affichage fusionné (journée complète)
                  return (
                    <div key={date.toISOString()} className="border rounded-lg p-4">
                      <h4 className="font-semibold mb-3 text-lg">
                        {format(date, 'EEEE d MMMM', { locale: fr })}
                      </h4>
                      
                      <div className="space-y-3">
                        {matin!.secretaires.map((sec, idx) => (
                          <div key={idx} className="space-y-2">
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <span className="font-medium truncate">{sec.nom}</span>
                                <div className="flex items-center gap-1 flex-shrink-0">
                                  {sec.is_backup && (
                                    <Badge variant="secondary" className="text-xs">Backup</Badge>
                                  )}
                                </div>
                              </div>
                              <span className="text-sm text-muted-foreground whitespace-nowrap">07:30-17:00</span>
                            </div>
                            
                            <div className="relative h-2 bg-muted rounded-full overflow-hidden">
                              <div className="absolute inset-0 bg-primary" />
                            </div>

                            {/* Médecins */}
                            {(matin!.medecins && matin!.medecins.length > 0) || (apresMidi!.medecins && apresMidi!.medecins.length > 0) ? (
                              <div className="space-y-2">
                                {matin!.medecins && matin!.medecins.length > 0 && (
                                  <div>
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                                      <Stethoscope className="h-3 w-3" />
                                      <span>Médecins matin</span>
                                    </div>
                                    <div className="flex flex-wrap gap-1">
                                      {matin!.medecins.map((medecin, idx) => (
                                        <Badge key={idx} variant="outline" className="text-xs">
                                          {medecin}
                                        </Badge>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {apresMidi!.medecins && apresMidi!.medecins.length > 0 && (
                                  <div>
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                                      <Stethoscope className="h-3 w-3" />
                                      <span>Médecins après-midi</span>
                                    </div>
                                    <div className="flex flex-wrap gap-1">
                                      {apresMidi!.medecins.map((medecin, idx) => (
                                        <Badge key={idx} variant="outline" className="text-xs">
                                          {medecin}
                                        </Badge>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                }

                // Affichage séparé (matin et/ou après-midi seulement)
                return (
                  <div key={date.toISOString()} className="border rounded-lg p-4">
                    <h4 className="font-semibold mb-3 text-lg">
                      {format(date, 'EEEE d MMMM', { locale: fr })}
                    </h4>
                    
                    <div className="space-y-3">
                      {/* Grouper toutes les secrétaires uniques */}
                      {(() => {
                        const allSecretaires = new Map();
                        
                        if (matin) {
                          matin.secretaires.forEach(sec => {
                            if (!allSecretaires.has(sec.id)) {
                              allSecretaires.set(sec.id, { ...sec, periods: ['matin'] });
                            } else {
                              allSecretaires.get(sec.id).periods.push('matin');
                            }
                          });
                        }
                        
                        if (apresMidi) {
                          apresMidi.secretaires.forEach(sec => {
                            if (!allSecretaires.has(sec.id)) {
                              allSecretaires.set(sec.id, { ...sec, periods: ['apresMidi'] });
                            } else {
                              allSecretaires.get(sec.id).periods.push('apresMidi');
                            }
                          });
                        }

                        return Array.from(allSecretaires.values()).map((sec, idx) => {
                          const hasMatin = sec.periods.includes('matin');
                          const hasApresMidi = sec.periods.includes('apresMidi');
                          const timeDisplay = hasMatin && hasApresMidi ? '07:30-17:00' : 
                                             hasMatin ? '07:30-12:00' : '13:00-17:00';
                          
                          return (
                            <div key={idx} className="space-y-2">
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                  <span className="font-medium truncate">{sec.nom}</span>
                                  <div className="flex items-center gap-1 flex-shrink-0">
                                    {sec.is_backup && (
                                      <Badge variant="secondary" className="text-xs">Backup</Badge>
                                    )}
                                  </div>
                                </div>
                                <span className="text-sm text-muted-foreground whitespace-nowrap">{timeDisplay}</span>
                              </div>
                              
                              <div className="relative h-2 bg-muted rounded-full overflow-hidden">
                                <div className="flex h-full">
                                  <div className={`flex-1 ${hasMatin ? 'bg-primary' : 'bg-transparent'}`} />
                                  <div className={`flex-1 ${hasApresMidi ? 'bg-primary' : 'bg-transparent'}`} />
                                </div>
                              </div>

                              {/* Médecins */}
                              <div className="space-y-2">
                                {matin && hasMatin && matin.medecins && matin.medecins.length > 0 && (
                                  <div>
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                                      <Stethoscope className="h-3 w-3" />
                                      <span>Médecins matin</span>
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
                                {apresMidi && hasApresMidi && apresMidi.medecins && apresMidi.medecins.length > 0 && (
                                  <div>
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                                      <Stethoscope className="h-3 w-3" />
                                      <span>Médecins après-midi</span>
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
                              </div>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>
                );
              })}
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
