import { useEffect, useState } from 'react';
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks } from 'date-fns';
import { fr } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import { QuickActionButton } from '@/components/dashboard/QuickActionButton';
import { SiteCalendarCard } from '@/components/dashboard/SiteCalendarCard';
import { StatsCard } from '@/components/dashboard/StatsCard';
import { MedecinsPopup } from '@/components/dashboard/medecins/MedecinsPopup';
import { SecretairesPopup } from '@/components/dashboard/secretaires/SecretairesPopup';
import { AbsencesJoursFeriesPopup } from '@/components/dashboard/AbsencesJoursFeriesPopup';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Stethoscope, Users, ClipboardPlus, CalendarX, Loader2 } from 'lucide-react';

interface PersonnePresence {
  id: string;
  nom: string;
  matin: boolean;
  apres_midi: boolean;
  validated?: boolean;
  is_1r?: boolean;
  is_2f?: boolean;
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

const DashboardPage = () => {
  const [currentWeek, setCurrentWeek] = useState(new Date());
  const [dashboardSites, setDashboardSites] = useState<DashboardSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [medecinsPopupOpen, setMedecinsPopupOpen] = useState(false);
  const [secretairesPopupOpen, setSecretairesPopupOpen] = useState(false);
  const [absencesPopupOpen, setAbsencesPopupOpen] = useState(false);
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
      // Fetch active sites (exclude bloc opératoire)
      const { data: sites } = await supabase
        .from('sites')
        .select('*')
        .eq('actif', true)
        .not('nom', 'eq', 'Clinique La Vallée - Bloc opératoire')
        .order('nom');

      if (!sites) return;

      // Add administrative site
      const adminSite = {
        id: '00000000-0000-0000-0000-000000000001',
        nom: 'Site Administratif',
        actif: true,
        fermeture: false,
        adresse: '',
        created_at: '',
        updated_at: ''
      };
      const allSites = [...sites, adminSite];

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
        allSites.map(async (site) => {
          const isAdminSite = site.id === '00000000-0000-0000-0000-000000000001';
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

          // Fetch planning généré (secrétaires) + capacité effective
          const planningQuery = supabase
            .from('planning_genere_personnel')
            .select(`
              *,
              secretaires(id, first_name, name)
            `)
            .gte('date', startDate)
            .lte('date', endDate)
            .order('date');

          if (isAdminSite) {
            planningQuery.eq('type_assignation', 'administratif');
          } else {
            planningQuery.eq('site_id', site.id).eq('type_assignation', 'site');
          }

          const { data: planning } = await planningQuery;

          // Fetch capacité effective pour les secrétaires
          const capaciteQuery = supabase
            .from('capacite_effective')
            .select(`
              *,
              secretaires(id, first_name, name)
            `)
            .gte('date', startDate)
            .lte('date', endDate)
            .eq('actif', true)
            .order('date');

          if (!isAdminSite) {
            capaciteQuery.eq('site_id', site.id);
          }

          const { data: capacite } = await capaciteQuery;

          // Group by date only (not by period)
          const daysMap = new Map<string, DayData>();
          
          // Process besoins (médecins)
          besoins?.forEach((besoin) => {
            const date = besoin.date;
            if (!daysMap.has(date)) {
              daysMap.set(date, {
                date,
                medecins: [],
                secretaires: [],
                besoin_secretaires_matin: 0,
                besoin_secretaires_apres_midi: 0,
                status_matin: 'non_satisfait',
                status_apres_midi: 'non_satisfait'
              });
            }
            const day = daysMap.get(date)!;
            
            if (besoin.medecins) {
              const medecinNom = besoin.medecins.name || '';
              const periode = besoin.demi_journee === 'matin' ? 'matin' : 'apres_midi';
              
              // Check if medecin already exists
              const existingMedecin = day.medecins.find(m => m.id === besoin.medecins.id);
              if (existingMedecin) {
                existingMedecin[periode] = true;
              } else {
                day.medecins.push({
                  id: besoin.medecins.id,
                  nom: medecinNom,
                  matin: periode === 'matin',
                  apres_midi: periode === 'apres_midi'
                });
              }
              
              // Add to besoin count
              if (periode === 'matin') {
                day.besoin_secretaires_matin += 1.2;
              } else {
                day.besoin_secretaires_apres_midi += 1.2;
              }
            }
          });

          // Process planning (secrétaires)
          planning?.forEach((plan) => {
            const date = plan.date;
            if (!daysMap.has(date)) {
              daysMap.set(date, {
                date,
                medecins: [],
                secretaires: [],
                besoin_secretaires_matin: 0,
                besoin_secretaires_apres_midi: 0,
                status_matin: 'non_satisfait',
                status_apres_midi: 'non_satisfait'
              });
            }
            const day = daysMap.get(date)!;
            
            if (plan.secretaires) {
              const secretaireNom = plan.secretaires.name || '';
              const periode = plan.periode === 'matin' ? 'matin' : 'apres_midi';
              
              // Check if secretaire already exists
              const existingSecretaire = day.secretaires.find(s => s.id === plan.secretaires.id);
              if (existingSecretaire) {
                existingSecretaire[periode] = true;
                if (plan.is_1r) existingSecretaire.is_1r = true;
                if (plan.is_2f) existingSecretaire.is_2f = true;
                if (plan.validated) existingSecretaire.validated = true;
              } else {
                day.secretaires.push({
                  id: plan.secretaires.id,
                  nom: secretaireNom,
                  matin: periode === 'matin',
                  apres_midi: periode === 'apres_midi',
                  validated: plan.validated || false,
                  is_1r: plan.is_1r,
                  is_2f: plan.is_2f
                });
              }
            }
          });

          // Process capacité effective (secrétaires sans planning)
          capacite?.forEach((cap) => {
            const date = cap.date;
            if (!daysMap.has(date)) {
              daysMap.set(date, {
                date,
                medecins: [],
                secretaires: [],
                besoin_secretaires_matin: 0,
                besoin_secretaires_apres_midi: 0,
                status_matin: 'non_satisfait',
                status_apres_midi: 'non_satisfait'
              });
            }
            const day = daysMap.get(date)!;
            
            if (cap.secretaires) {
              const secretaireNom = cap.secretaires.name || '';
              const periode = cap.demi_journee === 'matin' ? 'matin' : 'apres_midi';
              
              // Only add if not already in planning
              const existingSecretaire = day.secretaires.find(s => s.id === cap.secretaires.id);
              if (existingSecretaire) {
                existingSecretaire[periode] = true;
              } else {
                day.secretaires.push({
                  id: cap.secretaires.id,
                  nom: secretaireNom,
                  matin: periode === 'matin',
                  apres_midi: periode === 'apres_midi',
                  validated: false,
                  is_1r: false,
                  is_2f: false
                });
              }
            }
          });

          // Calculate status for each day
          const days = Array.from(daysMap.values()).map(day => {
            const secretairesMatin = day.secretaires.filter(s => s.matin).length;
            const secretairesAM = day.secretaires.filter(s => s.apres_midi).length;
            
            return {
              ...day,
              status_matin: calculateStatus(day.besoin_secretaires_matin, secretairesMatin),
              status_apres_midi: calculateStatus(day.besoin_secretaires_apres_midi, secretairesAM)
            };
          });

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
          onClick={() => setAbsencesPopupOpen(true)}
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

      <AbsencesJoursFeriesPopup
        open={absencesPopupOpen}
        onOpenChange={setAbsencesPopupOpen}
      />
    </div>
  );
};

export default DashboardPage;
