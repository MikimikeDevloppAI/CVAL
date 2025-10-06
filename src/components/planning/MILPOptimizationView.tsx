import { AssignmentResult } from '@/types/planning';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { UserCog, Stethoscope, Edit } from 'lucide-react';
import { useState } from 'react';
import { EditSecretaryAssignmentDialog } from './EditSecretaryAssignmentDialog';
import { UnsatisfiedNeedsReport } from './UnsatisfiedNeedsReport';

interface MILPOptimizationViewProps {
  assignments: AssignmentResult[];
  weekDays: Date[];
  specialites: { id: string; nom: string }[];
  onRefresh?: () => void;
}

interface SecretaryForEdit {
  id: string;
  nom: string;
  date: string;
  periode: 'matin' | 'apres_midi';
  site_id?: string;
  site_nom?: string;
}

export function MILPOptimizationView({ assignments, weekDays, specialites, onRefresh }: MILPOptimizationViewProps) {
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedSecretary, setSelectedSecretary] = useState<SecretaryForEdit | null>(null);
  
  const handleEditClick = (secretary: any, assignment: AssignmentResult) => {
    setSelectedSecretary({
      id: secretary.id,
      nom: secretary.nom,
      date: assignment.date,
      periode: assignment.periode,
      site_id: assignment.site_id,
      site_nom: assignment.site_nom,
    });
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
      {/* Rapport des besoins non satisfaits */}
      <UnsatisfiedNeedsReport 
        assignments={assignments}
        weekDays={weekDays}
        onRefresh={onRefresh}
      />
      
      <div className="space-y-4">{groupedBySite.map(({ siteName, specialite, dayGroups }) => (
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
                        <div className="bg-muted/30 px-3 py-2 border-b space-y-2">
                          <div className="text-center">
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
                          
                          {/* Pourcentages */}
                          <div className="flex gap-1 justify-center">
                            {sameSatisfaction ? (
                              <Badge 
                                variant="outline" 
                                className={`text-xs ${getSatisfactionColor(matin!.nombre_assigne, matin!.nombre_requis)}`}
                              >
                                {percentMatin}%
                              </Badge>
                            ) : (
                              <>
                                <Badge 
                                  variant="outline" 
                                  className={`text-xs ${getSatisfactionColor(matin!.nombre_assigne, matin!.nombre_requis)}`}
                                >
                                  Matin:{percentMatin}%
                                </Badge>
                                <Badge 
                                  variant="outline" 
                                  className={`text-xs ${getSatisfactionColor(apresMidi!.nombre_assigne, apresMidi!.nombre_requis)}`}
                                >
                                  Après-midi:{percentAM}%
                                </Badge>
                              </>
                            )}
                          </div>

                          {/* Médecins */}
                          {(medecinsBoth.length > 0 || medecinsMatinOnly.length > 0 || medecinsAMOnly.length > 0) && (
                            <div className="space-y-1">
                              <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground">
                                <Stethoscope className="h-3 w-3" />
                                <span>Médecins</span>
                              </div>
                              <div className="flex flex-wrap gap-1 justify-center">
                                {medecinsBoth.map((medecin, idx) => (
                                  <Badge key={idx} variant="outline" className="text-[10px] px-1.5 py-0">
                                    {medecin}
                                  </Badge>
                                ))}
                                {medecinsMatinOnly.map((medecin, idx) => (
                                  <Badge key={idx} variant="outline" className="text-[10px] px-1.5 py-0">
                                    {medecin} <span className="ml-0.5 text-muted-foreground">(Matin)</span>
                                  </Badge>
                                ))}
                                {medecinsAMOnly.map((medecin, idx) => (
                                  <Badge key={idx} variant="outline" className="text-[10px] px-1.5 py-0">
                                    {medecin} <span className="ml-0.5 text-muted-foreground">(Après-midi)</span>
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                        
                        <div className="p-3 space-y-3 flex-1">
                          {/* Secrétaires */}
                          {matin!.secretaires.map((sec, idx) => (
                            <div key={idx} className="border rounded-lg p-2 space-y-2 bg-card hover:bg-accent/5 transition-colors">
                              <div className="flex items-center gap-1">
                                <span className="font-medium text-xs line-clamp-2">{sec.nom}</span>
                                  {onRefresh && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-5 w-5 p-0 ml-auto flex-shrink-0"
                                      onClick={() => handleEditClick(sec, matin!)}
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

                              <div className="flex gap-0.5 h-1.5">
                                <div className="flex-1 rounded-l bg-primary" title="Matin" />
                                <div className="flex-1 rounded-r bg-primary" title="Après-midi" />
                              </div>

                              <div className="text-xs text-muted-foreground text-center">
                                <span className="font-medium">Journée</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  }

                  // Affichage séparé (matin et/ou après-midi seulement)
                  return (
                    <div key={date.toISOString()} className="border rounded-lg overflow-hidden flex flex-col">
                      <div className="bg-muted/30 px-3 py-2 border-b space-y-2">
                        <div className="text-center">
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
                        
                        {/* Pourcentages */}
                        <div className="flex gap-1 justify-center">
                          {matin && apresMidi ? (
                            sameSatisfaction ? (
                              <Badge 
                                variant="outline" 
                                className={`text-xs ${getSatisfactionColor(matin.nombre_assigne, matin.nombre_requis)}`}
                              >
                                {percentMatin}%
                              </Badge>
                            ) : (
                              <>
                                <Badge 
                                  variant="outline" 
                                  className={`text-xs ${getSatisfactionColor(matin.nombre_assigne, matin.nombre_requis)}`}
                                >
                                  Matin:{percentMatin}%
                                </Badge>
                                <Badge 
                                  variant="outline" 
                                  className={`text-xs ${getSatisfactionColor(apresMidi.nombre_assigne, apresMidi.nombre_requis)}`}
                                >
                                  Après-midi:{percentAM}%
                                </Badge>
                              </>
                            )
                          ) : matin ? (
                            <Badge 
                              variant="outline" 
                              className={`text-xs ${getSatisfactionColor(matin.nombre_assigne, matin.nombre_requis)}`}
                            >
                              Matin:{percentMatin}%
                            </Badge>
                          ) : apresMidi ? (
                            <Badge 
                              variant="outline" 
                              className={`text-xs ${getSatisfactionColor(apresMidi.nombre_assigne, apresMidi.nombre_requis)}`}
                            >
                              Après-midi:{percentAM}%
                            </Badge>
                          ) : null}
                        </div>

                        {/* Médecins */}
                        {(medecinsBoth.length > 0 || medecinsMatinOnly.length > 0 || medecinsAMOnly.length > 0) && (
                          <div className="space-y-1">
                              <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground">
                                <Stethoscope className="h-3 w-3" />
                                <span>Médecins</span>
                              </div>
                              <div className="flex flex-wrap gap-1 justify-center">
                                {medecinsBoth.map((medecin, idx) => (
                                  <Badge key={idx} variant="outline" className="text-[10px] px-1.5 py-0">
                                    {medecin}
                                  </Badge>
                                ))}
                                {medecinsMatinOnly.map((medecin, idx) => (
                                  <Badge key={idx} variant="outline" className="text-[10px] px-1.5 py-0">
                                    {medecin} <span className="ml-0.5 text-muted-foreground">(Matin)</span>
                                  </Badge>
                                ))}
                                {medecinsAMOnly.map((medecin, idx) => (
                                  <Badge key={idx} variant="outline" className="text-[10px] px-1.5 py-0">
                                    {medecin} <span className="ml-0.5 text-muted-foreground">(Après-midi)</span>
                                  </Badge>
                                ))}
                              </div>
                          </div>
                        )}
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
                                <div className="flex items-center gap-1">
                                  <span className="font-medium text-xs line-clamp-2">{sec.nom}</span>
                                    {assignment && onRefresh && (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-5 w-5 p-0 ml-auto flex-shrink-0"
                                        onClick={() => handleEditClick(sec, assignment)}
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

                                <div className="text-xs text-muted-foreground text-center">
                                  {isFullDay ? (
                                    <span className="font-medium">Journée</span>
                                  ) : hasMatin ? (
                                    <span className="font-medium">Matin</span>
                                  ) : (
                                    <span className="font-medium">Après-midi</span>
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
        ))}
      </div>

      {/* Assignations Administratives */}
      {adminAssignments.length > 0 && adminAssignments.some(a => a.secretaires && a.secretaires.length > 0) && (
        <Card className="border-primary/20">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <UserCog className="h-5 w-5" />
              <span>Assignations Administratives</span>
              <Badge variant="secondary">Non affecté à un site</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-5 gap-4">
              {adminDayGroups.map(({ date, matin, apresMidi }) => {
                const canMerge = matin && apresMidi && 
                  JSON.stringify(matin.secretaires.map(s => s.id).sort()) === 
                  JSON.stringify(apresMidi.secretaires.map(s => s.id).sort());

                if (canMerge) {
                  return (
                    <div key={date.toISOString()} className="border rounded-lg overflow-hidden flex flex-col">
                      <div className="bg-muted/30 px-3 py-2 border-b">
                        <div className="text-center">
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
                      </div>
                      
                      <div className="p-3 space-y-3 flex-1">
                        {matin!.secretaires.map((sec, idx) => (
                          <div key={idx} className="border rounded-lg p-2 space-y-2 bg-card hover:bg-accent/5 transition-colors">
                            <div className="flex items-center gap-1">
                              <span className="font-medium text-xs line-clamp-2">{sec.nom}</span>
                              {onRefresh && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-5 w-5 p-0 ml-auto flex-shrink-0"
                                  onClick={() => handleEditClick(sec, matin!)}
                                >
                                  <Edit className="h-3 w-3" />
                                </Button>
                              )}
                            </div>
                            
                            {sec.is_backup && (
                              <Badge variant="secondary" className="text-xs px-1.5 py-0">Backup</Badge>
                            )}

                            <div className="flex gap-0.5 h-1.5">
                              <div className="flex-1 rounded-l bg-primary" />
                              <div className="flex-1 rounded-r bg-primary" />
                            </div>

                            <div className="text-xs text-muted-foreground text-center">
                              <span className="font-medium">Journée</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={date.toISOString()} className="border rounded-lg overflow-hidden flex flex-col">
                    <div className="bg-muted/30 px-3 py-2 border-b">
                      <div className="text-center">
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
                              <div className="flex items-center gap-1">
                                <span className="font-medium text-xs line-clamp-2">{sec.nom}</span>
                                {assignment && onRefresh && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-5 w-5 p-0 ml-auto flex-shrink-0"
                                    onClick={() => handleEditClick(sec, assignment)}
                                  >
                                    <Edit className="h-3 w-3" />
                                  </Button>
                                )}
                              </div>
                              
                              {sec.is_backup && (
                                <Badge variant="secondary" className="text-xs px-1.5 py-0">Backup</Badge>
                              )}

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

                              <div className="text-xs text-muted-foreground text-center">
                                {isFullDay ? (
                                  <span className="font-medium">Journée</span>
                                ) : hasMatin ? (
                                  <span className="font-medium">Matin</span>
                                ) : (
                                  <span className="font-medium">Après-midi</span>
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

      {selectedSecretary && (
        <EditSecretaryAssignmentDialog
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          secretaryId={selectedSecretary.id}
          date={selectedSecretary.date}
          period={selectedSecretary.periode}
          siteId={selectedSecretary.site_id}
          onSuccess={() => {
            if (onRefresh) onRefresh();
            setSelectedSecretary(null);
          }}
        />
      )}
    </div>
  );
}
