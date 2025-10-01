import { Card } from "@/components/ui/card";
import { OptimizationScoreParSpecialite } from "@/types/baseSchedule";
import { CheckCircle2, Circle } from "lucide-react";

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

export function OptimizationScoreCards({ scores }: OptimizationScoreCardsProps) {
  if (scores.length === 0) return null;

  return (
    <div className="space-y-4 mb-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Optimisation des horaires de base</h3>
        <p className="text-sm text-muted-foreground">
          Demi-journées optimisées (capacités ≥ besoins)
        </p>
      </div>

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
                  <div>Jour</div>
                  <div className="text-center">Matin (7h30-12h)</div>
                  <div className="text-center">Après-midi (13h-17h)</div>
                </div>

                {score.details_jours.map((jour) => (
                  <div key={jour.jour_semaine} className="grid grid-cols-[auto_1fr_1fr] gap-2 text-xs items-center">
                    <div className="font-medium">{jour.jour_nom}</div>
                    
                    {/* Morning */}
                    <div className="flex items-center justify-center gap-1.5">
                      <span className="font-medium">{jour.matin.capacites}</span>
                      <span className="text-muted-foreground">/</span>
                      <span className="text-muted-foreground">{jour.matin.besoins}</span>
                      <Circle 
                        className={`${getSlotStatusColor(jour.matin.besoins, jour.matin.capacites)} h-2.5 w-2.5 flex-shrink-0`} 
                        fill="currentColor"
                      />
                    </div>

                    {/* Afternoon */}
                    <div className="flex items-center justify-center gap-1.5">
                      <span className="font-medium">{jour.apres_midi.capacites}</span>
                      <span className="text-muted-foreground">/</span>
                      <span className="text-muted-foreground">{jour.apres_midi.besoins}</span>
                      <Circle 
                        className={`${getSlotStatusColor(jour.apres_midi.besoins, jour.apres_midi.capacites)} h-2.5 w-2.5 flex-shrink-0`} 
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
