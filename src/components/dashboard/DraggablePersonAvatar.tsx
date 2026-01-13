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

  // Style désaturé : fond gris clair + bordure couleur distincte
  // Médecins = teal/vert, Assistants = bleu clair (sky) pour bien différencier
  const typeStyles = {
    medecin: 'bg-slate-50 border-2 border-teal-600 text-slate-700',
    assistant: 'bg-slate-50 border-2 border-sky-500 text-slate-700',
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
              "relative flex items-center justify-center text-[11px] font-semibold",
              "shadow-sm transition-all duration-200",
              "hover:shadow-md hover:bg-slate-100",
              "focus:outline-none cursor-grab active:cursor-grabbing",
              typeStyles[personType],
              hasTags ? "w-auto min-w-[32px] h-8 rounded-lg px-1.5 gap-1" : "w-8 h-8 rounded-lg",
              isDragging && "opacity-50 scale-95"
            )}
          >
            <span>{initials}</span>
            {hasTags && (
              <span className="text-[9px] font-bold text-slate-500 bg-slate-200/80 px-1 py-0.5 rounded">
                {tags.join(' ')}
              </span>
            )}
            {/* Indicateur de période - demi-remplissage: gauche=matin, droite=après-midi, plein=journée */}
            <div className="absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-background bg-slate-200 overflow-hidden">
              {period === 'matin' && (
                <div className="absolute left-0 top-0 w-1/2 h-full bg-blue-500" />
              )}
              {period === 'apres_midi' && (
                <div className="absolute right-0 top-0 w-1/2 h-full bg-amber-500" />
              )}
              {period === 'journee' && (
                <div className="absolute inset-0 bg-emerald-500" />
              )}
            </div>
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="bg-card/95 backdrop-blur-xl border border-border/50 shadow-xl px-3 py-2"
        >
          <div className="flex flex-col gap-1">
            <span className="font-semibold text-foreground">{fullName}</span>
            <div className="flex items-center gap-2">
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-600">
                {periodLabels[period]}
              </span>
              {hasTags && (
                <span className="text-[10px] font-bold text-slate-500">
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
