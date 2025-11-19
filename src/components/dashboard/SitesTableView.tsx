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
            <TableHead className="sticky left-[200px] z-20 bg-background min-w-[120px] border-r text-center">
              Type
            </TableHead>
            {weekdaysOnly.map(date => (
              <TableHead key={format(date, 'yyyy-MM-dd')} className="text-center min-w-[150px]">
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
          {sites.map(site => {
            // Pour chaque site, on crée 2 lignes : médecins et assistants
            return (
              <>
                {/* Ligne Médecins */}
                <TableRow key={`${site.site_id}-medecins`} className="hover:bg-muted/50">
                  <TableCell 
                    rowSpan={2} 
                    className="sticky left-0 z-10 bg-background font-medium border-r align-top"
                  >
                    <div className="flex flex-col">
                      <span className="font-semibold text-sm">{site.site_nom}</span>
                      {site.fermeture && (
                        <Badge variant="outline" className="mt-1 w-fit text-xs">
                          Fermeture
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="sticky left-[200px] z-10 bg-background text-xs font-medium text-muted-foreground border-r py-2">
                    <div className="flex items-center gap-1">
                      <Stethoscope className="h-3 w-3" />
                      <span>Médecins</span>
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

                    const medecins = dayData.medecins.map(m => ({
                      ...m,
                      isMatinOnly: m.matin && !m.apres_midi,
                      isApresMidiOnly: !m.matin && m.apres_midi,
                      isFullDay: m.matin && m.apres_midi
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
                        <div className="space-y-1">
                          {medecins.length > 0 ? (
                            medecins.map(m => (
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
                            ))
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </div>
                      </TableCell>
                    );
                  })}
                </TableRow>

                {/* Ligne Assistants médicaux */}
                <TableRow key={`${site.site_id}-assistants`} className="hover:bg-muted/50 border-b-2">
                  <TableCell className="sticky left-[200px] z-10 bg-background text-xs font-medium text-muted-foreground border-r py-2">
                    <div className="flex items-center gap-1">
                      <User className="h-3 w-3" />
                      <span>Assistants médicaux</span>
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

                    const secretaires = dayData.secretaires.map(s => ({
                      ...s,
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
                        <div className="space-y-1">
                          {secretaires.length > 0 ? (
                            secretaires.map(s => (
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
                            ))
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </div>
                      </TableCell>
                    );
                  })}
                </TableRow>
              </>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
