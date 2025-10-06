import { useState } from 'react';
import { AssignmentResult } from '@/types/planning';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Building2, User, ChevronDown } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { SecretaryWeekView } from './SecretaryWeekView';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface PlanningGridViewProps {
  assignments: AssignmentResult[];
  weekDays: Date[];
}

export function PlanningGridView({ assignments, weekDays }: PlanningGridViewProps) {
  const [selectedSecretary, setSelectedSecretary] = useState<{
    name: string;
    id: string;
  } | null>(null);
  const [expandedSites, setExpandedSites] = useState<Set<string>>(new Set());

  // Grouper par site d'abord
  const sites = [...new Set(assignments.map(a => a.site_id))];
  
  const assignmentsBySite = sites.map(siteId => {
    const siteAssignments = assignments.filter(a => a.site_id === siteId);
    const siteName = siteAssignments[0]?.site_nom || 'Administratif';
    
    // Grouper par jour pour ce site (jours ouvrés uniquement)
    const weekdaysOnly = weekDays.filter(d => {
      const dow = d.getDay(); // 0=dimanche, 6=samedi
      return dow !== 0 && dow !== 6;
    });

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
    
    // Calculer les totaux pour ce site sur toute la semaine
    const totalSecretaires = siteAssignments.reduce((sum, a) => sum + (a.nombre_assigne || 0), 0);
    const totalRequis = siteAssignments.reduce((sum, a) => sum + (a.nombre_requis || 0), 0);
    
    return {
      siteId,
      siteName,
      dayGroups,
      totalSecretaires,
      totalRequis,
    };
  });

  const toggleSite = (siteId: string) => {
    setExpandedSites(prev => {
      const newSet = new Set(prev);
      if (newSet.has(siteId)) {
        newSet.delete(siteId);
      } else {
        newSet.add(siteId);
      }
      return newSet;
    });
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
      <div className="space-y-4">
        {assignmentsBySite.map(({ siteId, siteName, dayGroups, totalSecretaires, totalRequis }) => (
          <Card key={siteId}>
            <Collapsible open={expandedSites.has(siteId)} onOpenChange={() => toggleSite(siteId)}>
              <CollapsibleTrigger className="w-full">
                <CardHeader className="bg-primary/5 hover:bg-primary/10 transition-colors cursor-pointer">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <ChevronDown 
                        className={`h-5 w-5 text-primary transition-transform ${
                          expandedSites.has(siteId) ? 'rotate-180' : ''
                        }`}
                      />
                      <Building2 className="h-5 w-5 text-primary" />
                      <CardTitle className="text-lg">{siteName}</CardTitle>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground">Secrétaires semaine</div>
                        <div className="font-semibold text-sm">
                          {totalSecretaires} / {totalRequis}
                        </div>
                      </div>
                    </div>
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              
              <CollapsibleContent>
                <CardContent className="pt-6">
                  <div className="space-y-6">
                    {dayGroups.map(({ date, dateStr, matin, apresMidi }) => (
                      <div key={dateStr} className="border rounded-lg overflow-hidden">
                        <div className="bg-muted/30 px-4 py-2">
                          <div className="font-medium text-sm">
                            {format(date, 'EEEE d MMMM yyyy', { locale: fr })}
                          </div>
                        </div>
                        
                        <div className="space-y-4 p-4">
                          {(() => {
                            // Déterminer les secrétaires uniques avec leurs périodes
                            const secretariesByPeriod = new Map<string, { matin: boolean; apresMidi: boolean; sec: any }>();
                            
                            if (matin) {
                              matin.secretaires.forEach(sec => {
                                secretariesByPeriod.set(sec.id, { 
                                  matin: true, 
                                  apresMidi: false,
                                  sec: { ...sec, matinData: matin }
                                });
                              });
                            }
                            
                            if (apresMidi) {
                              apresMidi.secretaires.forEach(sec => {
                                const existing = secretariesByPeriod.get(sec.id);
                                if (existing) {
                                  existing.apresMidi = true;
                                  existing.sec.apresMidiData = apresMidi;
                                } else {
                                  secretariesByPeriod.set(sec.id, { 
                                    matin: false, 
                                    apresMidi: true,
                                    sec: { ...sec, apresMidiData: apresMidi }
                                  });
                                }
                              });
                            }

                            return Array.from(secretariesByPeriod.values()).map(({ matin: hasMatin, apresMidi: hasApresMidi, sec }) => {
                              const isFullDay = hasMatin && hasApresMidi;
                              const periodData = hasMatin ? sec.matinData : sec.apresMidiData;
                              
                              return (
                                <div key={sec.id} className="border rounded-lg p-3 space-y-2">
                                  {/* Secrétaire info */}
                                  <div className="flex items-center justify-between">
                                    <button
                                      onClick={() => setSelectedSecretary({ name: sec.nom, id: sec.id })}
                                      className="flex items-center gap-2 hover:bg-primary/10 px-2 py-1 rounded transition-colors"
                                    >
                                      <User className="h-4 w-4 text-primary" />
                                      <span className="font-medium underline decoration-dotted">{sec.nom}</span>
                                      {periodData.site_fermeture && sec.is_1r && (
                                        <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-800">1R</Badge>
                                      )}
                                      {periodData.site_fermeture && sec.is_2f && (
                                        <Badge variant="outline" className="text-xs">2F</Badge>
                                      )}
                                    </button>
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs text-muted-foreground">
                                        {periodData.nombre_assigne} / {periodData.nombre_requis}
                                      </span>
                                      {periodData.status === 'satisfait' && (
                                        <Badge className="bg-green-600 text-xs">Satisfait</Badge>
                                      )}
                                      {periodData.status === 'arrondi_inferieur' && (
                                        <Badge className="bg-yellow-600 text-xs">Partiel</Badge>
                                      )}
                                      {periodData.status === 'non_satisfait' && (
                                        <Badge variant="destructive" className="text-xs">Non satisfait</Badge>
                                      )}
                                    </div>
                                  </div>

                                  {/* Barre de temps visuelle */}
                                  <div className="flex gap-1 h-2">
                                    {/* Matin */}
                                    <div 
                                      className={`flex-1 rounded-l ${
                                        hasMatin 
                                          ? 'bg-primary' 
                                          : 'bg-muted'
                                      }`}
                                      title={hasMatin ? '07:30-12:00' : 'Non assigné'}
                                    />
                                    {/* Après-midi */}
                                    <div 
                                      className={`flex-1 rounded-r ${
                                        hasApresMidi 
                                          ? 'bg-primary' 
                                          : 'bg-muted'
                                      }`}
                                      title={hasApresMidi ? '13:00-17:00' : 'Non assigné'}
                                    />
                                  </div>

                                  {/* Horaire et médecins */}
                                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <div className="flex items-center gap-1">
                                      {isFullDay ? (
                                        <span className="font-medium">07:30 - 17:00</span>
                                      ) : hasMatin ? (
                                        <span className="font-medium">07:30 - 12:00 (Matin)</span>
                                      ) : (
                                        <span className="font-medium">13:00 - 17:00 (Après-midi)</span>
                                      )}
                                    </div>
                                    {periodData.medecins && periodData.medecins.length > 0 && (
                                      <>
                                        <span>•</span>
                                        <span className="line-clamp-1">{periodData.medecins.join(', ')}</span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              );
                            });
                          })()}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
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
