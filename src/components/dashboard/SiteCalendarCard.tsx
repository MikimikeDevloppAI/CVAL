import { useState, useEffect } from 'react';
import { format, eachDayOfInterval, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { DayCell } from './DayCell';
import { DayDetailDialog } from './DayDetailDialog';
import { SecretaireActionsDialog } from './SecretaireActionsDialog';
import { MedecinActionsDialog } from './MedecinActionsDialog';
import { AddMedecinToDayDialog } from './AddMedecinToDayDialog';
import { AddSecretaireToDayDialog } from './AddSecretaireToDayDialog';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
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

  // Filter out Sundays (day 0)
  const days = eachDayOfInterval({
    start: parseISO(startDate),
    end: parseISO(endDate)
  }).filter(day => day.getDay() !== 0);

  const getDayData = (date: Date): DayData | null => {
    const dateStr = format(date, 'yyyy-MM-dd');
    return site.days.find(d => d.date === dateStr) || null;
  };

  const handleOpenDetail = (date: Date, data: DayData) => {
    setSelectedDay({ date, data });
  };

  const handleSecretaireClick = async (secretaireId: string, secretaireNom: string, secretairePrenom: string, periode: 'matin' | 'apres_midi' | 'journee', date: Date) => {
    // Fetch capacite data to determine besoin
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
    // Fetch besoin_effectif data to determine periode
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

  // Realtime refresh for exchanges and updates affecting this site in the visible range
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
          {hasIssues && (
            <Badge variant="outline" className="bg-cyan-500/10 text-cyan-600 border-cyan-500/20">
              Besoins non satisfaits
            </Badge>
          )}
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="p-4">
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
          {/* Day Headers */}
          {days.map((day) => {
            const dayData = getDayData(day);
            
            // Calculate needs and capacities for morning and afternoon
            let besoinMatin = 0;
            let capaciteMatin = 0;
            let besoinAM = 0;
            let capaciteAM = 0;
            
            if (dayData) {
              const isSaturday = day.getDay() === 6;
              
              if (isSaturday) {
                // For Saturday: count 1 need per doctor
                besoinMatin = dayData.medecins.filter(m => m.matin).length;
                besoinAM = dayData.medecins.filter(m => m.apres_midi).length;
              } else {
                // For other days: use calculated needs
                besoinMatin = Math.ceil(dayData.besoin_secretaires_matin);
                besoinAM = Math.ceil(dayData.besoin_secretaires_apres_midi);
              }
              
              capaciteMatin = dayData.secretaires.filter(s => s.matin).length;
              capaciteAM = dayData.secretaires.filter(s => s.apres_midi).length;
            }

            const hasManqueMatin = besoinMatin > capaciteMatin;
            const hasManqueAM = besoinAM > capaciteAM;

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
                {dayData && (hasManqueMatin || hasManqueAM) && (
                  <div className="mt-1 space-y-0.5">
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
