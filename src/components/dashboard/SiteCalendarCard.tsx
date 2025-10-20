import { format, eachDayOfInterval, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { DayCell } from './DayCell';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

interface DayData {
  date: string;
  periode: 'matin' | 'apres_midi';
  medecins: { id: string; nom: string }[];
  secretaires: { 
    id: string; 
    nom: string; 
    validated: boolean;
    is_1r?: boolean;
    is_2f?: boolean;
  }[];
  besoin_secretaires: number;
  status: 'satisfait' | 'partiel' | 'non_satisfait';
}

interface DashboardSite {
  site_id: string;
  site_nom: string;
  site_fermeture: boolean;
  days: DayData[];
}

interface SiteCalendarCardProps {
  site: DashboardSite;
  startDate: string;
  endDate: string;
  index: number;
}

export const SiteCalendarCard = ({ site, startDate, endDate, index }: SiteCalendarCardProps) => {
  const days = eachDayOfInterval({
    start: parseISO(startDate),
    end: parseISO(endDate)
  });

  const getDayData = (date: Date, periode: 'matin' | 'apres_midi'): DayData | null => {
    const dateStr = format(date, 'yyyy-MM-dd');
    return site.days.find(d => d.date === dateStr && d.periode === periode) || null;
  };

  const hasIssues = site.days.some(d => d.status !== 'satisfait');

  return (
    <div
      className={cn(
        "rounded-xl overflow-hidden",
        "bg-card/50 backdrop-blur-xl border border-border/50",
        "shadow-lg hover:shadow-xl",
        "transition-all duration-300 ease-out",
        "animate-fade-in"
      )}
      style={{ animationDelay: `${index * 100}ms` }}
    >
      {/* Header */}
      <div className="p-6 border-b border-border/50 bg-gradient-to-r from-primary/5 to-transparent">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-foreground">
              {site.site_nom}
            </h3>
            {site.site_fermeture && (
              <Badge variant="destructive" className="mt-2">
                Fermé
              </Badge>
            )}
          </div>
          {hasIssues && (
            <Badge variant="outline" className="bg-cyan-500/10 text-cyan-600 border-cyan-500/20">
              Besoins non satisfaits
            </Badge>
          )}
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="p-4">
        <div className="grid grid-cols-7 gap-2">
          {/* Day Headers */}
          {days.map((day) => {
            const dateStr = format(day, 'yyyy-MM-dd');
            const dayMorningData = getDayData(day, 'matin');
            const dayAfternoonData = getDayData(day, 'apres_midi');
            
            // Calculate missing secretaries for the day
            let totalManquant = 0;
            if (dayMorningData) {
              const manquantMatin = Math.max(0, Math.ceil(dayMorningData.besoin_secretaires) - dayMorningData.secretaires.length);
              totalManquant += manquantMatin;
            }
            if (dayAfternoonData) {
              const manquantAM = Math.max(0, Math.ceil(dayAfternoonData.besoin_secretaires) - dayAfternoonData.secretaires.length);
              totalManquant += manquantAM;
            }

            return (
              <div
                key={day.toISOString()}
                className="text-center pb-2 border-b border-border/30"
              >
                <p className="text-xs font-medium text-muted-foreground uppercase">
                  {format(day, 'EEE', { locale: fr })}
                </p>
                <p className="text-sm font-semibold text-foreground mt-1">
                  {format(day, 'd', { locale: fr })}
                </p>
                {totalManquant > 0 && (
                  <p className="text-[10px] text-red-600 font-semibold mt-1">
                    -{totalManquant}
                  </p>
                )}
              </div>
            );
          })}

          {/* Morning Row */}
          {days.map((day) => {
            const dayData = getDayData(day, 'matin');
            return (
              <DayCell
                key={`${day.toISOString()}-matin`}
                date={day}
                periode="matin"
                data={dayData}
              />
            );
          })}

          {/* Afternoon Row */}
          {days.map((day) => {
            const dayData = getDayData(day, 'apres_midi');
            return (
              <DayCell
                key={`${day.toISOString()}-apres_midi`}
                date={day}
                periode="apres_midi"
                data={dayData}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};
