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
  onRefresh?: () => void;
}

export function PlanningGridView({ assignments, weekDays, onRefresh }: PlanningGridViewProps) {
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
                  {/* Grille horizontale des jours */}
                  <div className="grid grid-cols-5 gap-4">
                    {dayGroups.map(({ date, dateStr, matin, apresMidi }) => (
                      <div key={dateStr} className="border rounded-lg overflow-hidden flex flex-col">
                        {/* En-tête du jour */}
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
                        
                        {/* Secrétaires du jour */}
                        <div className="space-y-3 p-3 flex-1">
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

                            if (secretariesByPeriod.size === 0) {
                              return (
                                <div className="text-xs text-muted-foreground text-center py-4">
                                  Aucune assignation
                                </div>
                              );
                            }

                            return Array.from(secretariesByPeriod.values()).map(({ matin: hasMatin, apresMidi: hasApresMidi, sec }) => {
                              const isFullDay = hasMatin && hasApresMidi;
                              const periodData = hasMatin ? sec.matinData : sec.apresMidiData;
                              
                              return (
                                <div key={sec.id} className="border rounded-lg p-2 space-y-2 bg-card hover:bg-accent/5 transition-colors">
                                  {/* Secrétaire info */}
                                  <div className="flex flex-col gap-1">
                                    <button
                                      onClick={() => setSelectedSecretary({ name: sec.nom, id: sec.id })}
                                      className="flex items-center gap-1 hover:bg-primary/10 px-1.5 py-1 rounded transition-colors text-left"
                                    >
                                      <User className="h-3 w-3 text-primary flex-shrink-0" />
                                      <span className="font-medium text-xs underline decoration-dotted line-clamp-2">{sec.nom}</span>
                                    </button>
                                    
                                    {/* Badges 1R / 2F */}
                                    {periodData.site_fermeture && (sec.is_1r || sec.is_2f) && (
                                      <div className="flex gap-1 px-1.5">
                                        {sec.is_1r && (
                                          <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-800 px-1.5 py-0">1R</Badge>
                                        )}
                                        {sec.is_2f && (
                                          <Badge variant="outline" className="text-xs px-1.5 py-0">2F</Badge>
                                        )}
                                      </div>
                                    )}
                                  </div>

                                  {/* Barre de temps visuelle */}
                                  <div className="flex gap-0.5 h-1.5">
                                    <div 
                                      className={`flex-1 rounded-l ${
                                        hasMatin 
                                          ? 'bg-primary' 
                                          : 'bg-muted'
                                      }`}
                                      title={hasMatin ? 'Matin' : ''}
                                    />
                                    <div 
                                      className={`flex-1 rounded-r ${
                                        hasApresMidi 
                                          ? 'bg-primary' 
                                          : 'bg-muted'
                                      }`}
                                      title={hasApresMidi ? 'Après-midi' : ''}
                                    />
                                  </div>

                                  {/* Horaire */}
                                  <div className="text-xs text-muted-foreground px-1.5">
                                    {isFullDay ? (
                                      <span className="font-medium">Journée</span>
                                    ) : hasMatin ? (
                                      <span className="font-medium">Matin</span>
                                    ) : (
                                      <span className="font-medium">Après-midi</span>
                                    )}
                                  </div>

                                  {/* Status badge */}
                                  <div className="px-1.5">
                                    {periodData.status === 'satisfait' && (
                                      <Badge className="bg-green-600 text-xs w-full justify-center py-0">OK</Badge>
                                    )}
                                    {periodData.status === 'arrondi_inferieur' && (
                                      <Badge className="bg-yellow-600 text-xs w-full justify-center py-0">Partiel</Badge>
                                    )}
                                    {periodData.status === 'non_satisfait' && (
                                      <Badge variant="destructive" className="text-xs w-full justify-center py-0">KO</Badge>
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
