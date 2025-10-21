import { format, addDays, startOfWeek } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Badge } from '@/components/ui/badge';
import { SecretaireDayCell } from './SecretaireDayCell';

interface Assignment {
  site_nom?: string;
  medecin_nom?: string;
  besoin_operation_nom?: string;
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
      dayName: format(addDays(weekStart, i), 'EEE', { locale: fr }),
      dayNumber: format(addDays(weekStart, i), 'd'),
      data: daysMap.get(date)
    };
  });

  return (
    <div 
      className="bg-card/50 backdrop-blur-xl border border-border/50 rounded-xl shadow-lg overflow-hidden transition-all hover:shadow-xl"
      style={{
        animation: `fadeIn 0.5s ease-out ${index * 0.1}s both`
      }}
    >
      {/* Header */}
      <div className="bg-gradient-to-r from-teal-500/10 via-cyan-500/10 to-blue-500/10 p-4 border-b border-border/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-semibold">{secretaire.nom_complet}</h3>
            <div className="flex gap-2">
              {!secretaire.actif && (
                <Badge variant="outline" className="bg-destructive/10">
                  Inactif
                </Badge>
              )}
              {secretaire.horaire_flexible && (
                <Badge variant="outline" className="bg-blue-500/10">
                  Flexible
                </Badge>
              )}
              {secretaire.flexible_jours_supplementaires && (
                <Badge variant="outline" className="bg-purple-500/10">
                  +{secretaire.nombre_jours_supplementaires || 1} jour(s)
                </Badge>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="p-4">
        <div className="grid grid-cols-6 gap-3">
          {weekDays.map((day) => (
            <div key={day.date} className="space-y-2">
              {/* Day Header */}
              <div className="text-center">
                <div className="text-xs font-medium text-muted-foreground uppercase">
                  {day.dayName}
                </div>
                <div className="text-sm font-semibold">{day.dayNumber}</div>
              </div>
              
              {/* Day Cell */}
              <SecretaireDayCell
                date={day.date}
                matin={day.data?.matin}
                apres_midi={day.data?.apres_midi}
                onClick={() => onDayClick?.(secretaire.id, day.date)}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
