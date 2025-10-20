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
  operations: Operation[];
  index: number;
  onUpdate: () => void;
}

export const OperationDayCard = ({ date, operations, index, onUpdate }: OperationDayCardProps) => {
  const morningOps = operations.filter(op => op.periode === 'matin');
  const afternoonOps = operations.filter(op => op.periode === 'apres_midi');

  return (
    <div
      className={cn(
        "rounded-xl overflow-hidden",
        "bg-card/50 backdrop-blur-xl border border-border/50",
        "shadow-lg hover:shadow-xl hover:border-primary/30",
        "transition-all duration-300 ease-out",
        "animate-fade-in"
      )}
      style={{ animationDelay: `${index * 50}ms` }}
    >
      {/* Header */}
      <div className="p-4 border-b border-border/50 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent">
        <div className="text-center">
          <p className="text-xs font-semibold text-primary/70 uppercase tracking-wider">
            {format(date, 'EEEE', { locale: fr })}
          </p>
          <p className="text-xl font-bold text-foreground mt-1">
            {format(date, 'd MMMM', { locale: fr })}
          </p>
        </div>
      </div>

      {/* Operations */}
      <div className="p-4 space-y-4">
        {morningOps.length === 0 && afternoonOps.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            Aucune opération
          </div>
        ) : (
          <>
            {morningOps.length > 0 && (
              <div className="space-y-3">
                {morningOps.map((operation) => (
                  <OperationCard
                    key={operation.id}
                    operation={operation}
                    onUpdate={onUpdate}
                  />
                ))}
              </div>
            )}
            {afternoonOps.length > 0 && (
              <div className="space-y-3">
                {afternoonOps.map((operation) => (
                  <OperationCard
                    key={operation.id}
                    operation={operation}
                    onUpdate={onUpdate}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
