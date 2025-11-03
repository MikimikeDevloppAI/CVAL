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
        <div className="h-8 bg-muted/30 rounded border border-dashed border-muted-foreground/20 flex items-center justify-center">
          <span className="text-xs text-muted-foreground">-</span>
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
        // Display type d'intervention for bloc
        return {
          text: assignment.type_intervention || 'Bloc',
          isBloc: true
        };
      }
      
      // Display site name for regular sites
      return {
        text: assignment.site_nom || '-',
        isBloc: false
      };
    };

    const matinInfo = hasMatin ? getDisplayInfo(day.data!.matin) : null;
    const amInfo = hasApresMidi ? getDisplayInfo(day.data!.apres_midi) : null;

    // Both periods with SAME site/intervention
    if (hasMatin && hasApresMidi && matinInfo?.text === amInfo?.text) {
      const siteId = day.data!.matin[0]?.site_id || '';
      return (
        <div 
          className="h-8 bg-gradient-to-r from-green-500/20 to-green-500/20 border border-green-500/30 rounded flex items-center cursor-pointer transition-all hover:shadow-md px-2"
          onClick={(e) => {
            e.stopPropagation();
            setSelectedDay({ date: day.date, siteId, periode: 'journee' });
          }}
        >
          <div className="flex items-center gap-1 w-full min-w-0">
            <div className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
            <span className="text-xs font-medium truncate">{matinInfo?.text || 'Journée'}</span>
          </div>
        </div>
      );
    }

    // Different sites/interventions OR partial presence → show two lines
    if (hasMatin && hasApresMidi) {
      const matinSiteId = day.data!.matin[0]?.site_id || '';
      const amSiteId = day.data!.apres_midi[0]?.site_id || '';
      return (
        <div className="space-y-1">
          {/* Matin */}
          <div 
            className="h-7 bg-blue-500/10 border border-blue-500/30 rounded flex items-center cursor-pointer transition-all hover:shadow-md px-2"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedDay({ date: day.date, siteId: matinSiteId, periode: 'matin' });
            }}
          >
            <div className="flex items-center gap-1 w-full min-w-0">
              <div className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
              <span className="text-[10px] font-medium truncate">
                {matinInfo?.text || 'Matin'}
              </span>
            </div>
          </div>
          {/* Après-midi */}
          <div 
            className="h-7 bg-yellow-500/10 border border-yellow-500/30 rounded flex items-center cursor-pointer transition-all hover:shadow-md px-2"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedDay({ date: day.date, siteId: amSiteId, periode: 'apres_midi' });
            }}
          >
            <div className="flex items-center gap-1 w-full min-w-0">
              <div className="w-2 h-2 rounded-full bg-yellow-500 flex-shrink-0" />
              <span className="text-[10px] font-medium truncate">
                {amInfo?.text || 'Après-midi'}
              </span>
            </div>
          </div>
        </div>
      );
    }

    // Matin only
    if (hasMatin) {
      const siteId = day.data!.matin[0]?.site_id || '';
      return (
        <div 
          className="h-8 bg-blue-500/10 border border-blue-500/30 rounded flex items-center cursor-pointer transition-all hover:shadow-md px-2"
          onClick={(e) => {
            e.stopPropagation();
            setSelectedDay({ date: day.date, siteId, periode: 'matin' });
          }}
        >
          <div className="flex items-center gap-1 w-full min-w-0">
            <div className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
            <span className="text-xs font-medium truncate">
              {matinInfo?.text || 'Matin'}
            </span>
          </div>
        </div>
      );
    }

    // Après-midi only
    const siteId = day.data!.apres_midi[0]?.site_id || '';
    return (
      <div 
        className="h-8 bg-yellow-500/10 border border-yellow-500/30 rounded flex items-center cursor-pointer transition-all hover:shadow-md px-2"
        onClick={(e) => {
          e.stopPropagation();
          setSelectedDay({ date: day.date, siteId, periode: 'apres_midi' });
        }}
      >
        <div className="flex items-center gap-1 w-full min-w-0">
          <div className="w-2 h-2 rounded-full bg-yellow-500 flex-shrink-0" />
          <span className="text-xs font-medium truncate">
            {amInfo?.text || 'Après-midi'}
          </span>
        </div>
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
