import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

// Interface pour les données de drag
export interface DragData {
  personId: string;
  personType: 'medecin' | 'assistant';
  personName: string;
  date: string;
  sourceSiteId: string;
  sourceSiteName: string;
  period: 'matin' | 'apres_midi' | 'journee';
  // Pour les assistants
  is1R?: boolean;
  is2F?: boolean;
  is3F?: boolean;
}

interface DraggablePersonAvatarProps {
  // Données de la personne
  personId: string;
  personType: 'medecin' | 'assistant';
  initials: string;
  fullName: string;
  period: 'matin' | 'apres_midi' | 'journee';
  tags?: string[];
  // Données pour le drag
  date: string;
  sourceSiteId: string;
  sourceSiteName: string;
  is1R?: boolean;
  is2F?: boolean;
  is3F?: boolean;
  // Callbacks
  onClick?: (e: React.MouseEvent) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

export function DraggablePersonAvatar({
  personId,
  personType,
  initials,
  fullName,
  period,
  tags,
  date,
  sourceSiteId,
  sourceSiteName,
  is1R,
  is2F,
  is3F,
  onClick,
  onDragStart: onDragStartProp,
  onDragEnd: onDragEndProp,
}: DraggablePersonAvatarProps) {
  const [isDragging, setIsDragging] = useState(false);

  // Couleurs différentes pour médecins (vert teal) et assistants (cyan)
  const typeColors = {
    medecin: 'from-teal-500 to-emerald-600 shadow-teal-500/25',
    assistant: 'from-cyan-500 to-blue-600 shadow-cyan-500/25',
  };

  // Couleurs des points pour les périodes
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

  const handleDragStart = (e: React.DragEvent) => {
    setIsDragging(true);
    onDragStartProp?.();

    const dragData: DragData = {
      personId,
      personType,
      personName: fullName,
      date,
      sourceSiteId,
      sourceSiteName,
      period,
      is1R,
      is2F,
      is3F,
    };

    e.dataTransfer.setData('application/json', JSON.stringify(dragData));
    e.dataTransfer.effectAllowed = 'move';

    // Créer une image de drag personnalisée
    const dragImage = e.currentTarget.cloneNode(true) as HTMLElement;
    dragImage.style.transform = 'scale(1.1)';
    dragImage.style.opacity = '0.9';
    document.body.appendChild(dragImage);
    e.dataTransfer.setDragImage(dragImage, 16, 16);
    setTimeout(() => document.body.removeChild(dragImage), 0);
  };

  const handleDragEnd = () => {
    setIsDragging(false);
    onDragEndProp?.();
  };

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            draggable
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onClick={onClick}
            className={cn(
              "relative flex items-center justify-center text-white text-[10px] font-bold",
              "bg-gradient-to-br shadow-md transition-all duration-200",
              "hover:scale-110 hover:shadow-lg hover:-translate-y-0.5",
              "focus:outline-none cursor-grab active:cursor-grabbing",
              typeColors[personType],
              hasTags ? "w-auto min-w-[32px] h-8 rounded-lg px-1.5 gap-1" : "w-8 h-8 rounded-lg",
              isDragging && "opacity-50 scale-95"
            )}
          >
            <span>{initials}</span>
            {hasTags && (
              <span className="text-[8px] font-black text-white/90 bg-white/20 px-1 py-0.5 rounded">
                {tags.join(' ')}
              </span>
            )}
            {/* Point indicateur de période */}
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
            <span className="text-[10px] text-muted-foreground mt-1">
              Glisser pour déplacer
            </span>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
