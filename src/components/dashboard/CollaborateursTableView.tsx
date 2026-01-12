import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { useState, useRef, useEffect, useMemo } from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { SecretaireDayActionsDialog } from './SecretaireDayActionsDialog';
import { MedecinActionsDialog } from './MedecinActionsDialog';
import { User, Stethoscope, Filter, Palmtree } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// Types pour les assignations
interface Assignment {
  site_nom?: string;
  site_id?: string;
  medecin_nom?: string;
  besoin_operation_nom?: string;
  type_intervention_nom?: string;
  type_intervention?: string;
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

// Type unifié pour les collaborateurs
export interface Collaborateur {
  id: string;
  nom_complet: string;
  type: 'medecin' | 'assistant';
  actif: boolean;
  // Pour les assistants
  horaire_flexible?: boolean;
  flexible_jours_supplementaires?: boolean;
  nombre_jours_supplementaires?: number;
  // Pour les médecins
  specialite_nom?: string;
  // Données des jours
  days: DayData[];
}

interface AbsenceInfo {
  id: string;
  nom: string;
  type: 'medecin' | 'assistant';
}

interface CollaborateursTableViewProps {
  collaborateurs: Collaborateur[];
  weekDays: Date[];
  onRefresh?: () => void;
  absencesByDate?: Record<string, AbsenceInfo[]>;
}

type FilterType = 'tous' | 'assistant' | 'medecin';

// Fonction pour générer les initiales
function getInitials(nomComplet: string): string {
  const parts = nomComplet.trim().split(' ').filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`.toUpperCase();
}

// Fonction pour abréger les noms de sites
function abbreviateSiteName(siteName: string): string {
  if (!siteName) return '';

  // Abréger "Clinique La Vallée" en "Cval" mais garder ce qui suit le tiret
  const lower = siteName.toLowerCase();
  if (lower.includes('clinique la vallée') || lower.includes('clinique la vallee')) {
    // Chercher le tiret et garder ce qui suit
    const dashIndex = siteName.indexOf('-');
    if (dashIndex !== -1) {
      const suffix = siteName.substring(dashIndex).trim(); // Garde "- Consultation" etc.
      return `Cval ${suffix}`;
    }
    return 'Cval';
  }

  return siteName;
}

// Composant Badge pour afficher le site (comme dans le calendrier global mais avec design SitesTableView)
function SiteBadge({
  siteName,
  period,
  tags,
  onClick,
}: {
  siteName: string;
  period: 'matin' | 'apres_midi' | 'journee';
  tags?: string[];
  onClick?: (e: React.MouseEvent) => void;
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
              "relative flex items-center gap-1.5 px-2 py-1 rounded-md border",
              "text-[11px] font-medium transition-all duration-200",
              "hover:scale-105 hover:shadow-md hover:-translate-y-0.5",
              "focus:outline-none",
              periodColors[period]
            )}
          >
            {/* Point indicateur de période */}
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

// Composant Badge pour les congés
function LeaveBadge({ fullName }: { fullName: string }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              "flex items-center gap-1.5 px-2 py-1 rounded-md border",
              "text-[11px] font-medium",
              "bg-orange-500/15 border-orange-500/30 text-orange-700 dark:text-orange-300"
            )}
          >
            <Palmtree className="w-3 h-3 flex-shrink-0" />
            <span>Congé</span>
          </div>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="bg-card/95 backdrop-blur-xl border border-border/50 shadow-xl px-3 py-2"
        >
          <div className="flex flex-col gap-1">
            <span className="font-semibold text-foreground">{fullName}</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-orange-500/15 text-orange-600 dark:text-orange-400">
              En congé
            </span>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Composant pour une cellule de jour
function DayCell({
  collaborateur,
  date,
  isToday,
  isWeekend,
  isMonday,
  isFirstDay,
  isEvenRow,
  onCellClick,
  isOnLeave,
}: {
  collaborateur: Collaborateur;
  date: Date;
  isToday: boolean;
  isWeekend: boolean;
  isMonday: boolean;
  isFirstDay: boolean;
  isEvenRow: boolean;
  onCellClick: (periode: 'matin' | 'apres_midi' | 'journee', siteId?: string) => void;
  isOnLeave: boolean;
}) {
  const dateStr = format(date, 'yyyy-MM-dd');

  // Trouver les données pour ce jour
  const dayData = collaborateur.days.find(d => d.date === dateStr);
  const hasMatin = dayData && dayData.matin.length > 0;
  const hasApresMidi = dayData && dayData.apres_midi.length > 0;

  // Helper pour obtenir les infos d'affichage
  const getAssignmentInfo = (assignments: Assignment[]) => {
    if (!assignments || assignments.length === 0) return null;
    const assignment = assignments[0];

    // Déterminer les tags (rôles)
    const tags: string[] = [];
    if (assignment.is_1r) tags.push('1R');
    if (assignment.is_2f) tags.push('2F');
    if (assignment.is_3f) tags.push('3F');

    // Déterminer le nom du site à afficher
    // Pour les médecins: type_intervention ou site_nom
    // Pour les assistants: besoin_operation_nom ou site_nom
    let displayName = assignment.site_nom || '';

    // Si c'est un bloc opératoire (type_intervention pour médecin ou besoin_operation pour assistant)
    if (assignment.type_intervention) {
      displayName = assignment.type_intervention;
    } else if (assignment.type_intervention_nom) {
      displayName = assignment.type_intervention_nom;
    } else if (assignment.besoin_operation_nom) {
      displayName = assignment.besoin_operation_nom;
    }

    return {
      siteId: assignment.site_id,
      siteName: displayName,
      tags: tags.length > 0 ? tags : undefined,
    };
  };

  const matinInfo = hasMatin ? getAssignmentInfo(dayData!.matin) : null;
  const amInfo = hasApresMidi ? getAssignmentInfo(dayData!.apres_midi) : null;

  // Déterminer la période
  const isFullDay = hasMatin && hasApresMidi;
  const isMatinOnly = hasMatin && !hasApresMidi;
  const isApresMidiOnly = !hasMatin && hasApresMidi;

  // Combiner les tags si journée entière
  const combinedTags = isFullDay
    ? [...new Set([...(matinInfo?.tags || []), ...(amInfo?.tags || [])])]
    : (matinInfo?.tags || amInfo?.tags);

  // Vérifier si matin et après-midi ont le même site
  const sameSite = matinInfo?.siteName && amInfo?.siteName && matinInfo.siteName === amInfo.siteName;

  // Rendu de la cellule
  const renderContent = () => {
    // Afficher le congé
    if (isOnLeave) {
      return (
        <div className="flex items-center justify-center min-h-[40px]">
          <LeaveBadge fullName={collaborateur.nom_complet} />
        </div>
      );
    }

    // Aucune assignation
    if (!hasMatin && !hasApresMidi) {
      return (
        <div className="flex items-center justify-center min-h-[40px]">
          <span className="text-[10px] text-muted-foreground/40">—</span>
        </div>
      );
    }

    // Journée entière (même site matin et après-midi)
    if (isFullDay && sameSite) {
      return (
        <div className="flex items-center justify-center min-h-[40px]">
          <SiteBadge
            siteName={matinInfo?.siteName || ''}
            period="journee"
            tags={combinedTags}
            onClick={(e) => {
              e.stopPropagation();
              onCellClick('journee', matinInfo?.siteId);
            }}
          />
        </div>
      );
    }

    // Matin et après-midi différents → afficher les deux
    if (isFullDay && !sameSite) {
      return (
        <div className="flex flex-col items-center gap-1 min-h-[40px] py-1">
          <SiteBadge
            siteName={matinInfo?.siteName || ''}
            period="matin"
            tags={matinInfo?.tags}
            onClick={(e) => {
              e.stopPropagation();
              onCellClick('matin', matinInfo?.siteId);
            }}
          />
          <SiteBadge
            siteName={amInfo?.siteName || ''}
            period="apres_midi"
            tags={amInfo?.tags}
            onClick={(e) => {
              e.stopPropagation();
              onCellClick('apres_midi', amInfo?.siteId);
            }}
          />
        </div>
      );
    }

    // Demi-journée unique
    if (isMatinOnly || isApresMidiOnly) {
      const period = isMatinOnly ? 'matin' : 'apres_midi';
      const info = isMatinOnly ? matinInfo : amInfo;
      return (
        <div className="flex items-center justify-center min-h-[40px]">
          <SiteBadge
            siteName={info?.siteName || ''}
            period={period}
            tags={info?.tags}
            onClick={(e) => {
              e.stopPropagation();
              onCellClick(period, info?.siteId);
            }}
          />
        </div>
      );
    }

    return null;
  };

  return (
    <td
      className={cn(
        "p-2 align-middle transition-all duration-200 min-w-[100px]",
        isMonday && !isFirstDay ? "border-l-4 border-l-primary/30" : "border-l border-border/30",
        isEvenRow
          ? "bg-white dark:bg-slate-900"
          : "bg-slate-100 dark:bg-slate-800",
        isWeekend && (isEvenRow
          ? "bg-slate-50 dark:bg-slate-900/50"
          : "bg-slate-200 dark:bg-slate-700/80"),
        isToday && "ring-2 ring-inset ring-primary/20",
        isOnLeave && "bg-orange-50/30 dark:bg-orange-950/10",
        "hover:bg-accent/30"
      )}
    >
      {renderContent()}
    </td>
  );
}

export function CollaborateursTableView({
  collaborateurs,
  weekDays,
  onRefresh,
  absencesByDate = {},
}: CollaborateursTableViewProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<FilterType>('tous');

  // État pour les dialogs
  const [secretaireDialog, setSecretaireDialog] = useState<{
    open: boolean;
    secretaireId: string;
    secretaireNom: string;
    date: string;
    periode: 'matin' | 'apres_midi' | 'journee';
  } | null>(null);

  const [medecinDialog, setMedecinDialog] = useState<{
    open: boolean;
    medecinId: string;
    medecinNom: string;
    medecinPrenom: string;
    date: string;
    siteId: string;
    periode: 'matin' | 'apres_midi' | 'journee';
  } | null>(null);

  // Filtrer les dimanches
  const weekdaysOnly = weekDays.filter(d => d.getDay() !== 0);

  // Filtrer les collaborateurs selon le type sélectionné
  const filteredCollaborateurs = collaborateurs.filter(c => {
    if (filter === 'tous') return true;
    return c.type === filter;
  });

  // Trier par type (assistants d'abord) puis par nom
  const sortedCollaborateurs = [...filteredCollaborateurs].sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'assistant' ? -1 : 1;
    }
    return a.nom_complet.localeCompare(b.nom_complet, 'fr');
  });

  // Générer une clé unique pour la période affichée basée sur weekDays props
  const periodKey = useMemo(() => {
    if (weekDays.length === 0) return '';
    const first = format(weekDays[0], 'yyyy-MM-dd');
    const last = format(weekDays[weekDays.length - 1], 'yyyy-MM-dd');
    return `${first}_${last}`;
  }, [weekDays]);

  // Auto-scroll vers aujourd'hui au chargement et à chaque changement de période
  useEffect(() => {
    // Attendre que les données soient chargées
    if (sortedCollaborateurs.length === 0 || weekdaysOnly.length === 0) return;

    // Délai plus long pour s'assurer que le DOM est prêt
    const timeoutId = setTimeout(() => {
      if (scrollContainerRef.current) {
        const todayStr = format(new Date(), 'yyyy-MM-dd');
        const todayIndex = weekdaysOnly.findIndex(d => format(d, 'yyyy-MM-dd') === todayStr);

        const columnWidth = 100;

        if (todayIndex >= 0) {
          // Scroll pour que aujourd'hui soit le premier jour visible (à gauche)
          const scrollPosition = todayIndex * columnWidth;
          scrollContainerRef.current.scrollLeft = Math.max(0, scrollPosition);
        } else {
          // Si aujourd'hui n'est pas dans la période, scroll au début
          scrollContainerRef.current.scrollLeft = 0;
        }
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [periodKey, sortedCollaborateurs.length, weekdaysOnly]);

  // Vérifier si un collaborateur est en congé pour une date donnée
  const isCollaborateurOnLeave = (collaborateurId: string, collaborateurType: 'medecin' | 'assistant', dateStr: string): boolean => {
    const absences = absencesByDate[dateStr] || [];
    return absences.some(a => a.id === collaborateurId && a.type === collaborateurType);
  };

  const handleCellClick = (
    collaborateur: Collaborateur,
    date: string,
    periode: 'matin' | 'apres_midi' | 'journee',
    siteId?: string
  ) => {
    if (collaborateur.type === 'assistant') {
      setSecretaireDialog({
        open: true,
        secretaireId: collaborateur.id,
        secretaireNom: collaborateur.nom_complet,
        date,
        periode,
      });
    } else {
      const nameParts = collaborateur.nom_complet.split(' ');
      const prenom = nameParts[0] || '';
      const nom = nameParts.slice(1).join(' ') || '';
      setMedecinDialog({
        open: true,
        medecinId: collaborateur.id,
        medecinNom: nom,
        medecinPrenom: prenom,
        date,
        siteId: siteId || '',
        periode,
      });
    }
  };

  const filterLabels: Record<FilterType, string> = {
    tous: 'Tous',
    assistant: 'Assistants',
    medecin: 'Médecins',
  };

  // Compter par type
  const counts = {
    tous: collaborateurs.length,
    assistant: collaborateurs.filter(c => c.type === 'assistant').length,
    medecin: collaborateurs.filter(c => c.type === 'medecin').length,
  };

  return (
    <div className="h-full overflow-hidden">
      {/* Table scrollable */}
      <div
        ref={scrollContainerRef}
        className="overflow-auto rounded-2xl border border-border/40 bg-card/30 backdrop-blur-xl shadow-xl max-h-full"
      >
        <table className="w-max border-collapse">
          <thead className="sticky top-0 z-30">
            <tr className="border-b border-border/40">
              {/* Colonne filtre */}
              <th className="sticky left-0 z-40 bg-card min-w-[200px] max-w-[200px] border-r border-border/30 py-3 px-4">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-2 w-full justify-start">
                      <Filter className="h-4 w-4" />
                      {filterLabels[filter]}
                      <span className="text-muted-foreground ml-auto">({counts[filter]})</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="z-[100]">
                    <DropdownMenuRadioGroup value={filter} onValueChange={(v) => setFilter(v as FilterType)}>
                      <DropdownMenuRadioItem value="tous">
                        Tous ({counts.tous})
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="assistant">
                        <User className="h-4 w-4 mr-2 text-cyan-500" />
                        Assistants ({counts.assistant})
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="medecin">
                        <Stethoscope className="h-4 w-4 mr-2 text-teal-500" />
                        Médecins ({counts.medecin})
                      </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </th>
              {weekdaysOnly.map((date, index) => {
                const isToday = format(date, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');
                const dayOfWeek = date.getDay();
                const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                const isMonday = dayOfWeek === 1;
                const isFirstDay = index === 0;

                return (
                  <th
                    key={format(date, 'yyyy-MM-dd')}
                    className={cn(
                      "text-center min-w-[100px] py-2",
                      isMonday && !isFirstDay ? "border-l-4 border-l-primary/30" : "border-l border-border/30",
                      isToday ? "bg-primary" : "bg-card",
                      isWeekend && !isToday && "bg-muted/50"
                    )}
                  >
                    <div className="flex flex-col items-center gap-0 px-2 py-1 rounded-xl transition-colors">
                      <span className={cn(
                        "text-[10px] font-bold uppercase tracking-widest",
                        isToday ? "text-primary-foreground" : "text-muted-foreground/70"
                      )}>
                        {format(date, 'EEE', { locale: fr })}
                      </span>
                      <span className={cn(
                        "text-xl font-black leading-none",
                        isToday ? "text-primary-foreground" : "text-foreground"
                      )}>
                        {format(date, 'd')}
                      </span>
                      <span className={cn(
                        "text-[9px] font-medium uppercase tracking-wide",
                        isToday ? "text-primary-foreground/80" : "text-muted-foreground/60"
                      )}>
                        {format(date, 'MMM', { locale: fr })}
                      </span>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedCollaborateurs.map((collaborateur, index) => {
              const isEvenRow = index % 2 === 0;

              return (
                <tr
                  key={collaborateur.id}
                  className="border-b border-border/50 transition-colors"
                >
                  <td className={cn(
                    "sticky left-0 z-10 border-r-2 border-border/50 py-2 px-3 min-w-[200px] max-w-[200px]",
                    isEvenRow ? "bg-white dark:bg-slate-900" : "bg-slate-100 dark:bg-slate-800"
                  )}>
                    <div className="flex items-center gap-2">
                      <div className={cn(
                        "flex items-center justify-center w-8 h-8 rounded-lg text-white text-[10px] font-bold",
                        "bg-gradient-to-br shadow-sm",
                        collaborateur.type === 'medecin'
                          ? "from-teal-500 to-emerald-600"
                          : "from-cyan-500 to-blue-600"
                      )}>
                        {getInitials(collaborateur.nom_complet)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="font-semibold text-sm text-foreground truncate block leading-tight">
                          {collaborateur.nom_complet}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {collaborateur.type === 'medecin' ? collaborateur.specialite_nom || 'Médecin' : 'Assistant'}
                        </span>
                      </div>
                    </div>
                  </td>
                  {weekdaysOnly.map((date, dayIndex) => {
                    const dateStr = format(date, 'yyyy-MM-dd');
                    const isToday = dateStr === format(new Date(), 'yyyy-MM-dd');
                    const dayOfWeek = date.getDay();
                    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                    const isMonday = dayOfWeek === 1;
                    const isFirstDay = dayIndex === 0;
                    const isOnLeave = isCollaborateurOnLeave(collaborateur.id, collaborateur.type, dateStr);

                    return (
                      <DayCell
                        key={dateStr}
                        collaborateur={collaborateur}
                        date={date}
                        isToday={isToday}
                        isWeekend={isWeekend}
                        isMonday={isMonday}
                        isFirstDay={isFirstDay}
                        isEvenRow={isEvenRow}
                        onCellClick={(periode, siteId) => handleCellClick(
                          collaborateur,
                          dateStr,
                          periode,
                          siteId
                        )}
                        isOnLeave={isOnLeave}
                      />
                    );
                  })}
                </tr>
              );
            })}

            {/* Message si aucun collaborateur */}
            {sortedCollaborateurs.length === 0 && (
              <tr>
                <td
                  colSpan={weekdaysOnly.length + 1}
                  className="text-center py-12 text-muted-foreground"
                >
                  Aucun collaborateur trouvé
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Dialogs */}
      {secretaireDialog && (
        <SecretaireDayActionsDialog
          open={secretaireDialog.open}
          onOpenChange={(open) => !open && setSecretaireDialog(null)}
          secretaireId={secretaireDialog.secretaireId}
          secretaireNom={secretaireDialog.secretaireNom}
          date={secretaireDialog.date}
          initialPeriode={secretaireDialog.periode}
          onRefresh={onRefresh || (() => {})}
        />
      )}

      {medecinDialog && (
        <MedecinActionsDialog
          open={medecinDialog.open}
          onOpenChange={(open) => !open && setMedecinDialog(null)}
          medecinId={medecinDialog.medecinId}
          medecinNom={medecinDialog.medecinNom}
          medecinPrenom={medecinDialog.medecinPrenom}
          date={medecinDialog.date}
          siteId={medecinDialog.siteId}
          periode={medecinDialog.periode}
          onRefresh={onRefresh || (() => {})}
        />
      )}
    </div>
  );
}
