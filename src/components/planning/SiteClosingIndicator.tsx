import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';

interface SiteClosingIndicatorProps {
  siteId: string;
  siteName: string;
  weekDays: Date[];
}

interface DayStatus {
  date: string;
  has1R: boolean;
  has2F: boolean;
  multiple1R: boolean;
  multiple2F: boolean;
  multiple3F: boolean;
}

export function SiteClosingIndicator({ siteId, siteName, weekDays }: SiteClosingIndicatorProps) {
  const [needsClosure, setNeedsClosure] = useState(false);
  const [daysStatus, setDaysStatus] = useState<DayStatus[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkClosure = async () => {
      setLoading(true);

      // Vérifier si le site nécessite une fermeture
      const { data: siteData } = await supabase
        .from('sites')
        .select('fermeture')
        .eq('id', siteId)
        .single();

      if (!siteData?.fermeture) {
        setNeedsClosure(false);
        setLoading(false);
        return;
      }

      setNeedsClosure(true);

      // Récupérer les plannings pour ce site cette semaine
      const startDate = format(weekDays[0], 'yyyy-MM-dd');
      const endDate = format(weekDays[weekDays.length - 1], 'yyyy-MM-dd');

      const { data: plannings } = await supabase
        .from('planning_genere')
        .select('date, responsable_1r_id, responsable_2f_id, responsable_3f_id')
        .eq('site_id', siteId)
        .gte('date', startDate)
        .lte('date', endDate)
        .neq('statut', 'annule');

      // Analyser les statuts pour chaque jour
      const statuses: DayStatus[] = weekDays.map(day => {
        const dateStr = format(day, 'yyyy-MM-dd');
        const dayPlannings = (plannings || []).filter(p => p.date === dateStr);

        const responsables1R = dayPlannings
          .map(p => p.responsable_1r_id)
          .filter(id => id !== null);
        
        const responsables2F = dayPlannings
          .map(p => p.responsable_2f_id)
          .filter(id => id !== null);

        const responsables3F = dayPlannings
          .map(p => p.responsable_3f_id)
          .filter(id => id !== null);

        const unique1R = new Set(responsables1R);
        const unique2F = new Set(responsables2F);
        const unique3F = new Set(responsables3F);

        return {
          date: dateStr,
          has1R: unique1R.size === 1,
          has2F: unique2F.size === 1,
          multiple1R: unique1R.size > 1,
          multiple2F: unique2F.size > 1,
          multiple3F: unique3F.size > 1,
        };
      });

      setDaysStatus(statuses);
      setLoading(false);
    };

    checkClosure();
  }, [siteId, weekDays]);

  if (loading || !needsClosure) return null;

  const hasIssues = daysStatus.some(day => !day.has1R || !day.has2F || day.multiple1R || day.multiple2F || day.multiple3F);

  if (!hasIssues) {
    return (
      <div className="flex items-center gap-1 text-xs">
        <CheckCircle2 className="h-4 w-4 text-green-600" />
        <span className="text-green-600">Fermeture OK</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      <AlertCircle className="h-4 w-4 text-destructive" />
      <div className="flex flex-wrap gap-1">
        {daysStatus.map(day => {
          const hasError = !day.has1R || !day.has2F || day.multiple1R || day.multiple2F || day.multiple3F;
          if (!hasError) return null;

          const dayDate = new Date(day.date);
          const errors = [];
          if (!day.has1R) errors.push('1R');
          if (!day.has2F) errors.push('2F');
          if (day.multiple1R) errors.push('Multi-1R');
          if (day.multiple2F) errors.push('Multi-2F');

          return (
            <Badge 
              key={day.date} 
              variant="destructive" 
              className="text-xs px-1.5 py-0"
              title={errors.join(', ')}
            >
              {format(dayDate, 'EEE', { locale: fr })}
            </Badge>
          );
        })}
      </div>
    </div>
  );
}
