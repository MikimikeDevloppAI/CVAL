import { useState } from 'react';
import { format, addDays, startOfWeek } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Badge } from '@/components/ui/badge';
import { MedecinActionsDialog } from './MedecinActionsDialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface MedecinAssignment {
  site_nom: string;
  site_id: string;
  type_intervention?: string;
}

interface MedecinDayData {
  date: string;
  matin: MedecinAssignment[];
  apres_midi: MedecinAssignment[];
}

interface MedecinCalendarCardProps {
  medecin: {
    id: string;
    nom_complet: string;
    specialite_nom: string;
    actif: boolean;
  };
  days: MedecinDayData[];
  startDate: string;
  index: number;
  onRefresh?: () => void;
}

// Fonction pour abréger les noms de sites
function abbreviateSiteName(siteName: string): string {
  if (!siteName) return '';

  const lower = siteName.toLowerCase();
  if (lower.includes('clinique la vallée') || lower.includes('clinique la vallee')) {
    const dashIndex = siteName.indexOf('-');
    if (dashIndex !== -1) {
      const suffix = siteName.substring(dashIndex).trim();
      return `Cval ${suffix}`;
    }
    return 'Cval';
  }

  return siteName;
}

// Composant Badge pour afficher le site
function SiteBadge({
  siteName,
  period,
  onClick,
}: {
  siteName: string;
  period: 'matin' | 'apres_midi' | 'journee';
  onClick?: () => void;
}) {
  const periodColors = {
    matin: 'bg-blue-500/15 border-blue-500/30 text-blue-700 dark:text-blue-300',
    apres_midi: 'bg-amber-500/15 border-amber-500/30 text-amber-700 dark:text-amber-300',
    journee: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-700 dark:text-emerald-300',
  };

  const periodDotColors = {
    matin: 'bg-blue-500',
    apres_midi: 'bg-amber-500',
    journee: 'bg-emerald-500',
  };

  const periodLabels = {
    matin: 'Matin',
    apres_midi: 'Après-midi',
    journee: 'Journée',
  };

  const displayName = abbreviateSiteName(siteName);

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onClick}
            className={cn(
              "flex items-center gap-1.5 px-2 py-1 rounded-md border",
              "text-[11px] font-medium transition-all duration-200",
              "hover:scale-105 hover:shadow-md",
              "focus:outline-none",
              periodColors[period]
            )}
          >
            <div className={cn(
              "w-2 h-2 rounded-full flex-shrink-0",
              periodDotColors[period]
            )} />
            <span className="truncate max-w-[100px]">{displayName}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="bg-card/95 backdrop-blur-xl border border-border/50 shadow-xl px-3 py-2"
        >
          <div className="flex flex-col gap-1">
            <span className="font-semibold text-foreground">{siteName}</span>
            <span className={cn(
              "text-[10px] px-2 py-0.5 rounded-full font-medium w-fit",
              period === 'matin' && "bg-blue-500/15 text-blue-600 dark:text-blue-400",
              period === 'apres_midi' && "bg-amber-500/15 text-amber-600 dark:text-amber-400",
              period === 'journee' && "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
            )}>
              {periodLabels[period]}
            </span>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function MedecinCalendarCard({
  medecin,
  days,
  startDate,
  index,
  onRefresh,
}: MedecinCalendarCardProps) {
  const [selectedDay, setSelectedDay] = useState<{
    date: string;
    siteId: string;
    periode: 'matin' | 'apres_midi' | 'journee';
  } | null>(null);
  const weekStart = startOfWeek(new Date(startDate), { locale: fr });
  
  // Create a map of days for easy lookup
  const daysMap = new Map(days.map(day => [day.date, day]));
  
  // Generate all days from Monday to Saturday
  const weekDays = Array.from({ length: 6 }, (_, i) => {
    const date = format(addDays(weekStart, i), 'yyyy-MM-dd');
    return {
      date,
      dayName: format(addDays(weekStart, i), 'EEEE', { locale: fr }),
      dayNumber: format(addDays(weekStart, i), 'd MMM', { locale: fr }),
      data: daysMap.get(date)
    };
  });

  const getTooltipContent = (day: typeof weekDays[0]) => {
    if (!day.data) return 'Aucune assignation';
    
    const content: string[] = [];
    
    if (day.data.matin.length > 0) {
      content.push('Matin:');
      day.data.matin.forEach(a => {
        if (a.site_nom) content.push(`  📍 ${a.site_nom}`);
        if (a.type_intervention) content.push(`  🔬 ${a.type_intervention}`);
      });
    }
    
    if (day.data.apres_midi.length > 0) {
      if (content.length > 0) content.push('');
      content.push('Après-midi:');
      day.data.apres_midi.forEach(a => {
        if (a.site_nom) content.push(`  📍 ${a.site_nom}`);
        if (a.type_intervention) content.push(`  🔬 ${a.type_intervention}`);
      });
    }
    
    return content.join('\n') || 'Aucune assignation';
  };

  const renderDayBar = (day: typeof weekDays[0]) => {
    const hasMatin = day.data && day.data.matin.length > 0;
    const hasApresMidi = day.data && day.data.apres_midi.length > 0;

    if (!hasMatin && !hasApresMidi) {
      return (
        <div className="h-8 flex items-center justify-center">
          <span className="text-[10px] text-muted-foreground/40">—</span>
        </div>
      );
    }

    // Helper function to get display info
    const getDisplayInfo = (assignments: MedecinAssignment[]) => {
      if (!assignments || assignments.length === 0) return null;

      const assignment = assignments[0];

      // Check if it's a bloc operatoire
      const isBloc = assignment.type_intervention !== undefined && assignment.type_intervention !== null;

      if (isBloc) {
        return assignment.type_intervention || 'Bloc';
      }

      return assignment.site_nom || '-';
    };

    const matinText = hasMatin ? getDisplayInfo(day.data!.matin) : null;
    const amText = hasApresMidi ? getDisplayInfo(day.data!.apres_midi) : null;

    // Both periods with SAME site/intervention
    if (hasMatin && hasApresMidi && matinText === amText) {
      const siteId = day.data!.matin[0]?.site_id || '';
      return (
        <div className="flex items-center justify-center min-h-[32px]">
          <SiteBadge
            siteName={matinText || ''}
            period="journee"
            onClick={() => setSelectedDay({ date: day.date, siteId, periode: 'journee' })}
          />
        </div>
      );
    }

    // Different sites/interventions → show two badges
    if (hasMatin && hasApresMidi) {
      const matinSiteId = day.data!.matin[0]?.site_id || '';
      const amSiteId = day.data!.apres_midi[0]?.site_id || '';
      return (
        <div className="flex flex-col items-center gap-1 py-1">
          <SiteBadge
            siteName={matinText || ''}
            period="matin"
            onClick={() => setSelectedDay({ date: day.date, siteId: matinSiteId, periode: 'matin' })}
          />
          <SiteBadge
            siteName={amText || ''}
            period="apres_midi"
            onClick={() => setSelectedDay({ date: day.date, siteId: amSiteId, periode: 'apres_midi' })}
          />
        </div>
      );
    }

    // Matin only
    if (hasMatin) {
      const siteId = day.data!.matin[0]?.site_id || '';
      return (
        <div className="flex items-center justify-center min-h-[32px]">
          <SiteBadge
            siteName={matinText || ''}
            period="matin"
            onClick={() => setSelectedDay({ date: day.date, siteId, periode: 'matin' })}
          />
        </div>
      );
    }

    // Après-midi only
    const siteId = day.data!.apres_midi[0]?.site_id || '';
    return (
      <div className="flex items-center justify-center min-h-[32px]">
        <SiteBadge
          siteName={amText || ''}
          period="apres_midi"
          onClick={() => setSelectedDay({ date: day.date, siteId, periode: 'apres_midi' })}
        />
      </div>
    );
  };

  return (
    <>
      <div 
        className="bg-card/50 backdrop-blur-xl border border-border/50 rounded-xl shadow-lg overflow-hidden"
        style={{
          animation: `fadeIn 0.5s ease-out ${index * 0.05}s both`
        }}
      >
        {/* Header */}
        <div className="bg-gradient-to-br from-cyan-500/10 via-blue-500/10 to-indigo-500/10 p-4 border-b border-border/50">
          <h3 className="text-base font-semibold truncate">{medecin.nom_complet}</h3>
          {!medecin.actif && (
            <div className="flex flex-wrap gap-1 mt-2">
              <Badge variant="outline" className="bg-destructive/10 text-[10px] px-1.5 py-0">
                Inactif
              </Badge>
            </div>
          )}
        </div>

        {/* Days List - Vertical */}
        <div className="p-3 space-y-2">
          <TooltipProvider>
            {weekDays.map((day) => (
              <Tooltip key={day.date}>
                <TooltipTrigger asChild>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground capitalize">
                        {day.dayName}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {day.dayNumber}
                      </span>
                    </div>
                    {renderDayBar(day)}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs whitespace-pre-line">
                  <div className="text-xs">{getTooltipContent(day)}</div>
                </TooltipContent>
              </Tooltip>
            ))}
          </TooltipProvider>
        </div>
      </div>

      {selectedDay && (
        <MedecinActionsDialog
          open={!!selectedDay}
          onOpenChange={(open) => !open && setSelectedDay(null)}
          medecinId={medecin.id}
          medecinNom={medecin.nom_complet.split(' ').slice(1).join(' ')}
          medecinPrenom={medecin.nom_complet.split(' ')[0]}
          date={selectedDay.date}
          siteId={selectedDay.siteId}
          periode={selectedDay.periode}
          onRefresh={onRefresh || (() => {})}
        />
      )}
    </>
  );
}
