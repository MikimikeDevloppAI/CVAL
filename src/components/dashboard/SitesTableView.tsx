import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { DashboardSite } from '@/pages/DashboardPage';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { User, Stethoscope, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SitesTableViewProps {
  sites: DashboardSite[];
  weekDays: Date[];
  onDayClick?: (siteId: string, date: string) => void;
}

export function SitesTableView({ sites, weekDays, onDayClick }: SitesTableViewProps) {
  // Filtrer les jours ouvrés (lundi-vendredi)
  const weekdaysOnly = weekDays.filter(d => {
    const dow = d.getDay();
    return dow !== 0 && dow !== 6;
  });

  const getDayData = (site: DashboardSite, date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    return site.days.find(d => d.date === dateStr);
  };

  return (
    <div className="relative overflow-x-auto border rounded-lg">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-background">
          <TableRow>
            <TableHead className="sticky left-0 z-20 bg-background min-w-[200px] border-r">
              Site
            </TableHead>
            {weekdaysOnly.map(date => (
              <TableHead key={format(date, 'yyyy-MM-dd')} className="text-center min-w-[180px]">
                <div className="flex flex-col items-center">
                  <span className="text-xs font-medium text-muted-foreground">
                    {format(date, 'EEE', { locale: fr })}
                  </span>
                  <span className="text-lg font-semibold">
                    {format(date, 'd', { locale: fr })}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {format(date, 'MMM', { locale: fr })}
                  </span>
                </div>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sites.map(site => (
            <TableRow key={site.site_id} className="hover:bg-muted/50">
              <TableCell className="sticky left-0 z-10 bg-background font-medium border-r">
                <div className="flex flex-col">
                  <span className="font-semibold text-sm">{site.site_nom}</span>
                  {site.fermeture && (
                    <Badge variant="outline" className="mt-1 w-fit text-xs">
                      Fermeture
                    </Badge>
                  )}
                </div>
              </TableCell>
              {weekdaysOnly.map(date => {
                const dayData = getDayData(site, date);
                const dateStr = format(date, 'yyyy-MM-dd');

                if (!dayData) {
                  return (
                    <TableCell key={dateStr} className="text-center text-muted-foreground text-xs">
                      -
                    </TableCell>
                  );
                }

                // Regrouper médecins et secrétaires avec leur période
                const allMedecins = dayData.medecins.map(m => ({
                  ...m,
                  type: 'medecin' as const,
                  isMatinOnly: m.matin && !m.apres_midi,
                  isApresMidiOnly: !m.matin && m.apres_midi,
                  isFullDay: m.matin && m.apres_midi
                }));
                
                const allSecretaires = dayData.secretaires.map(s => ({
                  ...s,
                  type: 'secretaire' as const,
                  isMatinOnly: s.matin && !s.apres_midi,
                  isApresMidiOnly: !s.matin && s.apres_midi,
                  isFullDay: s.matin && s.apres_midi
                }));

                const hasDeficit = dayData.status_matin === 'non_satisfait' || 
                                  dayData.status_apres_midi === 'non_satisfait';

                return (
                  <TableCell
                    key={dateStr}
                    className={cn(
                      "p-2 cursor-pointer hover:bg-accent/50 transition-colors align-top",
                      hasDeficit && "border-l-2 border-l-destructive"
                    )}
                    onClick={() => onDayClick?.(site.site_id, dateStr)}
                  >
                    <div className="space-y-2 text-xs">
                      {/* Médecins */}
                      {allMedecins.length > 0 && (
                        <div>
                          <div className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground mb-1 pb-1 border-b">
                            <Stethoscope className="h-3 w-3" />
                            <span>Médecins</span>
                          </div>
                          <div className="space-y-1">
                            {allMedecins.map(m => (
                              <div key={m.id} className="flex items-center gap-1.5">
                                <div className={cn(
                                  "w-2 h-2 rounded-full flex-shrink-0",
                                  m.isMatinOnly && "bg-blue-500",
                                  m.isApresMidiOnly && "bg-yellow-500",
                                  m.isFullDay && "bg-green-500"
                                )} />
                                <span className="text-[10px] truncate">
                                  {m.nom_complet || `${m.prenom || ''} ${m.nom}`.trim()}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Assistants médicaux */}
                      {allSecretaires.length > 0 && (
                        <div>
                          <div className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground mb-1 pb-1 border-b">
                            <User className="h-3 w-3" />
                            <span>Assistants médicaux</span>
                          </div>
                          <div className="space-y-1">
                            {allSecretaires.map(s => (
                              <div key={s.id} className="flex items-center gap-1.5">
                                <div className={cn(
                                  "w-2 h-2 rounded-full flex-shrink-0",
                                  s.isMatinOnly && "bg-blue-500",
                                  s.isApresMidiOnly && "bg-yellow-500",
                                  s.isFullDay && "bg-green-500"
                                )} />
                                <span className="text-[10px] truncate">
                                  {s.nom_complet || `${s.prenom || ''} ${s.nom}`.trim()}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {allMedecins.length === 0 && allSecretaires.length === 0 && (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </div>
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
