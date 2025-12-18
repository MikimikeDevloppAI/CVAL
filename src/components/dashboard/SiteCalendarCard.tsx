import { useState, useEffect } from 'react';
import { format, eachDayOfInterval, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';
import { DayCell } from './DayCell';
import { DayDetailDialog } from './DayDetailDialog';
import { SecretaireActionsDialog } from './SecretaireActionsDialog';
import { MedecinActionsDialog } from './MedecinActionsDialog';
import { AddMedecinToDayDialog } from './AddMedecinToDayDialog';
import { AddSecretaireToDayDialog } from './AddSecretaireToDayDialog';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';

interface DeficitDetail {
  besoin_operation_nom: string;
  nombre_requis: number;
  nombre_assigne: number;
  balance: number;
}

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
  deficits_matin?: DeficitDetail[];
  deficits_apres_midi?: DeficitDetail[];
}

interface DashboardSite {
  site_id: string;
  site_nom: string;
  site_fermeture: boolean;
  days: DayData[];
}

interface SiteCalendarCardProps {
  site: DashboardSite;
  startDate: string;
  endDate: string;
  index: number;
  onRefresh: () => void;
}

export const SiteCalendarCard = ({ site, startDate, endDate, index, onRefresh }: SiteCalendarCardProps) => {
  const [selectedDay, setSelectedDay] = useState<{ date: Date; data: DayData } | null>(null);
  const [selectedSecretaire, setSelectedSecretaire] = useState<{
    id: string;
    nom: string;
    prenom: string;
    date: Date;
    periode: 'matin' | 'apres_midi' | 'journee';
    besoinOperationId?: string | null;
  } | null>(null);
  const [selectedMedecin, setSelectedMedecin] = useState<{
    id: string;
    nom: string;
    prenom: string;
    date: Date;
    periode: 'matin' | 'apres_midi' | 'journee';
  } | null>(null);
  const [addMedecinDate, setAddMedecinDate] = useState<Date | null>(null);
  const [addSecretaireDate, setAddSecretaireDate] = useState<Date | null>(null);
  const [currentDayIndex, setCurrentDayIndex] = useState(0);

  // Filter out Sundays (day 0), keep Saturdays only if there's data
  const days = eachDayOfInterval({
    start: parseISO(startDate),
    end: parseISO(endDate)
  }).filter(day => {
    const dow = day.getDay();
    if (dow === 0) return false;
    
    if (dow === 6) {
      const dateStr = format(day, 'yyyy-MM-dd');
      const dayData = site.days.find(d => d.date === dateStr);
      return dayData && (dayData.medecins.length > 0 || dayData.secretaires.length > 0);
    }
    
    return true;
  });

  const getDayData = (date: Date): DayData | null => {
    const dateStr = format(date, 'yyyy-MM-dd');
    return site.days.find(d => d.date === dateStr) || null;
  };

  const handleOpenDetail = (date: Date, data: DayData) => {
    setSelectedDay({ date, data });
  };

  const handleSecretaireClick = async (secretaireId: string, secretaireNom: string, secretairePrenom: string, periode: 'matin' | 'apres_midi' | 'journee', date: Date) => {
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
    });
  };

  const handleMedecinClick = (medecinId: string, medecinNom: string, medecinPrenom: string, date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    supabase
      .from('besoin_effectif')
      .select('demi_journee')
      .eq('medecin_id', medecinId)
      .eq('date', dateStr)
      .eq('site_id', site.site_id)
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
          });
        }
      });
  };

  const hasIssues = site.days.some(d => d.status_matin !== 'satisfait' || d.status_apres_midi !== 'satisfait');

  useEffect(() => {
    const channel = supabase
      .channel(`site-card-${site.site_id}-${startDate}-${endDate}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'capacite_effective' },
        (payload) => {
          const d = (payload.new as any)?.date || (payload.old as any)?.date;
          const newSiteId = (payload.new as any)?.site_id;
          const oldSiteId = (payload.old as any)?.site_id;
          if (!d) return;
          if (d >= startDate && d <= endDate && (newSiteId === site.site_id || oldSiteId === site.site_id)) {
            onRefresh();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [site.site_id, startDate, endDate, onRefresh]);

  // Render deficit hover content
  const renderDeficitHover = (
    besoinMatin: number,
    capaciteMatin: number,
    besoinAM: number,
    capaciteAM: number,
    hasManqueMatin: boolean,
    hasManqueAM: boolean,
    dayData: DayData | null
  ) => {
    const deficitsMatin = dayData?.deficits_matin || [];
    const deficitsAM = dayData?.deficits_apres_midi || [];
    
    return (
      <div className="space-y-3">
        {hasManqueMatin && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <span className="font-semibold text-destructive">Matin: {capaciteMatin}/{Math.ceil(besoinMatin)}</span>
            </div>
            {deficitsMatin.length > 0 ? (
              <ul className="text-sm space-y-1 pl-6">
                {deficitsMatin.map((d, i) => (
                  <li key={i} className="text-muted-foreground">
                    • {d.besoin_operation_nom}: {d.nombre_assigne}/{d.nombre_requis}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground pl-6">
                {Math.ceil(besoinMatin) - capaciteMatin} assistant(s) manquant(s)
              </p>
            )}
          </div>
        )}
        {hasManqueAM && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <span className="font-semibold text-destructive">Après-midi: {capaciteAM}/{Math.ceil(besoinAM)}</span>
            </div>
            {deficitsAM.length > 0 ? (
              <ul className="text-sm space-y-1 pl-6">
                {deficitsAM.map((d, i) => (
                  <li key={i} className="text-muted-foreground">
                    • {d.besoin_operation_nom}: {d.nombre_assigne}/{d.nombre_requis}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground pl-6">
                {Math.ceil(besoinAM) - capaciteAM} assistant(s) manquant(s)
              </p>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className={cn(
        "rounded-xl overflow-hidden",
        "bg-card/50 backdrop-blur-xl border border-border/50",
        "shadow-lg",
        "transition-all duration-300 ease-out",
        "animate-fade-in"
      )}
      style={{ animationDelay: `${index * 100}ms` }}
    >
      {/* Header */}
      <div className="p-6 border-b border-border/50 bg-gradient-to-r from-primary/5 to-transparent">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-foreground">
              {site.site_nom}
            </h3>
          </div>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="p-4">
        {/* Mobile navigation */}
        <div className="md:hidden flex items-center justify-between mb-4">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setCurrentDayIndex(Math.max(0, currentDayIndex - 1))}
            disabled={currentDayIndex === 0}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="text-center">
            <p className="text-sm font-semibold text-foreground">
              {format(days[currentDayIndex], 'EEEE d MMMM', { locale: fr })}
            </p>
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setCurrentDayIndex(Math.min(days.length - 1, currentDayIndex + 1))}
            disabled={currentDayIndex === days.length - 1}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="hidden md:grid gap-2" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
          {/* Day Headers */}
          {days.map((day) => {
            const dayData = getDayData(day);
            const isSaturday = day.getDay() === 6;
            
            let besoinMatin = 0;
            let capaciteMatin = 0;
            let besoinAM = 0;
            let capaciteAM = 0;
            
            if (dayData) {
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
            const hasAnyManque = hasManqueMatin || hasManqueAM;

            return (
              <div
                key={day.toISOString()}
                className="text-center pb-2 border-b border-border/30"
              >
                <p className="text-xs font-medium text-muted-foreground uppercase">
                  {format(day, 'EEE', { locale: fr })}
                </p>
                <p className="text-sm font-semibold text-foreground mt-1">
                  {format(day, 'd', { locale: fr })}
                </p>
                {dayData && hasAnyManque && (
                  <HoverCard openDelay={200}>
                    <HoverCardTrigger asChild>
                      <div className="mt-1 space-y-0.5 cursor-help">
                        {hasManqueMatin && (
                          <p className="text-[10px] font-semibold text-destructive">
                            M: {capaciteMatin}/{besoinMatin}
                          </p>
                        )}
                        {hasManqueAM && (
                          <p className="text-[10px] font-semibold text-destructive">
                            AM: {capaciteAM}/{besoinAM}
                          </p>
                        )}
                      </div>
                    </HoverCardTrigger>
                    <HoverCardContent className="w-72" side="bottom">
                      <div className="space-y-2">
                        <h4 className="font-semibold text-sm">
                          Besoins non couverts - {format(day, 'd MMMM', { locale: fr })}
                        </h4>
                        {renderDeficitHover(besoinMatin, capaciteMatin, besoinAM, capaciteAM, hasManqueMatin, hasManqueAM, dayData)}
                      </div>
                    </HoverCardContent>
                  </HoverCard>
                )}
              </div>
            );
          })}

          {/* Day Cells */}
          {days.map((day) => {
            const dayData = getDayData(day);
            return (
              <DayCell
                key={day.toISOString()}
                date={day}
                data={dayData}
                onOpenDetail={handleOpenDetail}
                onSecretaireClick={(id, nom, prenom, periode) => handleSecretaireClick(id, nom, prenom, periode, day)}
                onMedecinClick={(id, nom, prenom) => handleMedecinClick(id, nom, prenom, day)}
                onAddMedecin={(date) => setAddMedecinDate(date)}
                onAddSecretaire={(date) => setAddSecretaireDate(date)}
              />
            );
          })}
        </div>

        {/* Mobile single day view */}
        <div className="md:hidden">
          {(() => {
            const day = days[currentDayIndex];
            const dayData = getDayData(day);
            const isSaturday = day.getDay() === 6;
            
            let besoinMatin = 0;
            let capaciteMatin = 0;
            let besoinAM = 0;
            let capaciteAM = 0;
            
            if (dayData) {
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
              <div>
                <div className="text-center pb-2 mb-2 border-b border-border/30">
                  {dayData && (hasManqueMatin || hasManqueAM) && (
                    <HoverCard openDelay={200}>
                      <HoverCardTrigger asChild>
                        <div className="space-y-0.5 cursor-help">
                          {hasManqueMatin && (
                            <p className="text-sm font-semibold text-destructive">
                              Matin: {capaciteMatin}/{besoinMatin}
                            </p>
                          )}
                          {hasManqueAM && (
                            <p className="text-sm font-semibold text-destructive">
                              Après-midi: {capaciteAM}/{besoinAM}
                            </p>
                          )}
                        </div>
                      </HoverCardTrigger>
                      <HoverCardContent className="w-72">
                        <div className="space-y-2">
                          <h4 className="font-semibold text-sm">
                            Besoins non couverts - {format(day, 'd MMMM', { locale: fr })}
                          </h4>
                          {renderDeficitHover(besoinMatin, capaciteMatin, besoinAM, capaciteAM, hasManqueMatin, hasManqueAM, dayData)}
                        </div>
                      </HoverCardContent>
                    </HoverCard>
                  )}
                </div>
                
                <DayCell
                  date={day}
                  data={dayData}
                  onOpenDetail={handleOpenDetail}
                  onSecretaireClick={(id, nom, prenom, periode) => handleSecretaireClick(id, nom, prenom, periode, day)}
                  onMedecinClick={(id, nom, prenom) => handleMedecinClick(id, nom, prenom, day)}
                  onAddMedecin={(date) => setAddMedecinDate(date)}
                  onAddSecretaire={(date) => setAddSecretaireDate(date)}
                />
              </div>
            );
          })()}
        </div>
      </div>

      {selectedDay && (
        <DayDetailDialog
          open={!!selectedDay}
          onOpenChange={(open) => !open && setSelectedDay(null)}
          date={selectedDay.date}
          siteId={site.site_id}
          siteName={site.site_nom}
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
          siteId={site.site_id}
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
          siteId={site.site_id}
          periode={selectedMedecin.periode}
          onRefresh={onRefresh}
        />
      )}

      {addMedecinDate && (
        <AddMedecinToDayDialog
          open={!!addMedecinDate}
          onOpenChange={(open) => !open && setAddMedecinDate(null)}
          date={format(addMedecinDate, 'yyyy-MM-dd')}
          siteId={site.site_id}
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
          date={format(addSecretaireDate, 'yyyy-MM-dd')}
          siteId={site.site_id}
          siteName={site.site_nom}
          onSuccess={() => {
            setAddSecretaireDate(null);
            onRefresh();
          }}
        />
      )}
    </div>
  );
};
