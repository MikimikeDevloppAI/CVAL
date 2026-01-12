import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { useState, useRef, useEffect } from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Stethoscope, User, Plus, AlertCircle } from 'lucide-react';

// Types pour les opérations du bloc
export interface BlocAssistant {
  id: string;
  nom: string;
  prenom?: string;
  besoin_operation_id?: string;
  besoin_operation_nom?: string;
  besoin_operation_code?: string;
  is_1r?: boolean;
  is_2f?: boolean;
  is_3f?: boolean;
}

export interface BesoinPersonnel {
  besoin_operation_id: string;
  besoin_operation_nom: string;
  nombre_requis: number;
  nombre_assigne: number;
}

export interface BlocOperation {
  id: string;
  date: string;
  periode: 'matin' | 'apres_midi';
  medecin_id: string | null;
  medecin_nom: string;
  medecin_prenom?: string;
  type_intervention_id: string;
  type_intervention_nom: string;
  type_intervention_code: string;
  salle_id: string;
  salle_nom: string;
  assistants: BlocAssistant[];
  besoins_personnel?: BesoinPersonnel[];
}

export interface BlocSalle {
  id: string;
  nom: string;
  operations: BlocOperation[];
}

interface BlocOperatoireTableViewProps {
  salles: BlocSalle[];
  weekDays: Date[];
  onRefresh?: () => void;
  onAssignAssistant?: (params: {
    operationId: string;
    besoinOperationId: string;
    besoinOperationNom: string;
    date: string;
    periode: 'matin' | 'apres_midi';
    siteId: string;
    siteName: string;
  }) => void;
}

// Fonction pour générer les initiales
function getInitials(prenom: string | undefined, nom: string | undefined): string {
  const p = (prenom || '').trim();
  const n = (nom || '').trim();

  if (!p && !n) return '??';
  if (!p) return n.substring(0, 2).toUpperCase();
  if (!n) return p.substring(0, 2).toUpperCase();

  return `${p.charAt(0)}${n.charAt(0)}`.toUpperCase();
}

// Composant pour afficher une opération
function OperationCard({
  operation,
  onAssignClick,
}: {
  operation: BlocOperation;
  onAssignClick?: (besoinOperationId: string, besoinOperationNom: string) => void;
}) {
  const medecinInitials = getInitials(operation.medecin_prenom, operation.medecin_nom);
  const medecinFullName = `${operation.medecin_prenom || ''} ${operation.medecin_nom}`.trim();
  const periode = operation.periode;

  // Calculer les besoins non remplis
  const besoinsNonRemplis: BesoinPersonnel[] = (operation.besoins_personnel || []).filter(
    b => b.nombre_assigne < b.nombre_requis
  );

  return (
    <div className={cn(
      "flex flex-col gap-1.5 p-2 rounded-lg border",
      periode === 'matin'
        ? "bg-blue-50/80 border-blue-200 dark:bg-blue-950/50 dark:border-blue-800"
        : "bg-amber-50/80 border-amber-200 dark:bg-amber-950/50 dark:border-amber-800"
    )}>
      {/* En-tête: Type d'intervention + Salle */}
      <div className="flex items-center justify-between gap-2">
        <span className={cn(
          "text-[11px] font-bold truncate",
          periode === 'matin' ? "text-blue-700 dark:text-blue-300" : "text-amber-700 dark:text-amber-300"
        )}>
          {operation.type_intervention_nom}
        </span>
        <span className={cn(
          "text-[9px] font-medium px-1.5 py-0.5 rounded",
          periode === 'matin'
            ? "bg-blue-200/50 text-blue-600 dark:bg-blue-800/50 dark:text-blue-300"
            : "bg-amber-200/50 text-amber-600 dark:bg-amber-800/50 dark:text-amber-300"
        )}>
          {periode === 'matin' ? 'Matin' : 'AM'}
        </span>
      </div>

      {/* Médecin */}
      <div className="flex items-center gap-2 py-1 border-b border-border/30">
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className={cn(
                "flex items-center justify-center w-7 h-7 rounded-lg text-white text-[10px] font-bold",
                "bg-gradient-to-br from-teal-500 to-emerald-600 shadow-sm"
              )}>
                {medecinInitials}
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              <div className="flex items-center gap-2">
                <Stethoscope className="h-3 w-3 text-teal-500" />
                <span>{medecinFullName || 'Médecin non assigné'}</span>
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <div className="flex-1 min-w-0">
          <span className="text-[10px] font-medium text-foreground truncate block">
            {medecinFullName || 'Non assigné'}
          </span>
          <span className="text-[9px] text-muted-foreground">Chirurgien</span>
        </div>
      </div>

      {/* Assistants assignés */}
      {operation.assistants.length > 0 && (
        <div className="flex flex-col gap-1">
          {operation.assistants.map((assistant, idx) => {
            const assistantInitials = getInitials(assistant.prenom, assistant.nom);
            const assistantFullName = `${assistant.prenom || ''} ${assistant.nom}`.trim();
            const roleLabel = assistant.besoin_operation_nom ||
              (assistant.is_1r ? '1er Rôle' : assistant.is_2f ? '2ème Rôle' : assistant.is_3f ? '3ème Rôle' : 'Assistant');

            return (
              <div key={assistant.id + idx} className="flex items-center gap-2">
                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className={cn(
                        "flex items-center justify-center w-6 h-6 rounded-md text-white text-[9px] font-bold",
                        "bg-gradient-to-br from-cyan-500 to-blue-600 shadow-sm"
                      )}>
                        {assistantInitials}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      <div className="flex items-center gap-2">
                        <User className="h-3 w-3 text-cyan-500" />
                        <span>{assistantFullName}</span>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <div className="flex-1 min-w-0">
                  <span className="text-[9px] font-medium text-foreground truncate block">
                    {assistantFullName}
                  </span>
                  <span className="text-[8px] text-primary font-semibold">{roleLabel}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Besoins non remplis */}
      {besoinsNonRemplis.length > 0 && (
        <div className="flex flex-col gap-1 pt-1 border-t border-dashed border-destructive/30">
          {besoinsNonRemplis.map((besoin, idx) => {
            const manquants = besoin.nombre_requis - besoin.nombre_assigne;
            return (
              <div
                key={besoin.besoin_operation_id + idx}
                className="flex items-center gap-2 p-1.5 rounded-md bg-destructive/10 border border-dashed border-destructive/30 cursor-pointer hover:bg-destructive/20 transition-colors"
                onClick={() => onAssignClick?.(besoin.besoin_operation_id, besoin.besoin_operation_nom)}
              >
                <div className="flex items-center justify-center w-6 h-6 rounded-md border-2 border-dashed border-destructive/50 text-destructive">
                  <Plus className="h-3 w-3" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-[9px] font-medium text-destructive truncate block">
                    {besoin.besoin_operation_nom}
                  </span>
                  <span className="text-[8px] text-destructive/70">
                    {manquants} manquant{manquants > 1 ? 's' : ''}
                  </span>
                </div>
                <AlertCircle className="h-3 w-3 text-destructive/70" />
              </div>
            );
          })}
        </div>
      )}

      {/* Placeholder si pas d'assistants et pas de besoins */}
      {operation.assistants.length === 0 && besoinsNonRemplis.length === 0 && (
        <span className="text-[9px] text-muted-foreground/50 italic py-1">
          Aucun assistant requis
        </span>
      )}
    </div>
  );
}

// Composant pour une cellule de jour
function DayCell({
  salle,
  date,
  isToday,
  isWeekend,
  isMonday,
  isFirstDay,
  isEvenRow,
  onAssignAssistant,
}: {
  salle: BlocSalle;
  date: Date;
  isToday: boolean;
  isWeekend: boolean;
  isMonday: boolean;
  isFirstDay: boolean;
  isEvenRow: boolean;
  onAssignAssistant?: (params: {
    operationId: string;
    besoinOperationId: string;
    besoinOperationNom: string;
    date: string;
    periode: 'matin' | 'apres_midi';
    siteId: string;
    siteName: string;
  }) => void;
}) {
  const dateStr = format(date, 'yyyy-MM-dd');

  // Trouver les opérations pour ce jour, triées par période
  const operations = salle.operations
    .filter(op => op.date === dateStr)
    .sort((a, b) => {
      if (a.periode === 'matin' && b.periode === 'apres_midi') return -1;
      if (a.periode === 'apres_midi' && b.periode === 'matin') return 1;
      return 0;
    });

  return (
    <td
      className={cn(
        "p-1.5 align-top transition-all duration-200 min-w-[220px]",
        // Séparateur de semaine
        isMonday && !isFirstDay ? "border-l-4 border-l-primary/30" : "border-l border-border/30",
        // Alternance de couleur fond
        isEvenRow
          ? "bg-white dark:bg-slate-900"
          : "bg-slate-100 dark:bg-slate-800",
        isWeekend && (isEvenRow
          ? "bg-slate-50 dark:bg-slate-900/50"
          : "bg-slate-200 dark:bg-slate-700/80"),
        "hover:bg-accent/30"
      )}
    >
      <div className="flex flex-col gap-2 min-h-[80px]">
        {operations.map(op => (
          <OperationCard
            key={op.id}
            operation={op}
            onAssignClick={(besoinOperationId, besoinOperationNom) => {
              onAssignAssistant?.({
                operationId: op.id,
                besoinOperationId,
                besoinOperationNom,
                date: dateStr,
                periode: op.periode,
                siteId: salle.id,
                siteName: salle.nom,
              });
            }}
          />
        ))}

        {/* Placeholder si vide */}
        {operations.length === 0 && (
          <div className="flex items-center justify-center h-full min-h-[60px]">
            <span className="text-[10px] text-muted-foreground/40">—</span>
          </div>
        )}
      </div>
    </td>
  );
}

export function BlocOperatoireTableView({
  salles,
  weekDays,
  onRefresh,
  onAssignAssistant,
}: BlocOperatoireTableViewProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Filtrer les dimanches
  const weekdaysOnly = weekDays.filter(d => d.getDay() !== 0);

  // Filtrer les salles pour exclure gastroentérologie
  const filteredSalles = salles.filter(salle => {
    const nomLower = salle.nom.toLowerCase();
    return !nomLower.includes('gastro') && !nomLower.includes('gastroentérologie');
  });

  // Auto-scroll vers aujourd'hui au chargement
  useEffect(() => {
    // Attendre que les données soient chargées
    if (filteredSalles.length === 0) return;

    const timeoutId = setTimeout(() => {
      if (scrollContainerRef.current && weekdaysOnly.length > 0) {
        const todayStr = format(new Date(), 'yyyy-MM-dd');
        const todayIndex = weekdaysOnly.findIndex(d => format(d, 'yyyy-MM-dd') === todayStr);

        if (todayIndex >= 0) {
          const columnWidth = 220;
          const scrollPosition = todayIndex * columnWidth;

          // Scroll pour que aujourd'hui soit le premier jour visible (à gauche)
          scrollContainerRef.current.scrollTo({
            left: Math.max(0, scrollPosition),
            behavior: 'auto'
          });
        }
      }
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [weekdaysOnly.length, filteredSalles.length]);

  // Trier les salles par nom
  const sortedSalles = [...filteredSalles].sort((a, b) =>
    a.nom.localeCompare(b.nom, 'fr')
  );

  return (
    <div className="h-full overflow-hidden">
      <div
        ref={scrollContainerRef}
        className="overflow-auto rounded-2xl border border-border/40 bg-card/30 backdrop-blur-xl shadow-xl max-h-full"
      >
        <table className="w-max border-collapse">
          <thead className="sticky top-0 z-30">
            <tr className="border-b border-border/40">
              <th className="sticky left-0 z-40 bg-card min-w-[140px] max-w-[140px] border-r border-border/30 py-4 px-4 text-left">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Salle
                </span>
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
                      "text-center min-w-[220px] py-2",
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
            {sortedSalles.map((salle, salleIndex) => {
              const isEvenRow = salleIndex % 2 === 0;

              return (
                <tr
                  key={salle.id}
                  className="border-b border-border/50 transition-colors"
                >
                  <td className={cn(
                    "sticky left-0 z-10 border-r-2 border-border/50 py-3 px-4 min-w-[140px] max-w-[140px]",
                    isEvenRow ? "bg-white dark:bg-slate-900" : "bg-slate-100 dark:bg-slate-800"
                  )}>
                    <span className="font-semibold text-sm text-foreground leading-tight block">
                      {salle.nom}
                    </span>
                  </td>
                  {weekdaysOnly.map((date, dayIndex) => {
                    const isToday = format(date, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');
                    const dayOfWeek = date.getDay();
                    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                    const isMonday = dayOfWeek === 1;
                    const isFirstDay = dayIndex === 0;

                    return (
                      <DayCell
                        key={format(date, 'yyyy-MM-dd')}
                        salle={salle}
                        date={date}
                        isToday={isToday}
                        isWeekend={isWeekend}
                        isMonday={isMonday}
                        isFirstDay={isFirstDay}
                        isEvenRow={isEvenRow}
                        onAssignAssistant={onAssignAssistant}
                      />
                    );
                  })}
                </tr>
              );
            })}

            {/* Message si aucune salle */}
            {sortedSalles.length === 0 && (
              <tr>
                <td
                  colSpan={weekdaysOnly.length + 1}
                  className="text-center py-12 text-muted-foreground"
                >
                  Aucune salle d'opération configurée
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
