import { useState } from 'react';
import { format, eachDayOfInterval, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { DayCell } from './DayCell';
import { DayDetailDialog } from './DayDetailDialog';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

interface PersonnePresence {
  id: string;
  nom: string;
  matin: boolean;
  apres_midi: boolean;
  validated?: boolean;
  is_1r?: boolean;
  is_2f?: boolean;
  is_3f?: boolean;
}

interface DayData {
  date: string;
  medecins: PersonnePresence[];
  secretaires: PersonnePresence[];
  besoin_secretaires_matin: number;
  besoin_secretaires_apres_midi: number;
  status_matin: 'satisfait' | 'partiel' | 'non_satisfait';
  status_apres_midi: 'satisfait' | 'partiel' | 'non_satisfait';
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
  onRefresh: () => void;
}

export const SiteCalendarCard = ({ site, startDate, endDate, index, onRefresh }: SiteCalendarCardProps) => {
  const [selectedDay, setSelectedDay] = useState<{ date: Date; data: DayData } | null>(null);

  // Filter out Sundays (day 0)
  const days = eachDayOfInterval({
    start: parseISO(startDate),
    end: parseISO(endDate)
  }).filter(day => day.getDay() !== 0);

  const getDayData = (date: Date): DayData | null => {
    const dateStr = format(date, 'yyyy-MM-dd');
    return site.days.find(d => d.date === dateStr) || null;
  };

  const handleOpenDetail = (date: Date, data: DayData) => {
    setSelectedDay({ date, data });
  };

  const hasIssues = site.days.some(d => d.status_matin !== 'satisfait' || d.status_apres_midi !== 'satisfait');

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
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
          {/* Day Headers */}
          {days.map((day) => {
            const dayData = getDayData(day);
            
            // Calculate needs and capacities for morning and afternoon
            let besoinMatin = 0;
            let capaciteMatin = 0;
            let besoinAM = 0;
            let capaciteAM = 0;
            
            if (dayData) {
              besoinMatin = Math.ceil(dayData.besoin_secretaires_matin);
              capaciteMatin = dayData.secretaires.filter(s => s.matin).length;
              besoinAM = Math.ceil(dayData.besoin_secretaires_apres_midi);
              capaciteAM = dayData.secretaires.filter(s => s.apres_midi).length;
            }

            const hasManqueMatin = besoinMatin > capaciteMatin;
            const hasManqueAM = besoinAM > capaciteAM;

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
                {dayData && (hasManqueMatin || hasManqueAM) && (
                  <div className="mt-1 space-y-0.5">
                    {hasManqueMatin && (
                      <p className="text-[10px] font-semibold text-destructive">
                        M: {besoinMatin}/{capaciteMatin}
                      </p>
                    )}
                    {hasManqueAM && (
                      <p className="text-[10px] font-semibold text-destructive">
                        AM: {besoinAM}/{capaciteAM}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Day Cells */}
          {days.map((day) => {
            const dayData = getDayData(day);
            return (
              <DayCell
                key={day.toISOString()}
                date={day}
                data={dayData}
                onOpenDetail={handleOpenDetail}
              />
            );
          })}
        </div>
      </div>

      {selectedDay && (
        <DayDetailDialog
          open={!!selectedDay}
          onOpenChange={(open) => !open && setSelectedDay(null)}
          date={selectedDay.date}
          siteId={site.site_id}
          siteName={site.site_nom}
          onRefresh={onRefresh}
        />
      )}
    </div>
  );
};
