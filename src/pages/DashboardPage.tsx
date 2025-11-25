import { useEffect, useState } from 'react';
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks, eachDayOfInterval, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import { QuickActionButton } from '@/components/dashboard/QuickActionButton';
import { SiteCalendarCard } from '@/components/dashboard/SiteCalendarCard';
import { SitesTableView } from '@/components/dashboard/SitesTableView';
import { StatsCard } from '@/components/dashboard/StatsCard';
import { MedecinsPopup } from '@/components/dashboard/medecins/MedecinsPopup';
import { SecretairesPopup } from '@/components/dashboard/secretaires/SecretairesPopup';
import { OperationsPopup } from '@/components/dashboard/operations/OperationsPopup';
import { AbsencesJoursFeriesPopup } from '@/components/dashboard/AbsencesJoursFeriesPopup';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Stethoscope, Users, ClipboardPlus, CalendarX, Loader2, Calendar as CalendarPlanIcon, CalendarDays, BarChart3, Plus, Building, FileText } from 'lucide-react';
import { WeekSelector } from '@/components/shared/WeekSelector';
import { AddOperationDialog } from '@/components/operations/AddOperationDialog';
import { OptimizePlanningDialog } from '@/components/planning/OptimizePlanningDialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { SecretaireCalendarCard } from '@/components/dashboard/SecretaireCalendarCard';
import { SecretaireStatsDialog } from '@/components/dashboard/SecretaireStatsDialog';
import { MedecinCalendarCard } from '@/components/dashboard/MedecinCalendarCard';
import { OperationCalendarCard } from '@/components/dashboard/OperationCalendarCard';
import { UnfilledNeedsPanel } from '@/components/dashboard/UnfilledNeedsPanelCompact';
import { SitesPopup } from '@/components/dashboard/sites/SitesPopup';
import { GeneratePdfDialog } from '@/components/dashboard/GeneratePdfDialog';
import { GlobalCalendarDialog } from '@/components/dashboard/GlobalCalendarDialog';
import { toast } from 'sonner';

export interface PersonnePresence {
  id: string;
  nom: string;
  prenom?: string;
  nom_complet?: string;
  periode?: 'matin' | 'apres_midi';
  matin: boolean;
  apres_midi: boolean;
  validated?: boolean;
  is_1r?: boolean;
  is_2f?: boolean;
  is_3f?: boolean;
}

export interface DayData {
  date: string;
  medecins: PersonnePresence[];
  secretaires: PersonnePresence[];
  besoin_secretaires_matin: number;
  besoin_secretaires_apres_midi: number;
  status_matin: 'satisfait' | 'partiel' | 'non_satisfait';
  status_apres_midi: 'satisfait' | 'partiel' | 'non_satisfait';
}

export interface DashboardSite {
  site_id: string;
  site_nom: string;
  fermeture: boolean;
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

interface MedecinAssignment {
  site_nom: string;
  site_id: string;
  type_intervention?: string;
}

interface MedecinDayData {
  date: string;
  matin: MedecinAssignment[];
  apres_midi: MedecinAssignment[];
}

interface DashboardMedecin {
  id: string;
  nom_complet: string;
  specialite_nom: string;
  actif: boolean;
  days: MedecinDayData[];
}

interface DashboardOperation {
  id: string;
  date: string;
  periode: 'matin' | 'apres_midi';
  type_intervention_nom: string;
  type_intervention_code: string;
  type_intervention_id: string;
  medecin_nom: string;
  medecin_id: string | null;
  besoin_effectif_id: string | null;
  salle_nom: string | null;
  salle_assignee: string | null;
}

const DashboardPage = () => {
  const [currentWeek, setCurrentWeek] = useState(() => {
    const saved = localStorage.getItem('selectedWeek');
    return saved ? new Date(saved) : new Date();
  });
  
  // Persist selected week
  useEffect(() => {
    localStorage.setItem('selectedWeek', currentWeek.toISOString());
  }, [currentWeek]);
  const [dashboardSites, setDashboardSites] = useState<DashboardSite[]>([]);
  const [dashboardSecretaires, setDashboardSecretaires] = useState<DashboardSecretaire[]>([]);
  const [dashboardMedecins, setDashboardMedecins] = useState<DashboardMedecin[]>([]);
  const [dashboardOperations, setDashboardOperations] = useState<DashboardOperation[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'site' | 'secretaire' | 'medecin' | 'bloc'>('site');
  const [medecinsPopupOpen, setMedecinsPopupOpen] = useState(false);
  const [secretairesPopupOpen, setSecretairesPopupOpen] = useState(false);
  const [absencesPopupOpen, setAbsencesPopupOpen] = useState(false);
  const [operationsPopupOpen, setOperationsPopupOpen] = useState(false);
  const [planningDialogOpen, setPlanningDialogOpen] = useState(false);
  const [addOperationDialogOpen, setAddOperationDialogOpen] = useState(false);
  const [sitesPopupOpen, setSitesPopupOpen] = useState(false);
  const [generatePdfDialogOpen, setGeneratePdfDialogOpen] = useState(false);
  const [globalCalendarOpen, setGlobalCalendarOpen] = useState(false);
  const [stats, setStats] = useState({
    activeSites: 0,
    totalSecretary: 0,
    todayOperations: 0,
    pendingAbsences: 0
  });

  const startDate = format(startOfWeek(currentWeek, { locale: fr }), 'yyyy-MM-dd');
  const endDate = format(endOfWeek(currentWeek, { locale: fr }), 'yyyy-MM-dd');
  const weekDays = eachDayOfInterval({
    start: parseISO(startDate),
    end: parseISO(endDate)
  });

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
        .order('nom');

      if (!sitesData) return;

      // Filter out bloc opératoire and administrative sites
      const sites = sitesData.filter(site => 
        !site.nom.toLowerCase().includes('administratif') &&
        !site.nom.toLowerCase().includes('bloc') &&
        !site.nom.toLowerCase().includes('opératoire')
      );

      // Fetch salles for bloc opératoire
      const { data: sallesData } = await supabase
        .from('salles_operation')
        .select('*')
        .order('name');

      // Create virtual sites for each salle
      const salleSites = (sallesData || []).map(salle => ({
        id: `salle-${salle.id}`,
        nom: `Salle ${salle.name || 'inconnue'}`,
        actif: true,
        fermeture: false,
        adresse: '',
        created_at: salle.created_at,
        updated_at: salle.created_at,
        salle_id: salle.id // Store original salle ID
      }));

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
      
      // Order: Sites normaux → Salles → Administratif
      const allSites = [...sites, ...salleSites, adminSite];

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
          const isSalleSite = site.id.startsWith('salle-');
          
          let besoins: any[] = [];
          let capacite: any[] = [];
          
          if (isSalleSite) {
            // For salle sites, fetch bloc operations
            const salleId = (site as any).salle_id;
            const { data: operations } = await supabase
              .from('planning_genere_bloc_operatoire')
              .select(`
                *,
                medecins(id, first_name, name, besoin_secretaires),
                types_intervention(id, nom)
              `)
              .eq('salle_assignee', salleId)
              .gte('date', startDate)
              .lte('date', endDate)
              .neq('statut', 'annule')
              .order('date');
            
            // For each operation, get personnel needs and assignments
            const operationsWithPersonnel = await Promise.all(
              (operations || []).map(async (op) => {
                // Fetch personnel needs for this intervention type
                const { data: personnelBesoins } = await supabase
                  .from('types_intervention_besoins_personnel')
                  .select(`
                    nombre_requis,
                    besoins_operations(id, nom, code)
                  `)
                  .eq('type_intervention_id', op.type_intervention_id)
                  .eq('actif', true);
                
                // Fetch actual assignments for this operation
                const { data: assignments } = await supabase
                  .from('capacite_effective')
                  .select(`
                    *,
                    secretaires(id, first_name, name)
                  `)
                  .eq('planning_genere_bloc_operatoire_id', op.id)
                  .eq('actif', true);
                
                return { ...op, personnelBesoins, assignments };
              })
            );
            
            // Transform operations into the expected format
            // We don't populate besoins/capacite for salle sites in the traditional way
            // Instead we'll process them directly in the daysMap
          } else {
            // Fetch besoins effectifs (médecins) for normal sites
            const { data: besoinsData } = await supabase
              .from('besoin_effectif')
              .select(`
                *,
                medecins(id, first_name, name, besoin_secretaires)
              `)
              .eq('site_id', site.id)
              .gte('date', startDate)
              .lte('date', endDate)
              .eq('type', 'medecin')
              .order('date');
            besoins = besoinsData || [];

            // Fetch capacité effective pour les secrétaires (ONLY SOURCE)
            // Exclure les assignations au bloc opératoire dans la vue par site
            const { data: capaciteData } = await supabase
              .from('capacite_effective')
              .select(`
                *,
                secretaires(id, first_name, name)
              `)
              .eq('site_id', site.id)
              .gte('date', startDate)
              .lte('date', endDate)
              .eq('actif', true)
              .is('planning_genere_bloc_operatoire_id', null)
              .order('date');
            capacite = capaciteData || [];
          }

          // Group by date only (not by period)
          const daysMap = new Map<string, DayData>();
          
          if (isSalleSite) {
            // For salle sites, process bloc operations
            const salleId = (site as any).salle_id;
            const { data: operations } = await supabase
              .from('planning_genere_bloc_operatoire')
              .select(`
                *,
                medecins(id, first_name, name, besoin_secretaires),
                types_intervention(id, nom)
              `)
              .eq('salle_assignee', salleId)
              .gte('date', startDate)
              .lte('date', endDate)
              .neq('statut', 'annule')
              .order('date');
            
            // Process each operation
            for (const op of operations || []) {
              const date = op.date;
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
              const periode = op.periode === 'matin' ? 'matin' : 'apres_midi';
              
              // Add medecin
              if (op.medecins) {
                const existingMedecin = day.medecins.find(m => m.id === op.medecins.id);
                if (existingMedecin) {
                  existingMedecin[periode] = true;
                } else {
                  day.medecins.push({
                    id: op.medecins.id,
                    nom: op.medecins.name || '',
                    prenom: op.medecins.first_name || '',
                    matin: periode === 'matin',
                    apres_midi: periode === 'apres_midi'
                  });
                }
              }
              
              // Fetch personnel needs and assignments
              const { data: personnelBesoins } = await supabase
                .from('types_intervention_besoins_personnel')
                .select(`
                  nombre_requis,
                  besoins_operations(id, nom)
                `)
                .eq('type_intervention_id', op.type_intervention_id)
                .eq('actif', true);
              
              const { data: assignments } = await supabase
                .from('capacite_effective')
                .select(`
                  *,
                  secretaires(id, first_name, name)
                `)
                .eq('planning_genere_bloc_operatoire_id', op.id)
                .eq('actif', true);
              
              // Calculate total personnel needed
              const totalBesoin = (personnelBesoins || []).reduce((sum, b) => sum + b.nombre_requis, 0);
              if (periode === 'matin') {
                day.besoin_secretaires_matin += totalBesoin;
              } else {
                day.besoin_secretaires_apres_midi += totalBesoin;
              }
              
              // Add assigned secretaires
              (assignments || []).forEach(assign => {
                if (assign.secretaires) {
                  const existingSecretaire = day.secretaires.find(s => s.id === assign.secretaires.id);
                  if (existingSecretaire) {
                    existingSecretaire[periode] = true;
                    if (assign.is_1r) existingSecretaire.is_1r = true;
                    if (assign.is_2f) existingSecretaire.is_2f = true;
                    if (assign.is_3f) existingSecretaire.is_3f = true;
                  } else {
                    day.secretaires.push({
                      id: assign.secretaires.id,
                      nom: assign.secretaires.name || '',
                      prenom: assign.secretaires.first_name || '',
                      matin: periode === 'matin',
                      apres_midi: periode === 'apres_midi',
                      is_1r: assign.is_1r,
                      is_2f: assign.is_2f,
                      is_3f: assign.is_3f
                    });
                  }
                }
              });
            }
          }
          
          // Process besoins (médecins) for regular sites
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
              
              // Add to besoin count from medecin's besoin_secretaires
              const besoinSecretaire = besoin.medecins.besoin_secretaires ?? 1.2;
              if (periode === 'matin') {
                day.besoin_secretaires_matin += besoinSecretaire;
              } else {
                day.besoin_secretaires_apres_midi += besoinSecretaire;
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
            fermeture: site.fermeture || false,
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

      // Fetch medecins data
      const { data: medecinsData } = await supabase
        .from('medecins')
        .select(`
          id,
          first_name,
          name,
          actif,
          specialite_id,
          specialites(nom)
        `)
        .eq('actif', true)
        .order('name');

      if (!medecinsData) return;

      // Fetch medecins week data
      const medecinsWeekData = await Promise.all(
        medecinsData.map(async (medecin) => {
          const { data: besoins } = await supabase
            .from('besoin_effectif')
            .select(`
              date,
              demi_journee,
              site_id,
              type,
              type_intervention_id,
              sites(nom),
              types_intervention(nom)
            `)
            .eq('medecin_id', medecin.id)
            .gte('date', startDate)
            .lte('date', endDate)
            .eq('actif', true)
            .order('date');

          // Group by date
          const daysMap = new Map<string, MedecinDayData>();
          
          besoins?.forEach((besoin) => {
            if (!daysMap.has(besoin.date)) {
              daysMap.set(besoin.date, {
                date: besoin.date,
                matin: [],
                apres_midi: []
              });
            }
            
            const day = daysMap.get(besoin.date)!;
            const assignment: MedecinAssignment = {
              site_nom: (besoin.sites as any)?.nom || 'Inconnu',
              site_id: besoin.site_id,
              type_intervention: (besoin.types_intervention as any)?.nom
            };
            
            if (besoin.demi_journee === 'matin') {
              day.matin.push(assignment);
            } else {
              day.apres_midi.push(assignment);
            }
          });

          return {
            id: medecin.id,
            nom_complet: `${medecin.first_name || ''} ${medecin.name}`.trim(),
            specialite_nom: (medecin.specialites as any)?.nom || 'Non spécifié',
            actif: medecin.actif,
            days: Array.from(daysMap.values())
          };
        })
      );

      setDashboardMedecins(
        medecinsWeekData.sort((a, b) => a.nom_complet.localeCompare(b.nom_complet))
      );

      // Fetch bloc operatoire operations
      const { data: operationsData } = await supabase
        .from('planning_genere_bloc_operatoire')
        .select(`
          id,
          date,
          periode,
          salle_assignee,
          medecin_id,
          besoin_effectif_id,
          type_intervention_id,
          salles_operation(name),
          medecins(first_name, name),
          types_intervention(nom, code)
        `)
        .gte('date', startDate)
        .lte('date', endDate)
        .in('periode', ['matin', 'apres_midi'])
        .neq('statut', 'annule')
        .order('date')
        .order('periode');

      // Map operations to individual cards
      const operations: DashboardOperation[] = (operationsData || []).map((operation) => ({
        id: operation.id,
        date: operation.date,
        periode: operation.periode as 'matin' | 'apres_midi',
        type_intervention_nom: (operation.types_intervention as any)?.nom || 'Inconnu',
        type_intervention_code: (operation.types_intervention as any)?.code || '',
        type_intervention_id: operation.type_intervention_id,
        medecin_nom: operation.medecins 
          ? `${(operation.medecins as any).first_name} ${(operation.medecins as any).name}` 
          : 'Non assigné',
        medecin_id: operation.medecin_id,
        besoin_effectif_id: operation.besoin_effectif_id,
        salle_nom: (operation.salles_operation as any)?.name || null,
        salle_assignee: operation.salle_assignee
      }));

      setDashboardOperations(operations);
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
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'planning_genere_bloc_operatoire'
        },
        (payload) => {
          console.log('🔄 Real-time update planning_genere_bloc_operatoire:', payload);
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

  const handleRefreshAll = () => {
    fetchDashboardData();
  };

  return (
    <div className="w-full space-y-6">
      {/* Quick Actions */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <QuickActionButton
          label="Médecins"
          icon={<Stethoscope className="h-6 w-6" />}
          onClick={() => setMedecinsPopupOpen(true)}
          gradient="from-cyan-500 to-blue-500"
        />
        <QuickActionButton
          label="Assistants médicaux"
          icon={<Users className="h-6 w-6" />}
          onClick={() => setSecretairesPopupOpen(true)}
          gradient="from-teal-500 to-cyan-500"
        />
        <QuickActionButton
          label="Opérations"
          icon={<ClipboardPlus className="h-6 w-6" />}
          onClick={() => setOperationsPopupOpen(true)}
          gradient="from-emerald-500 to-teal-500"
        />
        <QuickActionButton
          label="Absences"
          icon={<CalendarX className="h-6 w-6" />}
          onClick={() => setAbsencesPopupOpen(true)}
          gradient="from-green-500 to-emerald-500"
          count={stats.pendingAbsences}
        />
        <QuickActionButton
          label="Sites"
          icon={<Building className="h-6 w-6" />}
          onClick={() => setSitesPopupOpen(true)}
          gradient="from-violet-500 to-purple-500"
        />
        <QuickActionButton
          label="Calendrier global"
          icon={<CalendarDays className="h-6 w-6" />}
          onClick={() => setGlobalCalendarOpen(true)}
          gradient="from-blue-500 to-purple-500"
        />
        <QuickActionButton
          label="Planifier"
          icon={<CalendarPlanIcon className="h-6 w-6" />}
          onClick={() => setPlanningDialogOpen(true)}
          gradient="from-purple-500 to-pink-500"
        />
        <QuickActionButton
          label="Générer PDF"
          icon={<FileText className="h-6 w-6" />}
          onClick={() => setGeneratePdfDialogOpen(true)}
          gradient="from-pink-500 to-rose-500"
        />
      </div>


      {/* Planning hebdomadaire container */}
      <div className="bg-card/50 backdrop-blur-xl border border-border/50 shadow-lg rounded-xl p-6">
        {/* View Mode Tabs */}
        {/* Planning hebdomadaire Title + Color Legend */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold bg-gradient-to-r from-primary via-primary to-primary/70 bg-clip-text text-transparent">
            Planning hebdomadaire
          </h2>
          
          {/* Color Legend - aligned right */}
          <div className="inline-flex items-center gap-4 px-4 py-2 bg-gradient-to-br from-background via-card to-card/50 backdrop-blur-xl border-2 border-primary/20 rounded-lg text-xs font-medium text-foreground">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-blue-500"></div>
              <span>Matin</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
              <span>Après-midi</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-green-500"></div>
              <span>Journée</span>
            </div>
          </div>
        </div>
        <Tabs value={viewMode} onValueChange={(value) => setViewMode(value as 'site' | 'secretaire' | 'medecin' | 'bloc')} className="w-full">
          <div className="flex justify-center mb-6">
            <TabsList>
              <TabsTrigger value="site">Sites</TabsTrigger>
              <TabsTrigger value="bloc">Bloc opératoire</TabsTrigger>
              <TabsTrigger value="secretaire">Assistants médicaux</TabsTrigger>
              <TabsTrigger value="medecin">Médecins</TabsTrigger>
            </TabsList>
          </div>

        {/* Week Selector */}
        <div className="flex items-center justify-between bg-card/50 backdrop-blur-xl border-2 border-border rounded-xl p-4 mb-6">
          <Button
            variant="ghost"
            size="icon"
            onClick={handlePreviousWeek}
            className="hover:bg-primary/10"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          
          <WeekSelector 
            currentDate={currentWeek} 
            onWeekChange={setCurrentWeek} 
          />

          <Button
            variant="ghost"
            size="icon"
            onClick={handleNextWeek}
            className="hover:bg-primary/10"
          >
            <ChevronRight className="h-5 w-5" />
          </Button>
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
            <SitesTableView
              sites={dashboardSites}
              weekDays={weekDays}
              onDayClick={(siteId, date) => {
                console.log('Day clicked:', siteId, date);
              }}
              onRefresh={fetchDashboardData}
            />
          )}
        </TabsContent>

        {/* Secretaires Calendar Grid */}
        <TabsContent value="secretaire">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <>
              <div className="flex justify-end mb-4">
                <SecretaireStatsDialog secretaires={dashboardSecretaires} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {dashboardSecretaires.map((secretaire, index) => (
                  <SecretaireCalendarCard
                    key={secretaire.id}
                    secretaire={secretaire}
                    days={secretaire.days}
                    startDate={startDate}
                    index={index}
                    onDayClick={() => fetchDashboardData()}
                  />
                ))}
              </div>
            </>
          )}
        </TabsContent>

        {/* Medecins Calendar Grid */}
        <TabsContent value="medecin">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {dashboardMedecins.map((medecin, index) => (
                <MedecinCalendarCard
                  key={medecin.id}
                  medecin={medecin}
                  days={medecin.days}
                  startDate={startDate}
                  index={index}
                  onRefresh={fetchDashboardData}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Bloc Operatoire Calendar Grid */}
        <TabsContent value="bloc">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <>
              {/* Regular Operations */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {/* Add Operation Card */}
                <div 
                  onClick={() => setAddOperationDialogOpen(true)}
                  className="border-2 border-dashed border-muted-foreground/30 rounded-lg p-6 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-primary hover:bg-accent/50 transition-colors min-h-[200px]"
                >
                  <div className="rounded-full bg-primary/10 p-3">
                    <Plus className="h-6 w-6 text-primary" />
                  </div>
                  <span className="text-sm font-medium text-muted-foreground">
                    Ajouter une opération
                  </span>
                </div>

                {/* Non-Gastro Operations */}
                {dashboardOperations
                  .filter(op => op.salle_nom !== "Bloc Gastroentérologie")
                  .map((operation, index) => (
                    <OperationCalendarCard
                      key={operation.id}
                      operation={operation}
                      index={index}
                      onRefresh={fetchDashboardData}
                    />
                  ))}
              </div>

              {/* Gastro Bloc Operations Section */}
              {dashboardOperations.some(op => op.salle_nom === "Bloc Gastroentérologie") && (
                <>
                  <div className="mt-8 mb-4 flex items-center gap-3">
                    <div className="h-px flex-1 bg-border" />
                    <h3 className="text-lg font-semibold text-foreground">
                      Bloc Gastroentérologie
                    </h3>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {dashboardOperations
                      .filter(op => op.salle_nom === "Bloc Gastroentérologie")
                      .map((operation, index) => (
                        <OperationCalendarCard
                          key={operation.id}
                          operation={operation}
                          index={index}
                          onRefresh={fetchDashboardData}
                        />
                      ))}
                  </div>
                </>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
      </div>

      <MedecinsPopup
        open={medecinsPopupOpen} 
        onOpenChange={setMedecinsPopupOpen}
      />
      
      <SecretairesPopup 
        open={secretairesPopupOpen} 
        onOpenChange={setSecretairesPopupOpen}
      />

      <OperationsPopup
        open={operationsPopupOpen}
        onOpenChange={setOperationsPopupOpen}
      />

      <AbsencesJoursFeriesPopup
        open={absencesPopupOpen}
        onOpenChange={setAbsencesPopupOpen}
        onAbsenceChange={fetchDashboardData}
      />

      <SitesPopup 
        open={sitesPopupOpen}
        onOpenChange={setSitesPopupOpen}
      />

      <OptimizePlanningDialog
        open={planningDialogOpen}
        onOpenChange={setPlanningDialogOpen}
      />

      <AddOperationDialog
        open={addOperationDialogOpen}
        onOpenChange={setAddOperationDialogOpen}
        currentWeekStart={currentWeek}
        onSuccess={fetchDashboardData}
      />

      <GeneratePdfDialog
        open={generatePdfDialogOpen}
        onOpenChange={setGeneratePdfDialogOpen}
      />

      <GlobalCalendarDialog
        open={globalCalendarOpen}
        onOpenChange={setGlobalCalendarOpen}
      />
    </div>
  );
};

export default DashboardPage;
