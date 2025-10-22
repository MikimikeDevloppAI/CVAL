import { useState } from 'react';
import { format, addDays, startOfWeek } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Badge } from '@/components/ui/badge';
import { Stethoscope, MapPin } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface Operation {
  id: string;
  periode: 'matin' | 'apres_midi';
  type_intervention_nom: string;
  type_intervention_code: string;
  medecin_nom: string;
  salle_nom: string | null;
}

interface OperationDayData {
  date: string;
  matin: Operation[];
  apres_midi: Operation[];
}

interface BlocOperatoireCalendarCardProps {
  days: OperationDayData[];
  startDate: string;
  index: number;
}

export function BlocOperatoireCalendarCard({
  days,
  startDate,
  index,
}: BlocOperatoireCalendarCardProps) {
  const weekStart = startOfWeek(new Date(startDate), { locale: fr });
  
  // Create a map of days for easy lookup
  const daysMap = new Map(days.map(day => [day.date, day]));
  
  // Generate all days from Monday to Friday
  const weekDays = Array.from({ length: 5 }, (_, i) => {
    const date = format(addDays(weekStart, i), 'yyyy-MM-dd');
    return {
      date,
      dayName: format(addDays(weekStart, i), 'EEEE', { locale: fr }),
      dayNumber: format(addDays(weekStart, i), 'd MMM', { locale: fr }),
      data: daysMap.get(date)
    };
  });

  const getSalleColor = (salleName: string | null) => {
    if (!salleName) return 'text-muted-foreground';
    
    const name = salleName.toLowerCase();
    if (name.includes('rouge')) return 'text-red-600';
    if (name.includes('vert')) return 'text-green-600';
    if (name.includes('jaune')) return 'text-yellow-600';
    return 'text-muted-foreground';
  };

  const getTooltipContent = (day: typeof weekDays[0]) => {
    if (!day.data) return 'Aucune opération';
    
    const content: string[] = [];
    
    if (day.data.matin.length > 0) {
      content.push('Matin:');
      day.data.matin.forEach(op => {
        content.push(`  🔬 ${op.type_intervention_code} - Dr. ${op.medecin_nom}`);
        if (op.salle_nom) content.push(`  📍 Salle ${op.salle_nom}`);
      });
    }
    
    if (day.data.apres_midi.length > 0) {
      if (content.length > 0) content.push('');
      content.push('Après-midi:');
      day.data.apres_midi.forEach(op => {
        content.push(`  🔬 ${op.type_intervention_code} - Dr. ${op.medecin_nom}`);
        if (op.salle_nom) content.push(`  📍 Salle ${op.salle_nom}`);
      });
    }
    
    return content.join('\n') || 'Aucune opération';
  };

  const renderOperationBar = (operations: Operation[], periode: 'matin' | 'apres_midi') => {
    if (operations.length === 0) {
      return (
        <div className="h-7 bg-muted/30 rounded border border-dashed border-muted-foreground/20 flex items-center justify-center">
          <span className="text-[10px] text-muted-foreground">-</span>
        </div>
      );
    }

    const bgColor = periode === 'matin' ? 'bg-blue-500/10 border-blue-500/30' : 'bg-yellow-500/10 border-yellow-500/30';
    const dotColor = periode === 'matin' ? 'bg-blue-500' : 'bg-yellow-500';

    return (
      <div className="space-y-1">
        {operations.map((op, idx) => (
          <div 
            key={idx}
            className={cn(
              "h-7 rounded flex items-center px-2 border transition-all",
              bgColor
            )}
          >
            <div className="flex items-center gap-1.5 w-full min-w-0">
              <div className={cn("w-2 h-2 rounded-full flex-shrink-0", dotColor)} />
              <div className="flex items-center gap-1 min-w-0 flex-1">
                <span className="text-[10px] font-medium truncate">
                  {op.type_intervention_code}
                </span>
                {op.salle_nom && (
                  <>
                    <span className="text-[10px] text-muted-foreground">•</span>
                    <MapPin className={cn("h-2.5 w-2.5 flex-shrink-0", getSalleColor(op.salle_nom))} />
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderDayBar = (day: typeof weekDays[0]) => {
    if (!day.data || (day.data.matin.length === 0 && day.data.apres_midi.length === 0)) {
      return (
        <div className="h-8 bg-muted/30 rounded border border-dashed border-muted-foreground/20 flex items-center justify-center">
          <span className="text-xs text-muted-foreground">-</span>
        </div>
      );
    }

    const hasMatin = day.data.matin.length > 0;
    const hasApresMidi = day.data.apres_midi.length > 0;

    return (
      <div className="space-y-1">
        {hasMatin && renderOperationBar(day.data.matin, 'matin')}
        {hasApresMidi && renderOperationBar(day.data.apres_midi, 'apres_midi')}
      </div>
    );
  };

  return (
    <div 
      className="bg-card/50 backdrop-blur-xl border border-border/50 rounded-xl shadow-lg overflow-hidden"
      style={{
        animation: `fadeIn 0.5s ease-out ${index * 0.05}s both`
      }}
    >
      {/* Header */}
      <div className="bg-gradient-to-br from-emerald-500/10 via-teal-500/10 to-cyan-500/10 p-4 border-b border-border/50">
        <h3 className="text-base font-semibold">Bloc opératoire</h3>
        <div className="flex flex-wrap gap-1 mt-2">
          <Badge variant="outline" className="bg-emerald-500/10 text-[10px] px-1.5 py-0">
            Chirurgie
          </Badge>
        </div>
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
  );
}
