import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, CheckCircle2, Building2 } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';

interface Site {
  id: string;
  nom: string;
}

interface Planning {
  date: string;
  site_id: string;
  responsable_1r_id: string | null;
  responsable_2f_id: string | null;
  responsable_3f_id: string | null;
}

interface DayStatus {
  date: string;
  has1R: boolean;
  has2F: boolean;
  has3F: boolean;
  multiple1R: boolean;
  multiple2F: boolean;
  multiple3F: boolean;
}

interface SiteStatus {
  site: Site;
  days: DayStatus[];
}

interface ClosingResponsiblesStatusProps {
  weekDays: Date[];
}

export function ClosingResponsiblesStatus({ weekDays }: ClosingResponsiblesStatusProps) {
  const [sitesStatus, setSitesStatus] = useState<SiteStatus[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStatus = async () => {
      setLoading(true);
      
      // Récupérer les sites avec fermeture
      const { data: sites, error: sitesError } = await supabase
        .from('sites')
        .select('id, nom')
        .eq('fermeture', true)
        .eq('actif', true);

      if (sitesError) {
        console.error('Erreur lors de la récupération des sites:', sitesError);
        setLoading(false);
        return;
      }

      if (!sites || sites.length === 0) {
        setSitesStatus([]);
        setLoading(false);
        return;
      }

      // Récupérer les plannings pour ces sites et cette semaine
      const startDate = format(weekDays[0], 'yyyy-MM-dd');
      const endDate = format(weekDays[weekDays.length - 1], 'yyyy-MM-dd');

      const { data: plannings, error: planningsError } = await supabase
        .from('planning_genere')
        .select('date, site_id, responsable_1r_id, responsable_2f_id, responsable_3f_id')
        .in('site_id', sites.map(s => s.id))
        .gte('date', startDate)
        .lte('date', endDate)
        .neq('statut', 'annule');

      if (planningsError) {
        console.error('Erreur lors de la récupération des plannings:', planningsError);
        setLoading(false);
        return;
      }

      // Analyser les statuts pour chaque site et chaque jour
      const statusBySite: SiteStatus[] = sites.map(site => {
        const dayStatuses: DayStatus[] = weekDays.map(day => {
          const dateStr = format(day, 'yyyy-MM-dd');
          const dayPlannings = (plannings || []).filter(
            p => p.site_id === site.id && p.date === dateStr
          );

          // Compter les responsables uniques pour ce jour
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
            has3F: unique3F.size > 0,
            multiple1R: unique1R.size > 1,
            multiple2F: unique2F.size > 1,
            multiple3F: unique3F.size > 1,
          };
        });

        return {
          site,
          days: dayStatuses,
        };
      });

      setSitesStatus(statusBySite);
      setLoading(false);
    };

    fetchStatus();
  }, [weekDays]);

  if (loading) {
    return (
      <Card>
        <CardContent className="py-6">
          <div className="text-center text-muted-foreground">
            Chargement du statut des responsables de fermeture...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (sitesStatus.length === 0) {
    return null;
  }

  const hasIssues = sitesStatus.some(siteStatus =>
    siteStatus.days.some(day => !day.has1R || !day.has2F || day.multiple1R || day.multiple2F || day.multiple3F)
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-primary" />
          Responsables de Fermeture
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {sitesStatus.map(siteStatus => {
          const siteHasIssues = siteStatus.days.some(
            day => !day.has1R || !day.has2F || day.multiple1R || day.multiple2F || day.multiple3F
          );

          return (
            <div key={siteStatus.site.id} className="space-y-2">
              <div className="font-medium flex items-center gap-2">
                {siteStatus.site.nom}
                {!siteHasIssues && (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                )}
              </div>

              <div className="grid grid-cols-7 gap-2">
                {siteStatus.days.map(day => {
                  const dayDate = new Date(day.date);
                  const hasError = !day.has1R || !day.has2F || day.multiple1R || day.multiple2F || day.multiple3F;
                  
                  return (
                    <div
                      key={day.date}
                      className={`p-2 rounded-lg border ${
                        hasError
                          ? 'border-destructive/50 bg-destructive/5'
                          : 'border-border bg-muted/30'
                      }`}
                    >
                      <div className="text-xs font-medium text-center mb-1">
                        {format(dayDate, 'EEE d', { locale: fr })}
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center justify-center gap-1">
                          <Badge
                            variant={day.has1R ? 'default' : 'destructive'}
                            className="text-xs h-5"
                          >
                            1R
                          </Badge>
                          {day.multiple1R && (
                            <AlertCircle className="h-3 w-3 text-destructive" />
                          )}
                        </div>
                        <div className="flex items-center justify-center gap-1">
                          <Badge
                            variant={day.has2F ? 'default' : 'destructive'}
                            className="text-xs h-5"
                          >
                            2F
                          </Badge>
                          {day.multiple2F && (
                            <AlertCircle className="h-3 w-3 text-destructive" />
                          )}
                        </div>
                        {day.has3F && (
                          <div className="flex items-center justify-center gap-1">
                            <Badge
                              variant="secondary"
                              className="text-xs h-5"
                            >
                              3F
                            </Badge>
                            {day.multiple3F && (
                              <AlertCircle className="h-3 w-3 text-destructive" />
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Afficher les messages d'erreur spécifiques */}
              {siteStatus.days.map(day => {
                const issues = [];
                if (!day.has1R) issues.push('1R manquant');
                if (!day.has2F) issues.push('2F manquant');
                if (day.multiple1R) issues.push('Plusieurs 1R assignés');
                if (day.multiple2F) issues.push('Plusieurs 2F assignés');
                if (day.multiple3F) issues.push('Plusieurs 3F assignés');

                if (issues.length === 0) return null;

                return (
                  <Alert key={day.date} variant="destructive" className="mt-2">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      <strong>{format(new Date(day.date), 'EEEE d MMMM', { locale: fr })}</strong>:{' '}
                      {issues.join(', ')}
                    </AlertDescription>
                  </Alert>
                );
              })}
            </div>
          );
        })}

        {!hasIssues && (
          <Alert>
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertDescription>
              Tous les responsables de fermeture sont correctement assignés pour cette semaine.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
