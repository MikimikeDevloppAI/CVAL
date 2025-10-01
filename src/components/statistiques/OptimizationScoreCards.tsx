import { Card } from "@/components/ui/card";
import { OptimizationScoreParSpecialite } from "@/types/baseSchedule";

interface OptimizationScoreCardsProps {
  scores: OptimizationScoreParSpecialite[];
}

function getScoreColor(score: number): string {
  if (score <= 100) return "text-green-600 dark:text-green-400";
  if (score <= 400) return "text-orange-600 dark:text-orange-400";
  return "text-red-600 dark:text-red-400";
}

function getScoreBgColor(score: number): string {
  if (score <= 100) return "bg-green-50 dark:bg-green-950/30";
  if (score <= 400) return "bg-orange-50 dark:bg-orange-950/30";
  return "bg-red-50 dark:bg-red-950/30";
}

function getPourcentageColor(pourcentage: number): string {
  if (pourcentage >= 100) return "text-green-600 dark:text-green-400";
  if (pourcentage >= 80) return "text-orange-600 dark:text-orange-400";
  return "text-red-600 dark:text-red-400";
}

export function OptimizationScoreCards({ scores }: OptimizationScoreCardsProps) {
  if (scores.length === 0) return null;

  return (
    <div className="space-y-4 mb-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Optimisation des horaires de base</h3>
        <p className="text-sm text-muted-foreground">
          Score optimal : proche de 0 (100% de satisfaction)
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {scores.map((score) => (
          <Card key={score.specialite_id} className={`p-4 ${getScoreBgColor(score.score_global)}`}>
            <div className="space-y-3">
              {/* Header */}
              <div className="flex items-center justify-between">
                <h4 className="font-semibold">{score.specialite_nom}</h4>
                <div className="text-right">
                  <div className={`text-2xl font-bold ${getScoreColor(score.score_global)}`}>
                    {score.score_global}
                  </div>
                  <div className={`text-sm ${getPourcentageColor(score.pourcentage_global)}`}>
                    {score.pourcentage_global}%
                  </div>
                </div>
              </div>

              {/* Details by day */}
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2 text-xs font-medium text-muted-foreground">
                  <div>Jour</div>
                  <div className="text-center">Matin (7h30-12h)</div>
                  <div className="text-center">Après-midi (13h-17h)</div>
                </div>

                {score.details_jours.map((jour) => (
                  <div key={jour.jour_semaine} className="grid grid-cols-3 gap-2 text-xs">
                    <div className="font-medium">{jour.jour_nom}</div>
                    
                    {/* Morning */}
                    <div className="text-center space-y-1">
                      <div className="flex items-center justify-center gap-1">
                        <span className="text-muted-foreground">{jour.matin.capacites}</span>
                        <span className="text-muted-foreground">/</span>
                        <span>{jour.matin.besoins}</span>
                      </div>
                      <div className={`text-xs ${getPourcentageColor(jour.matin.pourcentage)}`}>
                        {jour.matin.pourcentage}% • {jour.matin.score}
                      </div>
                    </div>

                    {/* Afternoon */}
                    <div className="text-center space-y-1">
                      <div className="flex items-center justify-center gap-1">
                        <span className="text-muted-foreground">{jour.apres_midi.capacites}</span>
                        <span className="text-muted-foreground">/</span>
                        <span>{jour.apres_midi.besoins}</span>
                      </div>
                      <div className={`text-xs ${getPourcentageColor(jour.apres_midi.pourcentage)}`}>
                        {jour.apres_midi.pourcentage}% • {jour.apres_midi.score}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
