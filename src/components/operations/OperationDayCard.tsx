import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { OperationCard } from './OperationCard';

interface Operation {
  id: string;
  date: string;
  periode: 'matin' | 'apres_midi';
  salle_assignee: string | null;
  salles_operation: {
    id: string;
    name: string;
  } | null;
  medecins: {
    id: string;
    first_name: string;
    name: string;
  } | null;
  types_intervention: {
    id: string;
    nom: string;
    code: string;
  };
}

interface OperationDayCardProps {
  date: Date;
  periode: 'matin' | 'apres_midi';
  operations: Operation[];
  index: number;
  onUpdate: () => void;
}

export const OperationDayCard = ({ date, periode, operations, index, onUpdate }: OperationDayCardProps) => {
  return (
    <div
      className={cn(
        "rounded-xl overflow-hidden",
        "bg-card/50 backdrop-blur-xl border border-border/50",
        "shadow-lg hover:shadow-xl",
        "transition-all duration-300 ease-out",
        "animate-fade-in"
      )}
      style={{ animationDelay: `${index * 100}ms` }}
    >
      {/* Header */}
      <div className="p-4 border-b border-border/50 bg-gradient-to-r from-primary/5 to-transparent">
        <div className="text-center">
          <p className="text-xs font-medium text-muted-foreground uppercase">
            {format(date, 'EEEE', { locale: fr })}
          </p>
          <p className="text-lg font-semibold text-foreground mt-1">
            {format(date, 'd MMMM', { locale: fr })}
          </p>
        </div>
      </div>

      {/* Operations */}
      <div className="p-3 space-y-3">
        {operations.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground text-sm">
            Aucune opération
          </div>
        ) : (
          operations.map((operation) => (
            <OperationCard
              key={operation.id}
              operation={operation}
              onUpdate={onUpdate}
            />
          ))
        )}
      </div>
    </div>
  );
};
