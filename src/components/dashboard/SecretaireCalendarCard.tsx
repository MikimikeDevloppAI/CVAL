import { format, addDays, startOfWeek } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface Assignment {
  site_nom?: string;
  medecin_nom?: string;
  besoin_operation_nom?: string;
  salle_nom?: string;
  is_1r?: boolean;
  is_2f?: boolean;
  is_3f?: boolean;
  validated?: boolean;
}

interface DayData {
  date: string;
  matin: Assignment[];
  apres_midi: Assignment[];
}

interface SecretaireCalendarCardProps {
  secretaire: {
    id: string;
    nom_complet: string;
    actif: boolean;
    horaire_flexible: boolean;
    flexible_jours_supplementaires: boolean;
    nombre_jours_supplementaires?: number;
  };
  days: DayData[];
  startDate: string;
  index: number;
  onDayClick?: (secretaireId: string, date: string) => void;
}

export function SecretaireCalendarCard({
  secretaire,
  days,
  startDate,
  index,
  onDayClick
}: SecretaireCalendarCardProps) {
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
        if (a.medecin_nom) content.push(`  🩺 ${a.medecin_nom}`);
        if (a.besoin_operation_nom || a.salle_nom) {
          const parts = [];
          if (a.salle_nom) parts.push(a.salle_nom);
          if (a.besoin_operation_nom) parts.push(a.besoin_operation_nom);
          const badges = [a.is_1r && '1R', a.is_2f && '2F', a.is_3f && '3F'].filter(Boolean).join(' ');
          if (badges) parts.push(`(${badges})`);
          content.push(`  💼 ${parts.join(' - ')}`);
        }
      });
    }
    
    if (day.data.apres_midi.length > 0) {
      if (content.length > 0) content.push('');
      content.push('Après-midi:');
      day.data.apres_midi.forEach(a => {
        if (a.site_nom) content.push(`  📍 ${a.site_nom}`);
        if (a.medecin_nom) content.push(`  🩺 ${a.medecin_nom}`);
        if (a.besoin_operation_nom || a.salle_nom) {
          const parts = [];
          if (a.salle_nom) parts.push(a.salle_nom);
          if (a.besoin_operation_nom) parts.push(a.besoin_operation_nom);
          const badges = [a.is_1r && '1R', a.is_2f && '2F', a.is_3f && '3F'].filter(Boolean).join(' ');
          if (badges) parts.push(`(${badges})`);
          content.push(`  💼 ${parts.join(' - ')}`);
        }
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
    const getDisplayInfo = (assignments: Assignment[]) => {
      if (!assignments || assignments.length === 0) return null;
      
      const assignment = assignments[0];
      
      // Bloc opératoire: show besoin, role and salle
      if (assignment.besoin_operation_nom || assignment.is_1r || assignment.is_2f || assignment.is_3f) {
        const roles = [];
        if (assignment.is_1r) roles.push('1R');
        if (assignment.is_2f) roles.push('2F');
        if (assignment.is_3f) roles.push('3F');
        
        const salleName = assignment.salle_nom 
          ? assignment.salle_nom.charAt(0).toUpperCase() + assignment.salle_nom.slice(1)
          : '';
        const besoinName = assignment.besoin_operation_nom || '';
        const roleText = roles.length > 0 ? roles.join('/') : '';
        
        // Build display text with available elements
        const parts = [];
        if (besoinName) parts.push(besoinName);
        if (roleText) parts.push(roleText);
        if (salleName) parts.push(salleName);
        
        // If nothing to show, fallback to "Bloc"
        const displayText = parts.length > 0 ? parts.join(' - ') : 'Bloc';
        
        return {
          text: displayText,
          isBloc: true,
          role: roleText
        };
      }
      
      // Regular site
      const sitesSet = new Set(assignments.map(a => a.site_nom).filter(Boolean));
      return {
        text: Array.from(sitesSet).join(', '),
        isBloc: false,
        role: null
      };
    };

    const matinInfo = hasMatin ? getDisplayInfo(day.data!.matin) : null;
    const amInfo = hasApresMidi ? getDisplayInfo(day.data!.apres_midi) : null;

    // Both periods with SAME site/role
    if (hasMatin && hasApresMidi && matinInfo?.text === amInfo?.text) {
      return (
        <div className="h-8 bg-gradient-to-r from-green-500/20 to-green-500/20 border border-green-500/30 rounded flex items-center cursor-pointer hover:shadow-md transition-all px-2">
          <div className="flex items-center gap-1 w-full min-w-0">
            <div className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
            <span className="text-xs font-medium truncate">{matinInfo?.text || 'Journée'}</span>
          </div>
        </div>
      );
    }

    // Different sites/roles OR partial presence → show two lines
    if (hasMatin && hasApresMidi) {
      return (
        <div className="space-y-1">
          {/* Matin */}
          <div className="h-7 bg-blue-500/10 border border-blue-500/30 rounded flex items-center cursor-pointer hover:shadow-md transition-all px-2">
            <div className="flex items-center gap-1 w-full min-w-0">
              <div className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
              <span className="text-[10px] font-medium truncate">
                {matinInfo?.text || 'Matin'}
              </span>
            </div>
          </div>
          {/* Après-midi */}
          <div className="h-7 bg-yellow-500/10 border border-yellow-500/30 rounded flex items-center cursor-pointer hover:shadow-md transition-all px-2">
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
      return (
        <div className="h-8 bg-blue-500/10 border border-blue-500/30 rounded flex items-center cursor-pointer hover:shadow-md transition-all px-2">
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
    return (
      <div className="h-8 bg-yellow-500/10 border border-yellow-500/30 rounded flex items-center cursor-pointer hover:shadow-md transition-all px-2">
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
    <div 
      className="bg-card/50 backdrop-blur-xl border border-border/50 rounded-xl shadow-lg overflow-hidden transition-all hover:shadow-xl"
      style={{
        animation: `fadeIn 0.5s ease-out ${index * 0.05}s both`
      }}
    >
      {/* Header */}
      <div className="bg-gradient-to-br from-teal-500/10 via-cyan-500/10 to-blue-500/10 p-4 border-b border-border/50">
        <h3 className="text-base font-semibold truncate">{secretaire.nom_complet}</h3>
        <div className="flex flex-wrap gap-1 mt-2">
          {!secretaire.actif && (
            <Badge variant="outline" className="bg-destructive/10 text-[10px] px-1.5 py-0">
              Inactif
            </Badge>
          )}
          {secretaire.horaire_flexible && (
            <Badge variant="outline" className="bg-blue-500/10 text-[10px] px-1.5 py-0">
              Flex
            </Badge>
          )}
          {secretaire.flexible_jours_supplementaires && (
            <Badge variant="outline" className="bg-purple-500/10 text-[10px] px-1.5 py-0">
              +{secretaire.nombre_jours_supplementaires || 1}j
            </Badge>
          )}
        </div>
      </div>

      {/* Days List - Vertical */}
      <div className="p-3 space-y-2">
        <TooltipProvider>
          {weekDays.map((day) => (
            <Tooltip key={day.date}>
              <TooltipTrigger asChild>
                <div 
                  className="space-y-1"
                  onClick={() => onDayClick?.(secretaire.id, day.date)}
                >
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
