import { Card } from "@/components/ui/card";
import { OptimizationScoreParSpecialite } from "@/types/baseSchedule";
import { CheckCircle2, Circle, AlertCircle } from "lucide-react";

interface OptimizationScoreCardsProps {
  scores: OptimizationScoreParSpecialite[];
}

function countOptimizedSlots(score: OptimizationScoreParSpecialite): number {
  let count = 0;
  score.details_jours.forEach(jour => {
    // Consider a slot optimized if capacity meets or exceeds needs
    if (jour.matin.capacites >= jour.matin.besoins) count++;
    if (jour.apres_midi.capacites >= jour.apres_midi.besoins) count++;
  });
  return count;
}

function getSlotStatusColor(besoins: number, capacites: number): string {
  const ceilBesoins = Math.ceil(besoins);
  const floorBesoins = Math.floor(besoins);
  
  if (capacites >= ceilBesoins) return "text-green-500";
  if (capacites >= floorBesoins) return "text-yellow-500";
  return "text-red-500";
}

function calculateMissingCapacities(scores: OptimizationScoreParSpecialite[]) {
  const missingBySpecialty = new Map<string, { 
    details: Array<{ 
      jour_semaine: number, 
      jour_nom: string, 
      matin: number, 
      apres_midi: number 
    }> 
  }>();
  
  const JOURS_NOMS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];
  
  scores.forEach(score => {
    const details: Array<{ jour_semaine: number, jour_nom: string, matin: number, apres_midi: number }> = [];
    let hasMissing = false;
    
    score.details_jours.forEach(jour => {
      const matinNeeded = Math.ceil(jour.matin.besoins);
      const matinMissing = Math.max(0, matinNeeded - jour.matin.capacites);
      
      const apremNeeded = Math.ceil(jour.apres_midi.besoins);
      const apremMissing = Math.max(0, apremNeeded - jour.apres_midi.capacites);
      
      if (matinMissing > 0 || apremMissing > 0) {
        hasMissing = true;
      }
      
      details.push({
        jour_semaine: jour.jour_semaine,
        jour_nom: JOURS_NOMS[jour.jour_semaine - 1],
        matin: matinMissing,
        apres_midi: apremMissing
      });
    });
    
    if (hasMissing) {
      missingBySpecialty.set(score.specialite_nom, { details });
    }
  });
  
  return missingBySpecialty;
}

export function OptimizationScoreCards({ scores }: OptimizationScoreCardsProps) {
  if (scores.length === 0) return null;

  const missingCapacities = calculateMissingCapacities(scores);
  const hasMissing = missingCapacities.size > 0;

  return (
    <div className="space-y-4 mb-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Optimisation des horaires de base</h3>
        <p className="text-sm text-muted-foreground">
          Demi-journées optimisées (capacités ≥ besoins)
        </p>
      </div>

      {hasMissing && (
        <Card className="p-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-primary" />
              <h4 className="font-semibold">
                Capacités manquantes pour optimisation complète
              </h4>
            </div>
            
            <div className="space-y-4">
              {Array.from(missingCapacities.entries()).map(([specialite, data]) => (
                <div key={specialite}>
                  <div className="font-medium mb-2">{specialite}</div>
                  
                  <div className="space-y-2">
                    <div className="grid grid-cols-[auto_1fr_1fr] gap-2 text-xs font-medium text-muted-foreground">
                      <div className="w-16">Jour</div>
                      <div className="flex justify-center">Matin</div>
                      <div className="flex justify-center">Après-midi</div>
                    </div>

                    {data.details.map((jour) => (
                      <div key={jour.jour_semaine} className="grid grid-cols-[auto_1fr_1fr] gap-2 text-xs items-center">
                        <div className="font-medium w-16">{jour.jour_nom}</div>
                        
                        <div className="flex items-center justify-center">
                          {jour.matin > 0 ? (
                            <span className="text-red-600 dark:text-red-400 font-medium">
                              -{jour.matin}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </div>

                        <div className="flex items-center justify-center">
                          {jour.apres_midi > 0 ? (
                            <span className="text-red-600 dark:text-red-400 font-medium">
                              -{jour.apres_midi}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {scores.map((score) => {
          const optimizedCount = countOptimizedSlots(score);
          return (
            <Card key={score.specialite_id} className="p-4">
              <div className="space-y-3">
                {/* Header */}
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold">{score.specialite_nom}</h4>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-primary" />
                    <div className="text-right">
                      <div className="text-2xl font-bold text-primary">
                        {optimizedCount}/10
                      </div>
                      <div className="text-xs text-muted-foreground">
                        demi-journées
                      </div>
                    </div>
                  </div>
                </div>

                {/* Details by day */}
                <div className="space-y-2">
                <div className="grid grid-cols-[auto_1fr_1fr] gap-2 text-xs font-medium text-muted-foreground">
                  <div className="w-16">Jour</div>
                  <div className="flex justify-center">Matin</div>
                  <div className="flex justify-center">Après-midi</div>
                </div>

                {score.details_jours.map((jour) => (
                  <div key={jour.jour_semaine} className="grid grid-cols-[auto_1fr_1fr] gap-2 text-xs items-center">
                    <div className="font-medium w-16">{jour.jour_nom}</div>
                    
                    {/* Morning */}
                    <div className="flex items-center justify-center gap-1">
                      <span className="font-medium tabular-nums w-4 text-right">{jour.matin.capacites}</span>
                      <span className="text-muted-foreground">/</span>
                      <span className="text-muted-foreground tabular-nums w-4 text-left">{jour.matin.besoins}</span>
                      <Circle 
                        className={`${getSlotStatusColor(jour.matin.besoins, jour.matin.capacites)} h-2.5 w-2.5 flex-shrink-0 ml-1`} 
                        fill="currentColor"
                      />
                    </div>

                    {/* Afternoon */}
                    <div className="flex items-center justify-center gap-1">
                      <span className="font-medium tabular-nums w-4 text-right">{jour.apres_midi.capacites}</span>
                      <span className="text-muted-foreground">/</span>
                      <span className="text-muted-foreground tabular-nums w-4 text-left">{jour.apres_midi.besoins}</span>
                      <Circle 
                        className={`${getSlotStatusColor(jour.apres_midi.besoins, jour.apres_midi.capacites)} h-2.5 w-2.5 flex-shrink-0 ml-1`} 
                        fill="currentColor"
                      />
                    </div>
                  </div>
                ))}
                </div>

                {/* Legend */}
                <div className="pt-2 border-t text-xs text-muted-foreground">
                  Format: <span className="font-medium text-foreground">Capacités</span> / <span className="text-muted-foreground">Besoins</span>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
