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

                const hasMatin = dayData.medecins.some(m => m.periode === 'matin') || 
                                 dayData.secretaires.some(s => s.periode === 'matin');
                const hasApresMidi = dayData.medecins.some(m => m.periode === 'apres_midi') || 
                                     dayData.secretaires.some(s => s.periode === 'apres_midi');

                const matinMedecins = dayData.medecins.filter(m => m.periode === 'matin');
                const apresMidiMedecins = dayData.medecins.filter(m => m.periode === 'apres_midi');
                const matinSecretaires = dayData.secretaires.filter(s => s.periode === 'matin');
                const apresMidiSecretaires = dayData.secretaires.filter(s => s.periode === 'apres_midi');

                const hasDeficitMatin = dayData.status_matin === 'non_satisfait';
                const hasDeficitApresMidi = dayData.status_apres_midi === 'non_satisfait';

                return (
                  <TableCell
                    key={dateStr}
                    className={cn(
                      "p-2 cursor-pointer hover:bg-accent/50 transition-colors",
                      (hasDeficitMatin || hasDeficitApresMidi) && "border-l-2 border-l-destructive"
                    )}
                    onClick={() => onDayClick?.(site.site_id, dateStr)}
                  >
                    <div className="space-y-2 text-xs">
                      {/* Matin */}
                      {hasMatin && (
                        <div className={cn(
                          "p-1.5 rounded border",
                          hasDeficitMatin ? "bg-destructive/10 border-destructive/30" : "bg-card"
                        )}>
                          <div className="flex items-center gap-1 mb-1">
                            <Badge variant="outline" className="text-[10px] px-1 py-0 bg-blue-500 text-white">
                              M
                            </Badge>
                            {hasDeficitMatin && (
                              <AlertCircle className="h-3 w-3 text-destructive" />
                            )}
                          </div>
                          
                          {matinMedecins.length > 0 && (
                            <div className="mb-1">
                              <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-0.5">
                                <Stethoscope className="h-2.5 w-2.5" />
                                <span>Médecins</span>
                              </div>
                              <div className="space-y-0.5">
                                {matinMedecins.slice(0, 2).map(m => (
                                  <div key={m.id} className="text-[10px] truncate">
                                    {m.nom_complet}
                                  </div>
                                ))}
                                {matinMedecins.length > 2 && (
                                  <span className="text-[10px] text-primary">+{matinMedecins.length - 2}</span>
                                )}
                              </div>
                            </div>
                          )}

                          {matinSecretaires.length > 0 && (
                            <div>
                              <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-0.5">
                                <User className="h-2.5 w-2.5" />
                                <span>Assistants</span>
                              </div>
                              <div className="space-y-0.5">
                                {matinSecretaires.slice(0, 2).map(s => (
                                  <div key={s.id} className="text-[10px] truncate">
                                    {s.nom_complet}
                                  </div>
                                ))}
                                {matinSecretaires.length > 2 && (
                                  <span className="text-[10px] text-primary">+{matinSecretaires.length - 2}</span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Après-midi */}
                      {hasApresMidi && (
                        <div className={cn(
                          "p-1.5 rounded border",
                          hasDeficitApresMidi ? "bg-destructive/10 border-destructive/30" : "bg-card"
                        )}>
                          <div className="flex items-center gap-1 mb-1">
                            <Badge variant="outline" className="text-[10px] px-1 py-0 bg-yellow-500 text-white">
                              AM
                            </Badge>
                            {hasDeficitApresMidi && (
                              <AlertCircle className="h-3 w-3 text-destructive" />
                            )}
                          </div>
                          
                          {apresMidiMedecins.length > 0 && (
                            <div className="mb-1">
                              <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-0.5">
                                <Stethoscope className="h-2.5 w-2.5" />
                                <span>Médecins</span>
                              </div>
                              <div className="space-y-0.5">
                                {apresMidiMedecins.slice(0, 2).map(m => (
                                  <div key={m.id} className="text-[10px] truncate">
                                    {m.nom_complet}
                                  </div>
                                ))}
                                {apresMidiMedecins.length > 2 && (
                                  <span className="text-[10px] text-primary">+{apresMidiMedecins.length - 2}</span>
                                )}
                              </div>
                            </div>
                          )}

                          {apresMidiSecretaires.length > 0 && (
                            <div>
                              <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-0.5">
                                <User className="h-2.5 w-2.5" />
                                <span>Assistants</span>
                              </div>
                              <div className="space-y-0.5">
                                {apresMidiSecretaires.slice(0, 2).map(s => (
                                  <div key={s.id} className="text-[10px] truncate">
                                    {s.nom_complet}
                                  </div>
                                ))}
                                {apresMidiSecretaires.length > 2 && (
                                  <span className="text-[10px] text-primary">+{apresMidiSecretaires.length - 2}</span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {!hasMatin && !hasApresMidi && (
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
