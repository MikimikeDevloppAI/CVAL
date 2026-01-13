import { CalendarDays, ChevronRight, UserCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Secretaire } from './useSecretaires';
import { useCanManagePlanning } from '@/hooks/useCanManagePlanning';

interface SecretaireCardProps {
  secretaire: Secretaire;
  index: number;
  onOpenDetail: (secretaire: Secretaire) => void;
  onOpenCalendar: (secretaire: { id: string; nom: string }) => void;
}

export function SecretaireCard({ secretaire, index, onOpenDetail, onOpenCalendar }: SecretaireCardProps) {
  const { canManage } = useCanManagePlanning();

  const nomComplet = `${secretaire.first_name || ''} ${secretaire.name || ''}`.trim() ||
    `Secrétaire ${secretaire.id.slice(0, 8)}`;

  // Count working days
  const workingDays = secretaire.horaires_base_secretaires?.reduce((acc, h) => {
    if (!acc.includes(h.jour_semaine)) {
      acc.push(h.jour_semaine);
    }
    return acc;
  }, [] as number[]).length || 0;

  const handleCalendarClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onOpenCalendar({ id: secretaire.id, nom: nomComplet });
  };

  return (
    <div
      onClick={() => onOpenDetail(secretaire)}
      className={`
        backdrop-blur-xl bg-card/95 rounded-2xl border border-border/50
        shadow-sm hover:shadow-xl hover:shadow-primary/5 transition-all duration-300
        hover:scale-[1.02] hover:-translate-y-1 hover:border-primary/30
        group relative overflow-hidden cursor-pointer
        ${secretaire.actif === false ? 'opacity-60' : ''}
      `}
      style={{ animationDelay: `${index * 50}ms` }}
    >
      {/* Subtle gradient overlay on hover */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

      <div className="relative p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-sky-50 border border-sky-200 flex items-center justify-center shrink-0">
              <UserCircle className="h-4 w-4 text-sky-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start gap-2 mb-1.5 flex-wrap">
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-medium text-muted-foreground group-hover:text-primary/70 transition-colors">
                    {secretaire.first_name || 'Prénom'}
                  </span>
                  <h3 className="text-base font-semibold text-foreground group-hover:text-primary transition-colors leading-tight truncate">
                    {secretaire.name || `Secrétaire ${secretaire.id.slice(0, 8)}`}
                  </h3>
                </div>
                {secretaire.actif === false && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                    Inactif
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {secretaire.horaire_flexible && (
                  <Badge className="bg-blue-500/10 text-blue-700 dark:text-blue-300 border-0 text-[10px] px-1.5 py-0">
                    Flexible {secretaire.pourcentage_temps && `${secretaire.pourcentage_temps}%`}
                  </Badge>
                )}
                {secretaire.prefered_admin && (
                  <Badge className="bg-purple-500/10 text-purple-700 dark:text-purple-300 border-0 text-[10px] px-1.5 py-0">
                    Admin
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 shrink-0">
            {canManage && (
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-xl text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                onClick={handleCalendarClick}
              >
                <CalendarDays className="h-4 w-4" />
              </Button>
            )}
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground group-hover:text-primary transition-colors">
              <ChevronRight className="h-4 w-4" />
            </div>
          </div>
        </div>

        {/* Summary info */}
        <div className="mt-4 pt-3 border-t border-border/30 flex items-center gap-3 text-xs text-muted-foreground">
          {workingDays > 0 && (
            <span className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/50">
              <span className="font-semibold text-foreground">{workingDays}</span>
              jour{workingDays > 1 ? 's' : ''}/sem
            </span>
          )}
          {secretaire.medecins_assignes_details && secretaire.medecins_assignes_details.length > 0 && (
            <span className="truncate flex-1">
              {secretaire.medecins_assignes_details.length} médecin{secretaire.medecins_assignes_details.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
