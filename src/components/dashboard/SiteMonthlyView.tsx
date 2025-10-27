import { useState, useEffect, useRef } from 'react';
import { format, eachDayOfInterval, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { DayCell } from './DayCell';
import { DayDetailDialog } from './DayDetailDialog';
import { SecretaireActionsDialog } from './SecretaireActionsDialog';
import { MedecinActionsDialog } from './MedecinActionsDialog';
import { AddMedecinToDayDialog } from './AddMedecinToDayDialog';
import { AddSecretaireToDayDialog } from './AddSecretaireToDayDialog';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';

interface PersonnePresence {
  id: string;
  nom: string;
  prenom?: string;
  matin: boolean;
  apres_midi: boolean;
  validated?: boolean;
  is_1r?: boolean;
  is_2f?: boolean;
  is_3f?: boolean;
}

interface DayData {
  date: string;
  medecins: PersonnePresence[];
  secretaires: PersonnePresence[];
  besoin_secretaires_matin: number;
  besoin_secretaires_apres_midi: number;
  status_matin: 'satisfait' | 'partiel' | 'non_satisfait';
  status_apres_midi: 'satisfait' | 'partiel' | 'non_satisfait';
}

interface DashboardSite {
  site_id: string;
  site_nom: string;
  site_fermeture: boolean;
  days: DayData[];
}

interface SiteMonthlyViewProps {
  sites: DashboardSite[];
  startDate: string;
  endDate: string;
  onRefresh: () => void;
}

export const SiteMonthlyView = ({ sites, startDate, endDate, onRefresh }: SiteMonthlyViewProps) => {
  const [selectedDay, setSelectedDay] = useState<{ date: Date; siteId: string; siteName: string; data: DayData } | null>(null);
  const [selectedSecretaire, setSelectedSecretaire] = useState<{
    id: string;
    nom: string;
    prenom: string;
    date: Date;
    periode: 'matin' | 'apres_midi' | 'journee';
    besoinOperationId?: string | null;
    siteId: string;
  } | null>(null);
  const [selectedMedecin, setSelectedMedecin] = useState<{
    id: string;
    nom: string;
    prenom: string;
    date: Date;
    periode: 'matin' | 'apres_midi' | 'journee';
    siteId: string;
  } | null>(null);
  const [addMedecinDate, setAddMedecinDate] = useState<{ date: Date; siteId: string } | null>(null);
  const [addSecretaireDate, setAddSecretaireDate] = useState<{ date: Date; siteId: string; siteName: string } | null>(null);

  // Filter out Sundays
  const days = eachDayOfInterval({
    start: parseISO(startDate),
    end: parseISO(endDate)
  }).filter(day => day.getDay() !== 0);

  const getDayData = (site: DashboardSite, date: Date): DayData | null => {
    const dateStr = format(date, 'yyyy-MM-dd');
    return site.days.find(d => d.date === dateStr) || null;
  };

  const handleOpenDetail = (date: Date, siteId: string, siteName: string, data: DayData) => {
    setSelectedDay({ date, siteId, siteName, data });
  };

  const handleSecretaireClick = async (
    secretaireId: string,
    secretaireNom: string,
    secretairePrenom: string,
    periode: 'matin' | 'apres_midi' | 'journee',
    date: Date,
    siteId: string
  ) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    const { data: capacites } = await supabase
      .from('capacite_effective')
      .select('besoin_operation_id')
      .eq('secretaire_id', secretaireId)
      .eq('date', dateStr)
      .eq('actif', true)
      .limit(1)
      .maybeSingle();

    setSelectedSecretaire({
      id: secretaireId,
      nom: secretaireNom,
      prenom: secretairePrenom,
      date,
      periode,
      besoinOperationId: capacites?.besoin_operation_id || null,
      siteId,
    });
  };

  const handleMedecinClick = (
    medecinId: string,
    medecinNom: string,
    medecinPrenom: string,
    date: Date,
    siteId: string
  ) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    supabase
      .from('besoin_effectif')
      .select('demi_journee')
      .eq('medecin_id', medecinId)
      .eq('date', dateStr)
      .eq('site_id', siteId)
      .eq('type', 'medecin')
      .then(({ data: besoins }) => {
        if (besoins && besoins.length > 0) {
          const hasMatin = besoins.some(b => b.demi_journee === 'matin');
          const hasAM = besoins.some(b => b.demi_journee === 'apres_midi');
          const periode = hasMatin && hasAM ? 'journee' : hasMatin ? 'matin' : 'apres_midi';
          
          setSelectedMedecin({
            id: medecinId,
            nom: medecinNom,
            prenom: medecinPrenom,
            date,
            periode,
            siteId,
          });
        }
      });
  };

  // Realtime refresh
  useEffect(() => {
    const channel = supabase
      .channel(`site-monthly-view-${startDate}-${endDate}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'capacite_effective' },
        (payload) => {
          const d = (payload.new as any)?.date || (payload.old as any)?.date;
          if (!d) return;
          if (d >= startDate && d <= endDate) {
            onRefresh();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [startDate, endDate, onRefresh]);

  const headerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const isSyncingRef = useRef(false);

  const onHeaderScroll = () => {
    if (!headerRef.current || !bodyRef.current) return;
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;
    bodyRef.current.scrollLeft = headerRef.current.scrollLeft;
    requestAnimationFrame(() => { isSyncingRef.current = false; });
  };

  const onBodyScroll = () => {
    if (!headerRef.current || !bodyRef.current) return;
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;
    headerRef.current.scrollLeft = bodyRef.current.scrollLeft;
    requestAnimationFrame(() => { isSyncingRef.current = false; });
  };

  return (
    <div className="relative">
      {/* STICKY HEADER - Days */}
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm border-b border-border/50 shadow-md">
        <div className="flex">
          {/* Top-left corner - Site label */}
          <div className="w-48 shrink-0 border-r border-border/50 bg-card/50">
            <div className="p-4 text-sm font-semibold text-muted-foreground">
              Sites
            </div>
          </div>
          
          {/* Day headers - scrollable */}
          <div className="flex-1 overflow-x-auto scrollbar-thin" ref={headerRef} onScroll={onHeaderScroll}>
            <div className="flex gap-2 p-2 min-w-max">
              {days.map((day) => {
                return (
                  <div
                    key={day.toISOString()}
                    className="w-32 text-center shrink-0"
                  >
                    <p className="text-xs font-medium text-muted-foreground uppercase">
                      {format(day, 'EEE', { locale: fr })}
                    </p>
                    <p className="text-sm font-semibold text-foreground mt-1">
                      {format(day, 'd MMM', { locale: fr })}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* BODY - Sites rows */}
      <div className="flex flex-col">
        {sites.map((site, siteIndex) => {
          const hasIssues = site.days.some(
            d => d.status_matin !== 'satisfait' || d.status_apres_midi !== 'satisfait'
          );

          return (
            <div key={site.site_id} className="flex border-b border-border/30 hover:bg-accent/5 transition-colors">
              {/* Sticky left column - Site name */}
              <div className="w-48 shrink-0 border-r border-border/50 sticky left-0 z-10 bg-card/90 backdrop-blur-sm">
                <div className="p-4">
                  <h3 className="text-sm font-semibold text-foreground mb-1">
                    {site.site_nom}
                  </h3>
                  {hasIssues && (
                    <Badge variant="outline" className="text-xs bg-cyan-500/10 text-cyan-600 border-cyan-500/20">
                      Besoins non satisfaits
                    </Badge>
                  )}
                </div>
              </div>
              
              {/* Day cells */}
              <div className="flex-1 overflow-x-auto scrollbar-thin" ref={bodyRef} onScroll={onBodyScroll}>
                <div className="flex gap-2 p-2 min-w-max">
                  {days.map((day) => {
                    const dayData = getDayData(site, day);
                    
                    // Calculate needs
                    let besoinMatin = 0;
                    let capaciteMatin = 0;
                    let besoinAM = 0;
                    let capaciteAM = 0;
                    
                    if (dayData) {
                      const isSaturday = day.getDay() === 6;
                      
                      if (isSaturday) {
                        besoinMatin = dayData.medecins.filter(m => m.matin).length;
                        besoinAM = dayData.medecins.filter(m => m.apres_midi).length;
                      } else {
                        besoinMatin = Math.ceil(dayData.besoin_secretaires_matin);
                        besoinAM = Math.ceil(dayData.besoin_secretaires_apres_midi);
                      }
                      
                      capaciteMatin = dayData.secretaires.filter(s => s.matin).length;
                      capaciteAM = dayData.secretaires.filter(s => s.apres_midi).length;
                    }

                    const hasManqueMatin = besoinMatin > capaciteMatin;
                    const hasManqueAM = besoinAM > capaciteAM;

                    return (
                      <div key={day.toISOString()} className="w-32 shrink-0 relative">
                        {/* Needs indicator on top of cell */}
                        {dayData && (hasManqueMatin || hasManqueAM) && (
                          <div className="absolute -top-1 left-1 z-10 flex flex-col gap-0.5">
                            {hasManqueMatin && (
                              <div className="text-[10px] font-semibold text-destructive bg-background/90 px-1 rounded">
                                M: {capaciteMatin}/{besoinMatin}
                              </div>
                            )}
                            {hasManqueAM && (
                              <div className="text-[10px] font-semibold text-destructive bg-background/90 px-1 rounded">
                                AM: {capaciteAM}/{besoinAM}
                              </div>
                            )}
                          </div>
                        )}
                        
                        <DayCell
                          date={day}
                          data={dayData}
                          onOpenDetail={(date, data) => handleOpenDetail(date, site.site_id, site.site_nom, data)}
                          onSecretaireClick={(id, nom, prenom, periode) =>
                            handleSecretaireClick(id, nom, prenom, periode, day, site.site_id)
                          }
                          onMedecinClick={(id, nom, prenom) =>
                            handleMedecinClick(id, nom, prenom, day, site.site_id)
                          }
                          onAddMedecin={(date) => setAddMedecinDate({ date, siteId: site.site_id })}
                          onAddSecretaire={(date) =>
                            setAddSecretaireDate({ date, siteId: site.site_id, siteName: site.site_nom })
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Dialogs */}
      {selectedDay && (
        <DayDetailDialog
          open={!!selectedDay}
          onOpenChange={(open) => !open && setSelectedDay(null)}
          date={selectedDay.date}
          siteId={selectedDay.siteId}
          siteName={selectedDay.siteName}
          onRefresh={onRefresh}
        />
      )}

      {selectedSecretaire && (
        <SecretaireActionsDialog
          open={!!selectedSecretaire}
          onOpenChange={(open) => !open && setSelectedSecretaire(null)}
          secretaireId={selectedSecretaire.id}
          secretaireNom={`${selectedSecretaire.prenom} ${selectedSecretaire.nom}`}
          date={format(selectedSecretaire.date, 'yyyy-MM-dd')}
          siteId={selectedSecretaire.siteId}
          periode={selectedSecretaire.periode}
          besoinOperationId={selectedSecretaire.besoinOperationId}
          onRefresh={onRefresh}
        />
      )}

      {selectedMedecin && (
        <MedecinActionsDialog
          open={!!selectedMedecin}
          onOpenChange={(open) => !open && setSelectedMedecin(null)}
          medecinId={selectedMedecin.id}
          medecinNom={selectedMedecin.nom}
          medecinPrenom={selectedMedecin.prenom}
          date={format(selectedMedecin.date, 'yyyy-MM-dd')}
          siteId={selectedMedecin.siteId}
          periode={selectedMedecin.periode}
          onRefresh={onRefresh}
        />
      )}

      {addMedecinDate && (
        <AddMedecinToDayDialog
          open={!!addMedecinDate}
          onOpenChange={(open) => !open && setAddMedecinDate(null)}
          date={format(addMedecinDate.date, 'yyyy-MM-dd')}
          siteId={addMedecinDate.siteId}
          onSuccess={() => {
            setAddMedecinDate(null);
            onRefresh();
          }}
        />
      )}

      {addSecretaireDate && (
        <AddSecretaireToDayDialog
          open={!!addSecretaireDate}
          onOpenChange={(open) => !open && setAddSecretaireDate(null)}
          date={format(addSecretaireDate.date, 'yyyy-MM-dd')}
          siteId={addSecretaireDate.siteId}
          siteName={addSecretaireDate.siteName}
          onSuccess={() => {
            setAddSecretaireDate(null);
            onRefresh();
          }}
        />
      )}
    </div>
  );
};
