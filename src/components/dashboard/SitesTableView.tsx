import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { DashboardSite } from '@/pages/DashboardPage';
// Table HTML native utilisée pour le sticky header
import { User, Stethoscope, Plus, UserX } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState, useMemo, useRef, useEffect } from 'react';
import { MedecinActionsDialog } from './MedecinActionsDialog';
import { SecretaireDayActionsDialog } from './SecretaireDayActionsDialog';
import { AddMedecinToDayDialog } from './AddMedecinToDayDialog';
import { ReassignMedecinDialog } from './ReassignMedecinDialog';
import { AddSecretaireToDayDialog } from './AddSecretaireToDayDialog';
import { ReassignSecretaireDialog } from './ReassignSecretaireDialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { DraggablePersonAvatar, DragData } from './DraggablePersonAvatar';
import { PeriodSelectionDialog } from './PeriodSelectionDialog';
import { BesoinOperatoireSelectionDialog } from './BesoinOperatoireSelectionDialog';
import { TypeInterventionSelectionDialog } from './TypeInterventionSelectionDialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface AbsenceInfo {
  id: string;
  nom: string;
  type: 'medecin' | 'assistant';
}

interface SitesTableViewProps {
  sites: DashboardSite[];
  weekDays: Date[];
  onDayClick?: (siteId: string, date: string) => void;
  onRefresh?: () => void;
  absencesByDate?: Record<string, AbsenceInfo[]>;
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

// Fonction pour gérer les doublons d'initiales
function getUniqueInitials(
  prenom: string | undefined,
  nom: string | undefined,
  allPeople: Array<{ prenom?: string; nom?: string; id: string }>,
  currentId: string
): string {
  const baseInitials = getInitials(prenom, nom);

  // Compter combien de personnes ont les mêmes initiales
  const duplicates = allPeople.filter(p =>
    p.id !== currentId && getInitials(p.prenom, p.nom) === baseInitials
  );

  if (duplicates.length === 0) {
    return baseInitials;
  }

  // S'il y a des doublons, utiliser les deux premières lettres du nom
  const n = (nom || '').trim();
  if (n.length >= 2) {
    const p = (prenom || '').trim();
    return `${p.charAt(0)}${n.substring(0, 2)}`.toUpperCase();
  }

  return baseInitials;
}

// Composant Avatar avec initiales - contour indique la période
interface PersonAvatarProps {
  initials: string;
  fullName: string;
  type: 'medecin' | 'assistant';
  period: 'matin' | 'apres_midi' | 'journee';
  onClick?: (e: React.MouseEvent) => void;
  tags?: string[];
}

function PersonAvatar({ initials, fullName, type, period, onClick, tags }: PersonAvatarProps) {
  // Couleurs différentes pour médecins (vert teal) et assistants (cyan)
  const typeColors = {
    medecin: 'from-teal-500 to-emerald-600 shadow-teal-500/25',
    assistant: 'from-cyan-500 to-blue-600 shadow-cyan-500/25',
  };

  // Couleurs des points pour les périodes - bien visibles
  const periodDotColors = {
    matin: 'bg-blue-500 ring-2 ring-blue-500/40',
    apres_midi: 'bg-amber-500 ring-2 ring-amber-500/40',
    journee: 'bg-emerald-500 ring-2 ring-emerald-500/40',
  };

  const periodLabels = {
    matin: 'Matin',
    apres_midi: 'Après-midi',
    journee: 'Journée',
  };

  const hasTags = tags && tags.length > 0;

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onClick}
            className={cn(
              "relative flex items-center justify-center text-white text-[10px] font-bold",
              "bg-gradient-to-br shadow-md transition-all duration-200",
              "hover:scale-110 hover:shadow-lg hover:-translate-y-0.5",
              "focus:outline-none",
              typeColors[type],
              hasTags ? "w-auto min-w-[32px] h-8 rounded-lg px-1.5 gap-1" : "w-8 h-8 rounded-lg"
            )}
          >
            <span>{initials}</span>
            {hasTags && (
              <span className="text-[8px] font-black text-white/90 bg-white/20 px-1 py-0.5 rounded">
                {tags.join(' ')}
              </span>
            )}
            {/* Point indicateur de période - en bas à droite, bien visible */}
            <div className={cn(
              "absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-background",
              periodDotColors[period]
            )} />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="bg-card/95 backdrop-blur-xl border border-border/50 shadow-xl px-3 py-2"
        >
          <div className="flex flex-col gap-1">
            <span className="font-semibold text-foreground">{fullName}</span>
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

// Composant pour le bouton d'ajout
function AddButton({ onAddMedecin, onReassignMedecin, onAddAssistant, onReassignAssistant }: {
  onAddMedecin: () => void;
  onReassignMedecin: () => void;
  onAddAssistant: () => void;
  onReassignAssistant: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className={cn(
            "w-7 h-7 rounded-lg border-2 border-dashed border-border/40",
            "text-muted-foreground/50 hover:text-foreground",
            "hover:border-primary/40 hover:bg-primary/5",
            "transition-all duration-200",
            "opacity-0 group-hover:opacity-100"
          )}
        >
          <Plus className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 z-[100]">
        <DropdownMenuItem onClick={onAddMedecin}>
          <Stethoscope className="h-4 w-4 mr-2 text-teal-500" />
          Ajouter médecin
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onReassignMedecin}>
          <Stethoscope className="h-4 w-4 mr-2 text-teal-500" />
          Réaffecter médecin
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onAddAssistant}>
          <User className="h-4 w-4 mr-2 text-cyan-500" />
          Ajouter assistant
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onReassignAssistant}>
          <User className="h-4 w-4 mr-2 text-cyan-500" />
          Réaffecter assistant
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Composant Avatar pour les absences - garde la couleur du type avec un indicateur rouge
interface AbsenceAvatarProps {
  initials: string;
  fullName: string;
  type: 'medecin' | 'assistant';
}

function AbsenceAvatar({ initials, fullName, type }: AbsenceAvatarProps) {
  // Même couleurs que PersonAvatar selon le type
  const typeColors = {
    medecin: 'from-teal-500 to-emerald-600 shadow-teal-500/25',
    assistant: 'from-cyan-500 to-blue-600 shadow-cyan-500/25',
  };

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              "relative flex items-center justify-center text-white text-[10px] font-bold",
              "w-8 h-8 rounded-lg shadow-md bg-gradient-to-br",
              typeColors[type]
            )}
          >
            <span>{initials}</span>
            {/* Point rouge pour indiquer l'absence */}
            <div className="absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-background bg-red-500 ring-2 ring-red-500/40" />
          </div>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="bg-card/95 backdrop-blur-xl border border-border/50 shadow-xl px-3 py-2"
        >
          <div className="flex flex-col gap-1">
            <span className="font-semibold text-foreground">{fullName}</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-red-500/15 text-red-600 dark:text-red-400">
              {type === 'medecin' ? 'Médecin absent' : 'Assistant absent'}
            </span>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function SitesTableView({ sites, weekDays, onDayClick, onRefresh, absencesByDate = {} }: SitesTableViewProps) {
  // État local pour mise à jour optimiste (évite le rechargement complet)
  const [localSites, setLocalSites] = useState<DashboardSite[]>(sites);

  // Ref pour savoir si on a une opération drag en cours (éviter sync pendant drag)
  const isDraggingRef = useRef(false);
  const hasOptimisticUpdate = useRef(false);

  // Synchroniser avec les props quand elles changent (ex: changement de mois)
  // Mais pas si on a fait une mise à jour optimiste récemment
  useEffect(() => {
    if (!hasOptimisticUpdate.current) {
      setLocalSites(sites);
    }
  }, [sites]);

  const [medecinActionsDialog, setMedecinActionsDialog] = useState<{
    open: boolean;
    medecinId: string;
    medecinNom: string;
    medecinPrenom: string;
    date: string;
    siteId: string;
    periode: 'matin' | 'apres_midi' | 'journee';
  }>({
    open: false,
    medecinId: '',
    medecinNom: '',
    medecinPrenom: '',
    date: '',
    siteId: '',
    periode: 'matin',
  });

  const [secretaireActionsDialog, setSecretaireActionsDialog] = useState<{
    open: boolean;
    secretaireId: string;
    secretaireNom: string;
    date: string;
    periode: 'matin' | 'apres_midi' | 'journee';
  }>({
    open: false,
    secretaireId: '',
    secretaireNom: '',
    date: '',
    periode: 'matin',
  });

  const [addMedecinDialog, setAddMedecinDialog] = useState({
    open: false,
    date: '',
    siteId: '',
  });

  const [reassignMedecinDialog, setReassignMedecinDialog] = useState({
    open: false,
    date: '',
    siteId: '',
    siteName: '',
  });

  const [addSecretaireDialog, setAddSecretaireDialog] = useState({
    open: false,
    date: '',
    siteId: '',
    siteName: '',
  });

  const [reassignSecretaireDialog, setReassignSecretaireDialog] = useState({
    open: false,
    date: '',
    siteId: '',
    siteName: '',
  });

  // États pour le drag and drop
  const [dragOverCell, setDragOverCell] = useState<{ siteId: string; date: string } | null>(null);
  const [currentDragData, setCurrentDragData] = useState<DragData | null>(null);

  const [periodDialog, setPeriodDialog] = useState<{
    open: boolean;
    dragData: DragData | null;
    targetSiteId: string;
    targetSiteName: string;
    isOperationRoom: boolean;
  }>({
    open: false,
    dragData: null,
    targetSiteId: '',
    targetSiteName: '',
    isOperationRoom: false,
  });

  const [besoinDialog, setBesoinDialog] = useState<{
    open: boolean;
    dragData: DragData | null;
    targetSiteId: string;
    targetSiteName: string;
    period: 'matin' | 'apres_midi';
  }>({
    open: false,
    dragData: null,
    targetSiteId: '',
    targetSiteName: '',
    period: 'matin',
  });

  const [typeInterventionDialog, setTypeInterventionDialog] = useState<{
    open: boolean;
    dragData: DragData | null;
    targetSiteId: string;
    targetSiteName: string;
    period: 'matin' | 'apres_midi';
  }>({
    open: false,
    dragData: null,
    targetSiteId: '',
    targetSiteName: '',
    period: 'matin',
  });

  // Collecter tous les médecins et assistants pour gérer les doublons d'initiales
  const allPeople = useMemo(() => {
    const people: Array<{ prenom?: string; nom?: string; id: string; type: 'medecin' | 'assistant' }> = [];

    localSites.forEach(site => {
      site.days.forEach(day => {
        day.medecins.forEach(m => {
          if (!people.find(p => p.id === m.id)) {
            people.push({ prenom: m.prenom, nom: m.nom, id: m.id, type: 'medecin' });
          }
        });
        day.secretaires.forEach(s => {
          if (!people.find(p => p.id === s.id)) {
            people.push({ prenom: s.prenom, nom: s.nom, id: s.id, type: 'assistant' });
          }
        });
      });
    });

    return people;
  }, [localSites]);

  // Ref pour le container scrollable
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Filtrer les dimanches et garder les samedis seulement s'il y a des besoins
  const weekdaysOnly = weekDays.filter(d => {
    const dow = d.getDay();
    if (dow === 0) return false;

    if (dow === 6) {
      const dateStr = format(d, 'yyyy-MM-dd');
      return localSites.some(site => {
        const dayData = site.days.find(day => day.date === dateStr);
        return dayData && (dayData.medecins.length > 0 || dayData.secretaires.length > 0);
      });
    }

    return true;
  });

  // Auto-scroll vers aujourd'hui au chargement
  useEffect(() => {
    // Attendre que les données soient chargées
    if (localSites.length === 0) return;

    const timeoutId = setTimeout(() => {
      if (scrollContainerRef.current && weekdaysOnly.length > 0) {
        const todayStr = format(new Date(), 'yyyy-MM-dd');
        const todayIndex = weekdaysOnly.findIndex(d => format(d, 'yyyy-MM-dd') === todayStr);

        if (todayIndex >= 0) {
          const columnWidth = 180; // min-w-[180px]

          // Scroll pour que aujourd'hui soit le premier jour visible (à gauche)
          const scrollPosition = todayIndex * columnWidth;

          scrollContainerRef.current.scrollTo({
            left: Math.max(0, scrollPosition),
            behavior: 'auto'
          });
        }
      }
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [weekdaysOnly.length, localSites.length]);

  const getDayData = (site: DashboardSite, date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    return site.days.find(d => d.date === dateStr);
  };

  // Fonctions pour le drag and drop
  const isSalleOperation = (siteName: string): boolean => {
    const salles = ['salle rouge', 'salle verte', 'salle jaune', 'salle vert'];
    return salles.some(s => siteName.toLowerCase().includes(s));
  };

  const handleDragOver = (e: React.DragEvent, siteId: string, date: string) => {
    e.preventDefault();

    // Vérifier si on peut drop ici (même jour uniquement)
    try {
      const dragDataStr = e.dataTransfer.types.includes('application/json') ? 'valid' : null;
      if (dragDataStr && currentDragData) {
        // Vérifier que c'est le même jour
        if (currentDragData.date === date && currentDragData.sourceSiteId !== siteId) {
          e.dataTransfer.dropEffect = 'move';
          setDragOverCell({ siteId, date });
        } else {
          e.dataTransfer.dropEffect = 'none';
        }
      }
    } catch {
      // Ignore
    }
  };

  const handleDragEnter = (e: React.DragEvent, siteId: string, date: string) => {
    e.preventDefault();
    if (currentDragData && currentDragData.date === date && currentDragData.sourceSiteId !== siteId) {
      setDragOverCell({ siteId, date });
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    // Ne pas réinitialiser immédiatement pour éviter le clignotement
    const relatedTarget = e.relatedTarget as HTMLElement;
    if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
      setDragOverCell(null);
    }
  };

  const handleDrop = async (e: React.DragEvent, targetSiteId: string, targetSiteName: string, targetDate: string) => {
    e.preventDefault();
    setDragOverCell(null);

    try {
      const dragDataStr = e.dataTransfer.getData('application/json');
      if (!dragDataStr) return;

      const dragData: DragData = JSON.parse(dragDataStr);

      // 1. Vérifier que c'est le même jour
      if (dragData.date !== targetDate) {
        toast.error('Vous ne pouvez déplacer que sur le même jour');
        return;
      }

      // 2. Vérifier que ce n'est pas le même site
      if (dragData.sourceSiteId === targetSiteId) return;

      // 3. Détecter si c'est une salle d'opération
      const isOperationRoom = isSalleOperation(targetSiteName);

      // 4. Si journée entière → demander la période
      if (dragData.period === 'journee') {
        setPeriodDialog({
          open: true,
          dragData,
          targetSiteId,
          targetSiteName,
          isOperationRoom,
        });
        return;
      }

      // 5. Si salle d'opération + assistant → demander le besoin opératoire
      if (isOperationRoom && dragData.personType === 'assistant') {
        setBesoinDialog({
          open: true,
          dragData,
          targetSiteId,
          targetSiteName,
          period: dragData.period as 'matin' | 'apres_midi',
        });
        return;
      }

      // 6. Si salle d'opération + médecin → demander le type d'intervention
      if (isOperationRoom && dragData.personType === 'medecin') {
        setTypeInterventionDialog({
          open: true,
          dragData,
          targetSiteId,
          targetSiteName,
          period: dragData.period as 'matin' | 'apres_midi',
        });
        return;
      }

      // 7. Sinon, exécuter le déplacement directement
      await executeMove(dragData, targetSiteId, dragData.period);
    } catch (err) {
      console.error('Erreur lors du drop:', err);
      toast.error('Erreur lors du déplacement');
    }
  };

  // Fonction de mise à jour optimiste de l'état local
  const updateLocalSitesOptimistic = (
    dragData: DragData,
    targetSiteId: string,
    period: 'matin' | 'apres_midi' | 'journee'
  ) => {
    // Marquer qu'on a fait une mise à jour optimiste pour éviter le reset par useEffect
    hasOptimisticUpdate.current = true;
    // Réinitialiser après un délai (permettre la synchronisation normale après)
    setTimeout(() => {
      hasOptimisticUpdate.current = false;
    }, 5000);

    setLocalSites(prevSites => {
      return prevSites.map(site => {
        const dayIndex = site.days.findIndex(d => d.date === dragData.date);
        if (dayIndex === -1) return site;

        const isSourceSite = site.site_id === dragData.sourceSiteId;
        const isTargetSite = site.site_id === targetSiteId;

        if (!isSourceSite && !isTargetSite) return site;

        // Créer une copie profonde du jour
        const day = {
          ...site.days[dayIndex],
          medecins: site.days[dayIndex].medecins.map(m => ({ ...m })),
          secretaires: site.days[dayIndex].secretaires.map(s => ({ ...s })),
        };

        const periodsToUpdate = period === 'journee' ? ['matin', 'apres_midi'] : [period];

        if (dragData.personType === 'medecin') {
          if (isSourceSite) {
            // Retirer le médecin du site source (avec copie)
            day.medecins = day.medecins.reduce((acc, m) => {
              if (m.id !== dragData.personId) {
                acc.push(m);
                return acc;
              }
              // Si on déplace seulement une demi-journée, garder l'autre
              const updatedMedecin = { ...m };
              if (period === 'matin') {
                updatedMedecin.matin = false;
                if (updatedMedecin.apres_midi) acc.push(updatedMedecin);
              } else if (period === 'apres_midi') {
                updatedMedecin.apres_midi = false;
                if (updatedMedecin.matin) acc.push(updatedMedecin);
              }
              // Journée entière - ne pas ajouter (retirer complètement)
              return acc;
            }, [] as typeof day.medecins);
          }
          if (isTargetSite) {
            // Ajouter le médecin au site cible
            const existingIndex = day.medecins.findIndex(m => m.id === dragData.personId);
            if (existingIndex >= 0) {
              // Mettre à jour les périodes
              const updated = { ...day.medecins[existingIndex] };
              if (periodsToUpdate.includes('matin')) updated.matin = true;
              if (periodsToUpdate.includes('apres_midi')) updated.apres_midi = true;
              day.medecins[existingIndex] = updated;
            } else {
              // Ajouter nouveau
              const nameParts = dragData.personName.split(' ');
              day.medecins.push({
                id: dragData.personId,
                nom: nameParts.slice(1).join(' ') || dragData.personName,
                prenom: nameParts[0] || '',
                nom_complet: dragData.personName,
                matin: periodsToUpdate.includes('matin'),
                apres_midi: periodsToUpdate.includes('apres_midi'),
              });
            }
          }
        } else {
          // Assistant
          if (isSourceSite) {
            day.secretaires = day.secretaires.reduce((acc, s) => {
              if (s.id !== dragData.personId) {
                acc.push(s);
                return acc;
              }
              const updatedSecretaire = { ...s };
              if (period === 'matin') {
                updatedSecretaire.matin = false;
                if (updatedSecretaire.apres_midi) acc.push(updatedSecretaire);
              } else if (period === 'apres_midi') {
                updatedSecretaire.apres_midi = false;
                if (updatedSecretaire.matin) acc.push(updatedSecretaire);
              }
              return acc;
            }, [] as typeof day.secretaires);
          }
          if (isTargetSite) {
            const existingIndex = day.secretaires.findIndex(s => s.id === dragData.personId);
            if (existingIndex >= 0) {
              const updated = { ...day.secretaires[existingIndex] };
              if (periodsToUpdate.includes('matin')) updated.matin = true;
              if (periodsToUpdate.includes('apres_midi')) updated.apres_midi = true;
              day.secretaires[existingIndex] = updated;
            } else {
              const nameParts = dragData.personName.split(' ');
              day.secretaires.push({
                id: dragData.personId,
                nom: nameParts.slice(1).join(' ') || dragData.personName,
                prenom: nameParts[0] || '',
                nom_complet: dragData.personName,
                matin: periodsToUpdate.includes('matin'),
                apres_midi: periodsToUpdate.includes('apres_midi'),
                is_1r: dragData.is1R,
                is_2f: dragData.is2F,
                is_3f: dragData.is3F,
              });
            }
          }
        }

        const newDays = [...site.days];
        newDays[dayIndex] = day;
        return { ...site, days: newDays };
      });
    });
  };

  // Fonction de mise à jour optimiste des flags 1R/2F/3F
  const updateLocalFlagsOptimistic = (
    secretaireId: string,
    date: string,
    flag: '1R' | '2F' | '3F',
    value: boolean
  ) => {
    // Marquer qu'on a fait une mise à jour optimiste pour éviter le reset par useEffect
    hasOptimisticUpdate.current = true;
    setTimeout(() => {
      hasOptimisticUpdate.current = false;
    }, 5000);

    setLocalSites(prevSites => {
      return prevSites.map(site => {
        const dayIndex = site.days.findIndex(d => d.date === date);
        if (dayIndex === -1) return site;

        const day = site.days[dayIndex];
        const secretaireIndex = day.secretaires.findIndex(s => s.id === secretaireId);
        if (secretaireIndex === -1) return site;

        // Créer une copie profonde du jour avec les secretaires mis à jour
        const newSecretaires = day.secretaires.map((s, idx) => {
          if (idx !== secretaireIndex) return s;
          return {
            ...s,
            is_1r: flag === '1R' ? value : s.is_1r,
            is_2f: flag === '2F' ? value : s.is_2f,
            is_3f: flag === '3F' ? value : s.is_3f,
          };
        });

        const newDay = {
          ...day,
          secretaires: newSecretaires,
        };

        const newDays = [...site.days];
        newDays[dayIndex] = newDay;
        return { ...site, days: newDays };
      });
    });
  };

  const executeMove = async (
    dragData: DragData,
    targetSiteId: string,
    period: 'matin' | 'apres_midi' | 'journee',
    besoinOperationId?: string,
    typeInterventionId?: string
  ) => {
    const periods = period === 'journee' ? ['matin', 'apres_midi'] : [period];

    // Mise à jour optimiste immédiate (pas de rechargement)
    updateLocalSitesOptimistic(dragData, targetSiteId, period);
    toast.success(`${dragData.personName} déplacé avec succès`);

    try {
      if (dragData.personType === 'medecin') {
        // Supprimer les anciennes assignations
        await supabase
          .from('besoin_effectif')
          .delete()
          .eq('medecin_id', dragData.personId)
          .eq('date', dragData.date)
          .eq('site_id', dragData.sourceSiteId)
          .in('demi_journee', periods);

        // Créer les nouvelles assignations
        const inserts = periods.map(p => ({
          date: dragData.date,
          type: 'medecin',
          medecin_id: dragData.personId,
          site_id: targetSiteId,
          demi_journee: p,
          type_intervention_id: typeInterventionId || null,
          actif: true,
        }));

        await supabase.from('besoin_effectif').insert(inserts);
      } else {
        // Assistant
        await supabase
          .from('capacite_effective')
          .delete()
          .eq('secretaire_id', dragData.personId)
          .eq('date', dragData.date)
          .eq('site_id', dragData.sourceSiteId)
          .in('demi_journee', periods);

        const inserts = periods.map(p => ({
          date: dragData.date,
          secretaire_id: dragData.personId,
          site_id: targetSiteId,
          demi_journee: p,
          besoin_operation_id: besoinOperationId || null,
          is_1r: dragData.is1R || false,
          is_2f: dragData.is2F || false,
          is_3f: dragData.is3F || false,
          actif: true,
        }));

        await supabase.from('capacite_effective').insert(inserts);
      }

      // Pas de onRefresh - la mise à jour optimiste suffit
    } catch (err) {
      console.error('Erreur lors du déplacement:', err);
      toast.error('Erreur lors de la sauvegarde - rechargement...');
      // En cas d'erreur, on recharge pour rétablir l'état correct
      onRefresh?.();
    }
  };

  // Handlers pour les dialogs
  const handlePeriodSelected = async (selectedPeriod: 'journee' | 'matin' | 'apres_midi') => {
    if (!periodDialog.dragData) return;

    const { dragData, targetSiteId, targetSiteName, isOperationRoom } = periodDialog;

    // Si salle d'opération, on doit demander le besoin/type d'intervention
    if (isOperationRoom) {
      if (dragData.personType === 'assistant') {
        setBesoinDialog({
          open: true,
          dragData: { ...dragData, period: selectedPeriod },
          targetSiteId,
          targetSiteName,
          period: selectedPeriod === 'journee' ? 'matin' : selectedPeriod,
        });
      } else {
        setTypeInterventionDialog({
          open: true,
          dragData: { ...dragData, period: selectedPeriod },
          targetSiteId,
          targetSiteName,
          period: selectedPeriod === 'journee' ? 'matin' : selectedPeriod,
        });
      }
    } else {
      await executeMove(dragData, targetSiteId, selectedPeriod);
    }
  };

  const handleBesoinSelected = async (besoinOperationId: string) => {
    if (!besoinDialog.dragData) return;
    await executeMove(
      besoinDialog.dragData,
      besoinDialog.targetSiteId,
      besoinDialog.dragData.period,
      besoinOperationId
    );
  };

  const handleTypeInterventionSelected = async (typeInterventionId: string) => {
    if (!typeInterventionDialog.dragData) return;
    await executeMove(
      typeInterventionDialog.dragData,
      typeInterventionDialog.targetSiteId,
      typeInterventionDialog.dragData.period,
      undefined,
      typeInterventionId
    );
  };

  // Fonction pour fusionner deux sites
  const mergeSites = (site1: DashboardSite, site2: DashboardSite, newName: string): DashboardSite => {
    const mergedDays = weekdaysOnly.map(date => {
      const dateStr = format(date, 'yyyy-MM-dd');
      const day1 = site1.days.find(d => d.date === dateStr);
      const day2 = site2.days.find(d => d.date === dateStr);

      if (!day1 && !day2) {
        return {
          date: dateStr,
          medecins: [],
          secretaires: [],
          besoin_secretaires_matin: 0,
          besoin_secretaires_apres_midi: 0,
          status_matin: 'satisfait' as const,
          status_apres_midi: 'satisfait' as const,
        };
      }

      return {
        date: dateStr,
        medecins: [...(day1?.medecins || []), ...(day2?.medecins || [])],
        secretaires: [...(day1?.secretaires || []), ...(day2?.secretaires || [])],
        besoin_secretaires_matin: (day1?.besoin_secretaires_matin || 0) + (day2?.besoin_secretaires_matin || 0),
        besoin_secretaires_apres_midi: (day1?.besoin_secretaires_apres_midi || 0) + (day2?.besoin_secretaires_apres_midi || 0),
        status_matin: (day1?.status_matin === 'non_satisfait' || day2?.status_matin === 'non_satisfait')
          ? 'non_satisfait' as const
          : (day1?.status_matin === 'partiel' || day2?.status_matin === 'partiel')
            ? 'partiel' as const
            : 'satisfait' as const,
        status_apres_midi: (day1?.status_apres_midi === 'non_satisfait' || day2?.status_apres_midi === 'non_satisfait')
          ? 'non_satisfait' as const
          : (day1?.status_apres_midi === 'partiel' || day2?.status_apres_midi === 'partiel')
            ? 'partiel' as const
            : 'satisfait' as const,
      };
    });

    return {
      site_id: site1.site_id,
      site_nom: newName,
      fermeture: site1.fermeture || site2.fermeture,
      site_fermeture: site1.site_fermeture || site2.site_fermeture,
      days: mergedDays,
    };
  };

  // Regrouper les sites gastro
  const processedSites = (() => {
    const sitesBlocGastro = localSites.filter(s =>
      s.site_nom.toLowerCase().includes('bloc') &&
      s.site_nom.toLowerCase().includes('gastro')
    );
    const sitesVieilleVille = localSites.filter(s =>
      s.site_nom.toLowerCase().includes('vieille ville') &&
      s.site_nom.toLowerCase().includes('gastro')
    );
    const otherSites = localSites.filter(s =>
      !sitesBlocGastro.includes(s) &&
      !sitesVieilleVille.includes(s)
    );

    let result = [...otherSites];

    if (sitesBlocGastro.length > 0 && sitesVieilleVille.length > 0) {
      const merged = mergeSites(sitesBlocGastro[0], sitesVieilleVille[0], 'Gastroentérologie');
      result.push(merged);
    } else if (sitesBlocGastro.length > 0) {
      result.push(sitesBlocGastro[0]);
    } else if (sitesVieilleVille.length > 0) {
      result.push(sitesVieilleVille[0]);
    }

    return result.sort((a, b) => a.site_nom.localeCompare(b.site_nom, 'fr'));
  })();

  // Filtrer les sites qui ont au moins un médecin ou secrétaire sur la semaine
  // Exception: toujours afficher les salles d'opération (Salle rouge/verte/jaune) mais PAS gastro
  const filteredSites = processedSites.filter(site => {
    const siteLower = site.site_nom.toLowerCase();

    // Toujours afficher les salles d'opération (sauf gastro qui est déjà fusionné)
    const isSalleOperation =
      siteLower.includes('salle rouge') ||
      siteLower.includes('salle verte') ||
      siteLower.includes('salle jaune') ||
      siteLower.includes('salle vert');

    if (isSalleOperation) {
      return true; // Toujours afficher les salles d'opération
    }

    // Pour les autres sites, afficher seulement s'ils ont du personnel
    const hasSomePersonnel = site.days.some(day =>
      day.medecins.length > 0 || day.secretaires.length > 0
    );
    return hasSomePersonnel;
  });

  return (
    <div className="h-full overflow-hidden">
      {/* Table scrollable */}
      <div ref={scrollContainerRef} className="overflow-auto rounded-2xl border border-border/40 bg-card/30 backdrop-blur-xl shadow-xl max-h-full">
        <table className="w-max border-collapse">
          <thead className="sticky top-0 z-30">
            <tr className="border-b border-border/40">
              <th className="sticky left-0 z-40 bg-card min-w-[140px] max-w-[140px] border-r border-border/30 py-4 px-4 text-left">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Site</span>
              </th>
              {weekdaysOnly.map((date, index) => {
                const isToday = format(date, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');
                const dayOfWeek = date.getDay();
                const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                // Lundi = début de semaine (séparateur épais)
                const isMonday = dayOfWeek === 1;
                const isFirstDay = index === 0;
                return (
                  <th
                    key={format(date, 'yyyy-MM-dd')}
                    className={cn(
                      "text-center min-w-[180px] py-2",
                      // Séparateur de semaine (bordure épaisse à gauche du lundi)
                      isMonday && !isFirstDay ? "border-l-4 border-l-primary/30" : "border-l border-border/30",
                      isToday ? "bg-primary" : "bg-card",
                      isWeekend && !isToday && "bg-muted/50"
                    )}
                  >
                    <div className={cn(
                      "flex flex-col items-center gap-0 px-2 py-1 rounded-xl transition-colors"
                    )}>
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
            {filteredSites.map((site, siteIndex) => {
              const isEvenRow = siteIndex % 2 === 0;
              return (
                <tr
                  key={site.site_id}
                  className="border-b border-border/50 transition-colors"
                >
                  <td className={cn(
                    "sticky left-0 z-10 border-r-2 border-border/50 py-3 px-4 min-w-[140px] max-w-[140px]",
                    isEvenRow ? "bg-white dark:bg-slate-900" : "bg-slate-100 dark:bg-slate-800"
                  )}>
                    <span className="font-semibold text-sm text-foreground leading-tight block">
                      {site.site_nom}
                    </span>
                  </td>
                  {weekdaysOnly.map((date, dayIndex) => {
                    const dayData = getDayData(site, date);
                    const dateStr = format(date, 'yyyy-MM-dd');
                    const isToday = dateStr === format(new Date(), 'yyyy-MM-dd');
                    const dayOfWeek = date.getDay();
                    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                    // Lundi = début de semaine (séparateur épais)
                    const isMonday = dayOfWeek === 1;
                    const isFirstDay = dayIndex === 0;

                    const isAdminSite = site.site_nom.toLowerCase().includes('administratif');

                    // Médecins (sauf pour site admin)
                    const medecins = isAdminSite ? [] : (dayData?.medecins || [])
                      .map(m => ({
                        ...m,
                        isMatinOnly: m.matin && !m.apres_midi,
                        isApresMidiOnly: !m.matin && m.apres_midi,
                        isFullDay: m.matin && m.apres_midi,
                        nom_complet: m.nom_complet || `${m.prenom || ''} ${m.nom}`.trim(),
                        initials: getUniqueInitials(m.prenom, m.nom, allPeople, m.id),
                      }))
                      .sort((a, b) => {
                        if (a.isFullDay !== b.isFullDay) return a.isFullDay ? -1 : 1;
                        if (a.isMatinOnly !== b.isMatinOnly) return a.isMatinOnly ? -1 : 1;
                        return a.nom_complet.toLowerCase().localeCompare(b.nom_complet.toLowerCase(), 'fr');
                      });

                    // Assistants
                    const secretaires = (dayData?.secretaires || [])
                      .map(s => ({
                        ...s,
                        isMatinOnly: s.matin && !s.apres_midi,
                        isApresMidiOnly: !s.matin && s.apres_midi,
                        isFullDay: s.matin && s.apres_midi,
                        nom_complet: s.nom_complet || `${s.prenom || ''} ${s.nom}`.trim(),
                        initials: getUniqueInitials(s.prenom, s.nom, allPeople, s.id),
                        tags: [
                          s.is_1r && '1R',
                          s.is_2f && '2F',
                          s.is_3f && '3F',
                        ].filter(Boolean) as string[],
                      }))
                      .sort((a, b) => {
                        if (a.isFullDay !== b.isFullDay) return a.isFullDay ? -1 : 1;
                        if (a.isMatinOnly !== b.isMatinOnly) return a.isMatinOnly ? -1 : 1;
                        return a.nom_complet.toLowerCase().localeCompare(b.nom_complet.toLowerCase(), 'fr');
                      });

                    const hasDeficit = dayData?.status_matin === 'non_satisfait' ||
                                      dayData?.status_apres_midi === 'non_satisfait';

                    const hasAnyPerson = medecins.length > 0 || secretaires.length > 0;

                    // Déterminer si cette cellule est une zone de drop valide
                    const isDragOver = dragOverCell?.siteId === site.site_id && dragOverCell?.date === dateStr;
                    const isValidDropZone = currentDragData && currentDragData.date === dateStr && currentDragData.sourceSiteId !== site.site_id;
                    const isInvalidDropZone = currentDragData && (currentDragData.date !== dateStr || currentDragData.sourceSiteId === site.site_id);

                    return (
                      <td
                        key={dateStr}
                        className={cn(
                          "p-2 cursor-pointer transition-all duration-200 align-top relative group",
                          // Séparateur de semaine
                          isMonday && !isFirstDay ? "border-l-4 border-l-primary/30" : "border-l border-border/30",
                          // Alternance de couleur fond (sans mise en surbrillance pour aujourd'hui)
                          !hasDeficit && (isEvenRow
                            ? "bg-white dark:bg-slate-900"
                            : "bg-slate-100 dark:bg-slate-800"),
                          isWeekend && !hasDeficit && (isEvenRow
                            ? "bg-slate-50 dark:bg-slate-900/50"
                            : "bg-slate-200 dark:bg-slate-700/80"),
                          hasDeficit && "bg-red-500/10",
                          "hover:bg-accent/30",
                          // Styles pour le drag and drop
                          isDragOver && isValidDropZone && "ring-2 ring-primary ring-offset-2 bg-primary/10",
                          isDragOver && isInvalidDropZone && "ring-2 ring-destructive/50 bg-destructive/5"
                        )}
                        onClick={() => onDayClick?.(site.site_id, dateStr)}
                        onDragOver={(e) => handleDragOver(e, site.site_id, dateStr)}
                        onDragEnter={(e) => handleDragEnter(e, site.site_id, dateStr)}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, site.site_id, site.site_nom, dateStr)}
                      >
                        <div className="flex items-start gap-2 min-h-[36px]">
                          {/* Contenu principal (personnes) */}
                          <div className="flex-1 flex flex-col gap-1">
                            {/* Ligne 1: Médecins (vert) */}
                            {medecins.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {medecins.map(m => {
                                  const period = m.isFullDay ? 'journee' : m.isMatinOnly ? 'matin' : 'apres_midi';
                                  return (
                                    <DraggablePersonAvatar
                                      key={m.id}
                                      personId={m.id}
                                      personType="medecin"
                                      initials={m.initials}
                                      fullName={m.nom_complet}
                                      period={period}
                                      date={dateStr}
                                      sourceSiteId={site.site_id}
                                      sourceSiteName={site.site_nom}
                                      onDragStart={() => setCurrentDragData({
                                        personId: m.id,
                                        personType: 'medecin',
                                        personName: m.nom_complet,
                                        date: dateStr,
                                        sourceSiteId: site.site_id,
                                        sourceSiteName: site.site_nom,
                                        period,
                                      })}
                                      onDragEnd={() => setCurrentDragData(null)}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setMedecinActionsDialog({
                                          open: true,
                                          medecinId: m.id,
                                          medecinNom: m.nom || '',
                                          medecinPrenom: m.prenom || '',
                                          date: dateStr,
                                          siteId: site.site_id,
                                          periode: period,
                                        });
                                      }}
                                    />
                                  );
                                })}
                              </div>
                            )}

                            {/* Ligne 2: Assistants (cyan) */}
                            {secretaires.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {secretaires.map(s => {
                                  const period = s.isFullDay ? 'journee' : s.isMatinOnly ? 'matin' : 'apres_midi';
                                  return (
                                    <DraggablePersonAvatar
                                      key={s.id}
                                      personId={s.id}
                                      personType="assistant"
                                      initials={s.initials}
                                      fullName={s.nom_complet}
                                      period={period}
                                      tags={s.tags}
                                      date={dateStr}
                                      sourceSiteId={site.site_id}
                                      sourceSiteName={site.site_nom}
                                      is1R={s.is_1r}
                                      is2F={s.is_2f}
                                      is3F={s.is_3f}
                                      onDragStart={() => setCurrentDragData({
                                        personId: s.id,
                                        personType: 'assistant',
                                        personName: s.nom_complet,
                                        date: dateStr,
                                        sourceSiteId: site.site_id,
                                        sourceSiteName: site.site_nom,
                                        period,
                                        is1R: s.is_1r,
                                        is2F: s.is_2f,
                                        is3F: s.is_3f,
                                      })}
                                      onDragEnd={() => setCurrentDragData(null)}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSecretaireActionsDialog({
                                          open: true,
                                          secretaireId: s.id,
                                          secretaireNom: s.nom_complet,
                                          date: dateStr,
                                          periode: period,
                                        });
                                      }}
                                    />
                                  );
                                })}
                              </div>
                            )}

                            {/* Placeholder si vide */}
                            {!hasAnyPerson && (
                              <span className="text-[10px] text-muted-foreground/40">—</span>
                            )}
                          </div>

                          {/* Bouton d'ajout - à droite */}
                          <AddButton
                            onAddMedecin={() => {
                              setAddMedecinDialog({
                                open: true,
                                date: dateStr,
                                siteId: site.site_id,
                              });
                            }}
                            onReassignMedecin={() => {
                              setReassignMedecinDialog({
                                open: true,
                                date: dateStr,
                                siteId: site.site_id,
                                siteName: site.site_nom,
                              });
                            }}
                            onAddAssistant={() => {
                              setAddSecretaireDialog({
                                open: true,
                                date: dateStr,
                                siteId: site.site_id,
                                siteName: site.site_nom,
                              });
                            }}
                            onReassignAssistant={() => {
                              setReassignSecretaireDialog({
                                open: true,
                                date: dateStr,
                                siteId: site.site_id,
                                siteName: site.site_nom,
                              });
                            }}
                          />
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}

            {/* Ligne des absences - toujours affichée */}
            <tr className="border-b border-border/30 bg-red-500/5">
                <td className="sticky left-0 z-10 bg-red-50 dark:bg-red-950/50 border-r border-border/30 py-3 px-4 min-w-[140px] max-w-[140px]">
                  <div className="flex items-center gap-2">
                    <UserX className="h-4 w-4 text-red-500" />
                    <span className="font-semibold text-sm text-red-600 dark:text-red-400">
                      Absences
                    </span>
                  </div>
                </td>
                {weekdaysOnly.map((date, dayIndex) => {
                  const dateStr = format(date, 'yyyy-MM-dd');
                  const isToday = dateStr === format(new Date(), 'yyyy-MM-dd');
                  const dayOfWeek = date.getDay();
                  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                  // Lundi = début de semaine (séparateur épais)
                  const isMonday = dayOfWeek === 1;
                  const isFirstDay = dayIndex === 0;
                  const absences = absencesByDate[dateStr] || [];

                  // Séparer les absences par type
                  const absentMedecins = absences.filter(a => a.type === 'medecin');
                  const absentAssistants = absences.filter(a => a.type === 'assistant');

                  return (
                    <td
                      key={dateStr}
                      className={cn(
                        "p-2 align-top",
                        // Séparateur de semaine
                        isMonday && !isFirstDay ? "border-l-4 border-l-primary/30" : "border-l border-border/30",
                        isWeekend && "bg-muted/20"
                      )}
                    >
                      <div className="flex flex-col gap-1 min-h-[36px]">
                        {/* Ligne 1: Médecins absents */}
                        {absentMedecins.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {absentMedecins.map((absence, idx) => {
                              const nameParts = absence.nom.split(' ');
                              const prenom = nameParts[0] || '';
                              const nom = nameParts.slice(1).join(' ') || '';
                              const initials = getInitials(prenom, nom);

                              return (
                                <AbsenceAvatar
                                  key={`${absence.id}-${idx}`}
                                  initials={initials}
                                  fullName={absence.nom}
                                  type={absence.type}
                                />
                              );
                            })}
                          </div>
                        )}
                        {/* Ligne 2: Assistants absents */}
                        {absentAssistants.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {absentAssistants.map((absence, idx) => {
                              const nameParts = absence.nom.split(' ');
                              const prenom = nameParts[0] || '';
                              const nom = nameParts.slice(1).join(' ') || '';
                              const initials = getInitials(prenom, nom);

                              return (
                                <AbsenceAvatar
                                  key={`${absence.id}-${idx}`}
                                  initials={initials}
                                  fullName={absence.nom}
                                  type={absence.type}
                                />
                              );
                            })}
                          </div>
                        )}
                        {absences.length === 0 && (
                          <span className="text-[10px] text-muted-foreground/40">—</span>
                        )}
                      </div>
                    </td>
                  );
                })}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Dialog d'actions pour médecin */}
      <MedecinActionsDialog
        open={medecinActionsDialog.open}
        onOpenChange={(open) => setMedecinActionsDialog({ ...medecinActionsDialog, open })}
        medecinId={medecinActionsDialog.medecinId}
        medecinNom={medecinActionsDialog.medecinNom}
        medecinPrenom={medecinActionsDialog.medecinPrenom}
        date={medecinActionsDialog.date}
        siteId={medecinActionsDialog.siteId}
        periode={medecinActionsDialog.periode}
        onRefresh={() => {
          setMedecinActionsDialog({ ...medecinActionsDialog, open: false });
          onRefresh?.();
        }}
      />

      {/* Dialog pour les actions sur un assistant médical */}
      <SecretaireDayActionsDialog
        open={secretaireActionsDialog.open}
        onOpenChange={(open) => setSecretaireActionsDialog({ ...secretaireActionsDialog, open })}
        secretaireId={secretaireActionsDialog.secretaireId}
        secretaireNom={secretaireActionsDialog.secretaireNom}
        date={secretaireActionsDialog.date}
        initialPeriode={secretaireActionsDialog.periode}
        onRefresh={() => {
          onRefresh?.();
        }}
        onOptimisticFlagUpdate={updateLocalFlagsOptimistic}
      />

      <AddMedecinToDayDialog
        open={addMedecinDialog.open}
        onOpenChange={(open) => setAddMedecinDialog({ ...addMedecinDialog, open })}
        date={addMedecinDialog.date}
        siteId={addMedecinDialog.siteId}
        onSuccess={() => {
          setAddMedecinDialog({ open: false, date: '', siteId: '' });
          onRefresh?.();
        }}
      />

      <ReassignMedecinDialog
        open={reassignMedecinDialog.open}
        onOpenChange={(open) => setReassignMedecinDialog({ ...reassignMedecinDialog, open })}
        date={reassignMedecinDialog.date}
        targetSiteId={reassignMedecinDialog.siteId}
        targetSiteName={reassignMedecinDialog.siteName}
        onSuccess={() => {
          setReassignMedecinDialog({ open: false, date: '', siteId: '', siteName: '' });
          onRefresh?.();
        }}
      />

      <AddSecretaireToDayDialog
        open={addSecretaireDialog.open}
        onOpenChange={(open) => setAddSecretaireDialog({ ...addSecretaireDialog, open })}
        date={addSecretaireDialog.date}
        siteId={addSecretaireDialog.siteId}
        siteName={addSecretaireDialog.siteName}
        onSuccess={() => {
          setAddSecretaireDialog({ open: false, date: '', siteId: '', siteName: '' });
          onRefresh?.();
        }}
      />

      <ReassignSecretaireDialog
        open={reassignSecretaireDialog.open}
        onOpenChange={(open) => setReassignSecretaireDialog({ ...reassignSecretaireDialog, open })}
        date={reassignSecretaireDialog.date}
        targetSiteId={reassignSecretaireDialog.siteId}
        targetSiteName={reassignSecretaireDialog.siteName}
        onSuccess={() => {
          setReassignSecretaireDialog({ open: false, date: '', siteId: '', siteName: '' });
          onRefresh?.();
        }}
      />

      {/* Dialogs pour le drag and drop */}
      <PeriodSelectionDialog
        open={periodDialog.open}
        onOpenChange={(open) => setPeriodDialog({ ...periodDialog, open })}
        personName={periodDialog.dragData?.personName || ''}
        targetSiteName={periodDialog.targetSiteName}
        onSelect={handlePeriodSelected}
      />

      <BesoinOperatoireSelectionDialog
        open={besoinDialog.open}
        onOpenChange={(open) => setBesoinDialog({ ...besoinDialog, open })}
        date={besoinDialog.dragData?.date || ''}
        period={besoinDialog.period}
        secretaireName={besoinDialog.dragData?.personName || ''}
        targetSiteName={besoinDialog.targetSiteName}
        onSelect={handleBesoinSelected}
      />

      <TypeInterventionSelectionDialog
        open={typeInterventionDialog.open}
        onOpenChange={(open) => setTypeInterventionDialog({ ...typeInterventionDialog, open })}
        medecinName={typeInterventionDialog.dragData?.personName || ''}
        targetSiteName={typeInterventionDialog.targetSiteName}
        onSelect={handleTypeInterventionSelected}
      />
    </div>
  );
}
