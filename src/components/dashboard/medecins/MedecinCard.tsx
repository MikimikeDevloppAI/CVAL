import { CalendarDays, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Medecin } from './useMedecins';
import { useCanManagePlanning } from '@/hooks/useCanManagePlanning';

interface MedecinCardProps {
  medecin: Medecin;
  index: number;
  onOpenDetail: (medecin: Medecin) => void;
  onOpenCalendar: (medecin: Medecin) => void;
}

export function MedecinCard({ medecin, index, onOpenDetail, onOpenCalendar }: MedecinCardProps) {
  const { canManage } = useCanManagePlanning();

  // Count working days
  const workingDays = medecin.horaires_base_medecins?.reduce((acc, h) => {
    if (!acc.includes(h.jour_semaine)) {
      acc.push(h.jour_semaine);
    }
    return acc;
  }, [] as number[]).length || 0;

  const handleCalendarClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onOpenCalendar(medecin);
  };

  return (
    <div
      onClick={() => onOpenDetail(medecin)}
      className={`
        backdrop-blur-xl bg-card/95 rounded-2xl border border-border/50
        shadow-sm hover:shadow-xl hover:shadow-primary/5 transition-all duration-300
        hover:scale-[1.02] hover:-translate-y-1 hover:border-primary/30
        group relative overflow-hidden cursor-pointer
        ${medecin.actif === false ? 'opacity-60' : ''}
      `}
      style={{ animationDelay: `${index * 50}ms` }}
    >
      {/* Subtle gradient overlay on hover */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

      <div className="relative p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-4 flex-1 min-w-0">
            {/* Avatar */}
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center shrink-0 shadow-md shadow-teal-500/20 group-hover:shadow-lg group-hover:shadow-teal-500/30 transition-shadow">
              <span className="text-sm font-bold text-white">
                {medecin.first_name?.[0]}{medecin.name?.[0]}
              </span>
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-start gap-2 mb-1.5">
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-medium text-muted-foreground group-hover:text-primary/70 transition-colors">
                    {medecin.first_name}
                  </span>
                  <h3 className="text-base font-semibold text-foreground group-hover:text-primary transition-colors leading-tight truncate">
                    {medecin.name}
                  </h3>
                </div>
                {medecin.actif === false && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                    Inactif
                  </Badge>
                )}
              </div>
              <Badge className="bg-teal-500/10 text-teal-700 dark:text-teal-300 hover:bg-teal-500/15 border-0 text-xs font-medium">
                {medecin.specialites?.nom}
              </Badge>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 shrink-0">
            {canManage && (
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-xl text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                onClick={handleCalendarClick}
              >
                <CalendarDays className="h-4 w-4" />
              </Button>
            )}
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground group-hover:text-primary transition-colors">
              <ChevronRight className="h-4 w-4" />
            </div>
          </div>
        </div>

        {/* Summary info */}
        <div className="mt-4 pt-3 border-t border-border/30 flex items-center gap-3 text-xs text-muted-foreground">
          {workingDays > 0 && (
            <span className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/50">
              <span className="font-semibold text-foreground">{workingDays}</span>
              jour{workingDays > 1 ? 's' : ''}/sem
            </span>
          )}
          {medecin.email && (
            <span className="truncate flex-1">{medecin.email}</span>
          )}
        </div>
      </div>
    </div>
  );
}
