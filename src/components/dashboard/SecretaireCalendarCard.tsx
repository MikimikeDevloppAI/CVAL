import { useState } from 'react';
import { format, addDays, startOfWeek } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Badge } from '@/components/ui/badge';
import { SecretaireDayActionsDialog } from './SecretaireDayActionsDialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface Assignment {
  site_nom?: string;
  medecin_nom?: string;
  besoin_operation_nom?: string;
  type_intervention_nom?: string;
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
  tags,
  onClick,
}: {
  siteName: string;
  period: 'matin' | 'apres_midi' | 'journee';
  tags?: string[];
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

  const hasTags = tags && tags.length > 0;
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
            <span className="truncate max-w-[80px]">{displayName}</span>
            {hasTags && (
              <span className="text-[8px] font-black bg-black/10 dark:bg-white/10 px-1 py-0.5 rounded">
                {tags.join(' ')}
              </span>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="bg-card/95 backdrop-blur-xl border border-border/50 shadow-xl px-3 py-2"
        >
          <div className="flex flex-col gap-1">
            <span className="font-semibold text-foreground">{siteName}</span>
            <div className="flex items-center gap-2">
              <span className={cn(
                "text-[10px] px-2 py-0.5 rounded-full font-medium",
                period === 'matin' && "bg-blue-500/15 text-blue-600 dark:text-blue-400",
                period === 'apres_midi' && "bg-amber-500/15 text-amber-600 dark:text-amber-400",
                period === 'journee' && "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
              )}>
                {periodLabels[period]}
              </span>
              {hasTags && (
                <span className="text-[10px] font-bold text-primary">
                  {tags.join(' ')}
                </span>
              )}
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function SecretaireCalendarCard({
  secretaire,
  days,
  startDate,
  index,
  onDayClick
}: SecretaireCalendarCardProps) {
  const [selectedDay, setSelectedDay] = useState<{ date: string; nom: string; periode: 'matin' | 'apres_midi' | 'journee' } | null>(null);
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

  const openActions = (date: string, periode: 'matin' | 'apres_midi' | 'journee') => {
    setSelectedDay({ date, nom: secretaire.nom_complet, periode });
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
    const getDisplayInfo = (assignments: Assignment[]) => {
      if (!assignments || assignments.length === 0) return null;

      const assignment = assignments[0];

      // Déterminer les tags (rôles)
      const tags: string[] = [];
      if (assignment.is_1r) tags.push('1R');
      if (assignment.is_2f) tags.push('2F');
      if (assignment.is_3f) tags.push('3F');

      // Strict Bloc detection: only if besoin_operation_nom OR type_intervention_nom exists
      const isBloc = Boolean(assignment.besoin_operation_nom || assignment.type_intervention_nom);

      let displayText = '';

      if (isBloc) {
        // BLOC OPÉRATOIRE: Display type intervention or besoin
        if (assignment.type_intervention_nom) {
          displayText = assignment.type_intervention_nom;
        } else if (assignment.besoin_operation_nom) {
          displayText = assignment.besoin_operation_nom;
        } else {
          displayText = 'Bloc';
        }
      } else {
        // SITE: Display site name
        displayText = assignment.site_nom || '-';
      }

      return {
        text: displayText,
        tags: tags.length > 0 ? tags : undefined,
      };
    };

    const matinInfo = hasMatin ? getDisplayInfo(day.data!.matin) : null;
    const amInfo = hasApresMidi ? getDisplayInfo(day.data!.apres_midi) : null;

    // Combiner les tags si journée entière
    const combinedTags = (hasMatin && hasApresMidi)
      ? [...new Set([...(matinInfo?.tags || []), ...(amInfo?.tags || [])])]
      : (matinInfo?.tags || amInfo?.tags);

    // Both periods with SAME site/role
    if (hasMatin && hasApresMidi && matinInfo?.text === amInfo?.text) {
      return (
        <div className="flex items-center justify-center min-h-[32px]">
          <SiteBadge
            siteName={matinInfo?.text || ''}
            period="journee"
            tags={combinedTags}
            onClick={() => openActions(day.date, 'journee')}
          />
        </div>
      );
    }

    // Different sites/roles → show two badges
    if (hasMatin && hasApresMidi) {
      return (
        <div className="flex flex-col items-center gap-1 py-1">
          <SiteBadge
            siteName={matinInfo?.text || ''}
            period="matin"
            tags={matinInfo?.tags}
            onClick={() => openActions(day.date, 'matin')}
          />
          <SiteBadge
            siteName={amInfo?.text || ''}
            period="apres_midi"
            tags={amInfo?.tags}
            onClick={() => openActions(day.date, 'apres_midi')}
          />
        </div>
      );
    }

    // Matin only
    if (hasMatin) {
      return (
        <div className="flex items-center justify-center min-h-[32px]">
          <SiteBadge
            siteName={matinInfo?.text || ''}
            period="matin"
            tags={matinInfo?.tags}
            onClick={() => openActions(day.date, 'matin')}
          />
        </div>
      );
    }

    // Après-midi only
    return (
      <div className="flex items-center justify-center min-h-[32px]">
        <SiteBadge
          siteName={amInfo?.text || ''}
          period="apres_midi"
          tags={amInfo?.tags}
          onClick={() => openActions(day.date, 'apres_midi')}
        />
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
        {weekDays.map((day) => (
          <div key={day.date} className="space-y-1">
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
        ))}
      </div>

      {selectedDay && (
        <SecretaireDayActionsDialog
          open={!!selectedDay}
          onOpenChange={(open) => !open && setSelectedDay(null)}
          secretaireId={secretaire.id}
          secretaireNom={selectedDay.nom}
          date={selectedDay.date}
          initialPeriode={selectedDay.periode}
          onRefresh={onDayClick ? () => onDayClick(secretaire.id, selectedDay.date) : () => {}}
        />
      )}
    </div>
  );
}
