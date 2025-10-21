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
import { ChevronLeft, ChevronRight, Stethoscope, Users, ClipboardPlus, CalendarX, Loader2, Calendar as CalendarPlanIcon, BarChart3 } from 'lucide-react';
import { OptimizePlanningDialog } from '@/components/planning/OptimizePlanningDialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { SecretaireCalendarCard } from '@/components/dashboard/SecretaireCalendarCard';
import { UnfilledNeedsPanel } from '@/components/dashboard/UnfilledNeedsPanel';

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

interface SecretaireAssignment {
  site_nom?: string;
  medecin_nom?: string;
  besoin_operation_nom?: string;
  salle_nom?: string;
  is_1r?: boolean;
  is_2f?: boolean;
  is_3f?: boolean;
  validated?: boolean;
}

interface SecretaireDayData {
  date: string;
  matin: SecretaireAssignment[];
  apres_midi: SecretaireAssignment[];
}

interface DashboardSecretaire {
  id: string;
  nom_complet: string;
  actif: boolean;
  horaire_flexible: boolean;
  flexible_jours_supplementaires: boolean;
  nombre_jours_supplementaires?: number;
  days: SecretaireDayData[];
}

const DashboardPage = () => {
  const [currentWeek, setCurrentWeek] = useState(new Date());
  const [dashboardSites, setDashboardSites] = useState<DashboardSite[]>([]);
  const [dashboardSecretaires, setDashboardSecretaires] = useState<DashboardSecretaire[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'site' | 'secretaire'>('site');
  const [medecinsPopupOpen, setMedecinsPopupOpen] = useState(false);
  const [secretairesPopupOpen, setSecretairesPopupOpen] = useState(false);
  const [absencesPopupOpen, setAbsencesPopupOpen] = useState(false);
  const [planningDialogOpen, setPlanningDialogOpen] = useState(false);
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
      const { data: sitesData } = await supabase
        .from('sites')
        .select('*')
        .eq('actif', true)
        .not('nom', 'eq', 'Clinique La Vallée - Bloc opératoire')
        .order('nom');

      if (!sitesData) return;

      // Filter out any administrative site from the database
      const sites = sitesData.filter(site => 
        !site.nom.toLowerCase().includes('administratif')
      );

      // Add administrative site at the end
      const adminSite = {
        id: '00000000-0000-0000-0000-000000000001',
        nom: 'Administratif',
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

          // Fetch capacité effective pour les secrétaires (ONLY SOURCE)
          const { data: capacite } = await supabase
            .from('capacite_effective')
            .select(`
              *,
              secretaires(id, first_name, name)
            `)
            .eq('site_id', site.id)
            .gte('date', startDate)
            .lte('date', endDate)
            .eq('actif', true)
            .order('date');

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
              const medecinPrenom = besoin.medecins.first_name || '';
              const periode = besoin.demi_journee === 'matin' ? 'matin' : 'apres_midi';
              
              // Check if medecin already exists
              const existingMedecin = day.medecins.find(m => m.id === besoin.medecins.id);
              if (existingMedecin) {
                existingMedecin[periode] = true;
              } else {
                day.medecins.push({
                  id: besoin.medecins.id,
                  nom: medecinNom,
                  prenom: medecinPrenom,
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

          // Process capacité effective (secrétaires)
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
              const secretairePrenom = cap.secretaires.first_name || '';
              const periode = cap.demi_journee === 'matin' ? 'matin' : 'apres_midi';
              
              // Check if secretaire already exists
              const existingSecretaire = day.secretaires.find(s => s.id === cap.secretaires.id);
              if (existingSecretaire) {
                existingSecretaire[periode] = true;
                if (cap.is_1r) existingSecretaire.is_1r = true;
                if (cap.is_2f) existingSecretaire.is_2f = true;
                if (cap.is_3f) existingSecretaire.is_3f = true;
              } else {
                day.secretaires.push({
                  id: cap.secretaires.id,
                  nom: secretaireNom,
                  prenom: secretairePrenom,
                  matin: periode === 'matin',
                  apres_midi: periode === 'apres_midi',
                  is_1r: cap.is_1r,
                  is_2f: cap.is_2f,
                  is_3f: cap.is_3f
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

      // Fetch secretaires data
      const { data: secretairesData } = await supabase
        .from('secretaires')
        .select('*')
        .eq('actif', true)
        .order('first_name');

      if (!secretairesData) return;

      // Fetch secretaires week data
      const secretairesWeekData = await Promise.all(
        secretairesData.map(async (secretaire) => {
          const { data: capacite } = await supabase
            .from('capacite_effective')
            .select(`
              *,
              sites(nom),
              planning_genere_bloc_operatoire(
                validated,
                medecin_id,
                medecins(first_name, name),
                type_intervention_id,
                types_intervention(nom),
                salle_assignee,
                salles_operation(name)
              )
            `)
            .eq('secretaire_id', secretaire.id)
            .gte('date', startDate)
            .lte('date', endDate)
            .eq('actif', true)
            .order('date');

          // Build besoins_operations map to resolve besoin_operation_nom from capacite_effective.besoin_operation_id
          const besoinIds = Array.from(
            new Set((capacite || []).map((c: any) => c.besoin_operation_id).filter(Boolean))
          );

          const besoinsMap = new Map<string, string>();
          if (besoinIds.length > 0) {
            const { data: besoinsOps } = await supabase
              .from('besoins_operations')
              .select('id, nom')
              .in('id', besoinIds as string[]);
            besoinsOps?.forEach((b: any) => {
              besoinsMap.set(b.id, b.nom);
            });
          }

          const daysMap = new Map<string, SecretaireDayData>();

          capacite?.forEach((cap) => {
            const date = cap.date;
            if (!daysMap.has(date)) {
              daysMap.set(date, {
                date,
                matin: [],
                apres_midi: []
              });
            }
            const day = daysMap.get(date)!;
            const periode = cap.demi_journee === 'matin' ? 'matin' : 'apres_midi';

            const assignment: SecretaireAssignment = {
              site_nom: cap.sites?.nom,
              is_1r: cap.is_1r,
              is_2f: cap.is_2f,
              is_3f: cap.is_3f,
              validated: cap.planning_genere_bloc_operatoire?.validated
            };

            // Add medecin info if available
            if (cap.planning_genere_bloc_operatoire?.medecins) {
              const medecin = cap.planning_genere_bloc_operatoire.medecins;
              assignment.medecin_nom = medecin.name || '';
            }

            // Prefer besoin operation name from besoins_operations via capacite_effective.besoin_operation_id
            if (cap.besoin_operation_id) {
              const nom = besoinsMap.get(cap.besoin_operation_id);
              if (nom) assignment.besoin_operation_nom = nom;
            }
            // Fallback to type d'intervention if no besoin operation is linked
            if (!assignment.besoin_operation_nom && cap.planning_genere_bloc_operatoire?.types_intervention) {
              assignment.besoin_operation_nom = cap.planning_genere_bloc_operatoire.types_intervention.nom;
            }

            // Add salle info if available
            if (cap.planning_genere_bloc_operatoire?.salles_operation) {
              assignment.salle_nom = cap.planning_genere_bloc_operatoire.salles_operation.name;
            }

            day[periode].push(assignment);
          });

          return {
            id: secretaire.id,
            nom_complet: `${secretaire.first_name || ''} ${secretaire.name || ''}`.trim(),
            actif: secretaire.actif,
            horaire_flexible: secretaire.horaire_flexible,
            flexible_jours_supplementaires: secretaire.flexible_jours_supplementaires,
            nombre_jours_supplementaires: secretaire.nombre_jours_supplementaires,
            days: Array.from(daysMap.values())
          };
        })
      );

      setDashboardSecretaires(
        secretairesWeekData.sort((a, b) => a.nom_complet.localeCompare(b.nom_complet))
      );
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
          table: 'capacite_effective'
        },
        (payload) => {
          console.log('🔄 Real-time update capacite_effective:', payload);
          fetchDashboardData();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'besoin_effectif'
        },
        (payload) => {
          console.log('🔄 Real-time update besoin_effectif:', payload);
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

      {/* Planning Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <QuickActionButton
          label="Planifier"
          icon={<CalendarPlanIcon className="h-6 w-6" />}
          onClick={() => setPlanningDialogOpen(true)}
          gradient="from-purple-500 to-pink-500"
        />
        <QuickActionButton
          label="Statistiques"
          icon={<BarChart3 className="h-6 w-6" />}
          href="/statistiques"
          gradient="from-blue-500 to-purple-500"
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

      {/* View Mode Tabs */}
      <Tabs value={viewMode} onValueChange={(value) => setViewMode(value as 'site' | 'secretaire')} className="w-full">
        <div className="flex justify-center mb-6">
          <TabsList>
            <TabsTrigger value="site">Vue par site</TabsTrigger>
            <TabsTrigger value="secretaire">Vue par assistant médical</TabsTrigger>
          </TabsList>
        </div>

        {/* Unfilled Needs Panel */}
        {!loading && (
          <UnfilledNeedsPanel
            startDate={startDate}
            endDate={endDate}
            onRefresh={fetchDashboardData}
          />
        )}

        {/* Sites Calendar Grid */}
        <TabsContent value="site">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6">
              {dashboardSites.map((site, index) => (
                <SiteCalendarCard
                  key={site.site_id}
                  site={site}
                  startDate={startDate}
                  endDate={endDate}
                  index={index}
                  onRefresh={fetchDashboardData}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Secretaires Calendar Grid */}
        <TabsContent value="secretaire">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {dashboardSecretaires.map((secretaire, index) => (
                <SecretaireCalendarCard
                  key={secretaire.id}
                  secretaire={secretaire}
                  days={secretaire.days}
                  startDate={startDate}
                  index={index}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

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

      <OptimizePlanningDialog
        open={planningDialogOpen}
        onOpenChange={setPlanningDialogOpen}
      />
    </div>
  );
};

export default DashboardPage;
