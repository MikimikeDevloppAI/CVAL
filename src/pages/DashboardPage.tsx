import { useEffect, useState } from 'react';
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks } from 'date-fns';
import { fr } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import { QuickActionButton } from '@/components/dashboard/QuickActionButton';
import { SiteCalendarCard } from '@/components/dashboard/SiteCalendarCard';
import { StatsCard } from '@/components/dashboard/StatsCard';
import { MedecinsPopup } from '@/components/dashboard/medecins/MedecinsPopup';
import { SecretairesPopup } from '@/components/dashboard/secretaires/SecretairesPopup';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Stethoscope, Users, ClipboardPlus, CalendarX, Loader2 } from 'lucide-react';

interface DayData {
  date: string;
  periode: 'matin' | 'apres_midi';
  medecins: { id: string; nom: string }[];
  secretaires: { 
    id: string; 
    nom: string; 
    validated: boolean;
    is_1r?: boolean;
    is_2f?: boolean;
  }[];
  besoin_secretaires: number;
  status: 'satisfait' | 'partiel' | 'non_satisfait';
}

interface DashboardSite {
  site_id: string;
  site_nom: string;
  site_fermeture: boolean;
  days: DayData[];
}

const DashboardPage = () => {
  const [currentWeek, setCurrentWeek] = useState(new Date());
  const [dashboardSites, setDashboardSites] = useState<DashboardSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [medecinsPopupOpen, setMedecinsPopupOpen] = useState(false);
  const [secretairesPopupOpen, setSecretairesPopupOpen] = useState(false);
  const [stats, setStats] = useState({
    activeSites: 0,
    totalSecretary: 0,
    todayOperations: 0,
    pendingAbsences: 0
  });

  const startDate = format(startOfWeek(currentWeek, { locale: fr }), 'yyyy-MM-dd');
  const endDate = format(endOfWeek(currentWeek, { locale: fr }), 'yyyy-MM-dd');

  const calculateStatus = (besoin: number, assigne: number): 'satisfait' | 'partiel' | 'non_satisfait' => {
    if (assigne >= besoin) return 'satisfait';
    if (assigne >= Math.floor(besoin)) return 'partiel';
    return 'non_satisfait';
  };

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      // Fetch active sites
      const { data: sites } = await supabase
        .from('sites')
        .select('*')
        .eq('actif', true)
        .order('nom');

      if (!sites) return;

      // Fetch stats
      const { data: secretaires } = await supabase
        .from('secretaires')
        .select('id')
        .eq('actif', true);

      const today = format(new Date(), 'yyyy-MM-dd');
      const { data: todayOps } = await supabase
        .from('planning_genere_bloc_operatoire')
        .select('id')
        .eq('date', today)
        .neq('statut', 'annule');

      const { data: absences } = await supabase
        .from('absences')
        .select('id')
        .eq('statut', 'en_attente');

      setStats({
        activeSites: sites.length,
        totalSecretary: secretaires?.length || 0,
        todayOperations: todayOps?.length || 0,
        pendingAbsences: absences?.length || 0
      });

      // Fetch dashboard data for each site
      const dashboardData = await Promise.all(
        sites.map(async (site) => {
          // Fetch besoins effectifs (médecins)
          const { data: besoins } = await supabase
            .from('besoin_effectif')
            .select(`
              *,
              medecins(id, first_name, name)
            `)
            .eq('site_id', site.id)
            .gte('date', startDate)
            .lte('date', endDate)
            .eq('type', 'medecin')
            .order('date');

          // Fetch planning généré (secrétaires)
          const { data: planning } = await supabase
            .from('planning_genere_personnel')
            .select(`
              *,
              secretaires(id, first_name, name)
            `)
            .eq('site_id', site.id)
            .gte('date', startDate)
            .lte('date', endDate)
            .eq('type_assignation', 'site')
            .order('date');

          // Group by date and period
          const daysMap = new Map<string, DayData>();
          
          // Process besoins
          besoins?.forEach((besoin) => {
            const key = `${besoin.date}-${besoin.demi_journee}`;
            if (!daysMap.has(key)) {
              daysMap.set(key, {
                date: besoin.date,
                periode: besoin.demi_journee === 'matin' ? 'matin' : 'apres_midi',
                medecins: [],
                secretaires: [],
                besoin_secretaires: 0,
                status: 'non_satisfait'
              });
            }
            const day = daysMap.get(key)!;
            if (besoin.medecins) {
              day.medecins.push({
                id: besoin.medecins.id,
                nom: `${besoin.medecins.first_name || ''} ${besoin.medecins.name || ''}`.trim()
              });
              day.besoin_secretaires += 1.2; // Average per doctor
            }
          });

          // Process planning
          planning?.forEach((plan) => {
            const periode = plan.periode === 'matin' ? 'matin' : 'apres_midi';
            const key = `${plan.date}-${periode}`;
            if (!daysMap.has(key)) {
              daysMap.set(key, {
                date: plan.date,
                periode,
                medecins: [],
                secretaires: [],
                besoin_secretaires: 0,
                status: 'non_satisfait'
              });
            }
            const day = daysMap.get(key)!;
            if (plan.secretaires) {
              day.secretaires.push({
                id: plan.secretaires.id,
                nom: `${plan.secretaires.first_name || ''} ${plan.secretaires.name || ''}`.trim(),
                validated: plan.validated || false,
                is_1r: plan.is_1r,
                is_2f: plan.is_2f
              });
            }
          });

          // Calculate status for each day
          const days = Array.from(daysMap.values()).map(day => ({
            ...day,
            status: calculateStatus(day.besoin_secretaires, day.secretaires.length)
          }));

          return {
            site_id: site.id,
            site_nom: site.nom,
            site_fermeture: site.fermeture || false,
            days
          };
        })
      );

      setDashboardSites(dashboardData);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, [currentWeek]);

  // Real-time updates
  useEffect(() => {
    const channel = supabase
      .channel('dashboard-updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'planning_genere_personnel'
        },
        () => {
          fetchDashboardData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentWeek]);

  const handlePreviousWeek = () => {
    setCurrentWeek(subWeeks(currentWeek, 1));
  };

  const handleNextWeek = () => {
    setCurrentWeek(addWeeks(currentWeek, 1));
  };

  const handleToday = () => {
    setCurrentWeek(new Date());
  };

  return (
    <div className="w-full space-y-6">
      {/* Quick Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <QuickActionButton
          label="Médecins"
          icon={<Stethoscope className="h-6 w-6" />}
          onClick={() => setMedecinsPopupOpen(true)}
          gradient="from-cyan-500 to-blue-500"
          count={0}
        />
          <QuickActionButton
            label="Assistants médicaux"
            icon={<Users className="h-6 w-6" />}
            onClick={() => setSecretairesPopupOpen(true)}
            gradient="from-teal-500 to-cyan-500"
            count={stats.totalSecretary}
          />
        <QuickActionButton
          label="Opérations"
          icon={<ClipboardPlus className="h-6 w-6" />}
          href="/operations"
          gradient="from-emerald-500 to-teal-500"
          count={stats.todayOperations}
        />
        <QuickActionButton
          label="Absences"
          icon={<CalendarX className="h-6 w-6" />}
          href="/absences"
          gradient="from-green-500 to-emerald-500"
          count={stats.pendingAbsences}
        />
      </div>

      {/* Week Selector */}
      <div className="flex items-center justify-between bg-card/50 backdrop-blur-xl border border-border/50 rounded-xl p-4 shadow-lg">
        <Button
          variant="ghost"
          size="icon"
          onClick={handlePreviousWeek}
          className="hover:bg-primary/10"
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
        
        <div className="flex items-center gap-4">
          <div className="text-center">
            <p className="text-sm text-muted-foreground">Semaine du</p>
            <p className="text-lg font-semibold">
              {format(startOfWeek(currentWeek, { locale: fr }), 'dd MMMM yyyy', { locale: fr })}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleToday}
            className="hover:bg-primary/10"
          >
            Aujourd'hui
          </Button>
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={handleNextWeek}
          className="hover:bg-primary/10"
        >
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>

      {/* Sites Calendar Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {dashboardSites.map((site, index) => (
            <SiteCalendarCard
              key={site.site_id}
              site={site}
              startDate={startDate}
              endDate={endDate}
              index={index}
            />
          ))}
        </div>
      )}

      <MedecinsPopup 
        open={medecinsPopupOpen} 
        onOpenChange={setMedecinsPopupOpen}
      />
      
      <SecretairesPopup 
        open={secretairesPopupOpen} 
        onOpenChange={setSecretairesPopupOpen}
      />
    </div>
  );
};

export default DashboardPage;
