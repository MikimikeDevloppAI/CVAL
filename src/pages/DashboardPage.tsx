import { useEffect, useState } from 'react';
import { format, startOfWeek, endOfWeek, addWeeks, addMonths, subMonths, eachDayOfInterval, parseISO, startOfMonth, endOfMonth } from 'date-fns';
import { fr } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import { SitesTableView } from '@/components/dashboard/SitesTableView';
import { BlocOperatoireTableView, BlocSalle, BlocOperation, BlocAssistant, BesoinPersonnel } from '@/components/dashboard/BlocOperatoireTableView';
import { AssignAssistantToBesoinDialog } from '@/components/dashboard/AssignAssistantToBesoinDialog';
import { CollaborateursTableView, Collaborateur } from '@/components/dashboard/CollaborateursTableView';
import { Button } from '@/components/ui/button';
import { TabButton } from '@/components/ui/primary-button';
import { ChevronLeft, ChevronRight, Loader2, Plus, Building, Users, Stethoscope, Scissors, Sparkles, FileText, Calendar as CalendarPlanIcon, ChevronDown } from 'lucide-react';
import { AddOperationDialog } from '@/components/operations/AddOperationDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Link } from 'react-router-dom';
import { UnfilledNeedsSummaryDialog } from '@/components/dashboard/UnfilledNeedsSummaryDialog';
import { GeneratePdfDialog } from '@/components/dashboard/GeneratePdfDialog';
import { OptimizePlanningDialog } from '@/components/planning/OptimizePlanningDialog';

export interface DeficitDetail {
  besoin_operation_nom: string;
  nombre_requis: number;
  nombre_assigne: number;
  balance: number;
}

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
  deficits_matin?: DeficitDetail[];
  deficits_apres_midi?: DeficitDetail[];
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

type ViewMode = 'site' | 'collaborateur' | 'bloc';

const viewModeLabels: Record<ViewMode, { label: string; icon: React.ReactNode }> = {
  site: { label: 'Sites', icon: <Building className="h-4 w-4" /> },
  bloc: { label: 'Bloc opératoire', icon: <Scissors className="h-4 w-4" /> },
  collaborateur: { label: 'Collaborateurs', icon: <Users className="h-4 w-4" /> },
};

const DashboardPage = () => {
  const [currentMonth, setCurrentMonth] = useState(() => {
    const saved = localStorage.getItem('selectedMonth');
    return saved ? new Date(saved) : new Date();
  });

  // Persist selected month
  useEffect(() => {
    localStorage.setItem('selectedMonth', currentMonth.toISOString());
  }, [currentMonth]);

  const [dashboardSites, setDashboardSites] = useState<DashboardSite[]>([]);
  const [dashboardSecretaires, setDashboardSecretaires] = useState<DashboardSecretaire[]>([]);
  const [dashboardMedecins, setDashboardMedecins] = useState<DashboardMedecin[]>([]);
  const [collaborateurs, setCollaborateurs] = useState<Collaborateur[]>([]);
  const [dashboardOperations, setDashboardOperations] = useState<DashboardOperation[]>([]);
  const [blocSalles, setBlocSalles] = useState<BlocSalle[]>([]);
  const [absencesByDate, setAbsencesByDate] = useState<Record<string, Array<{ id: string; nom: string; type: 'medecin' | 'assistant' }>>>({});
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('site');
  const [addOperationDialogOpen, setAddOperationDialogOpen] = useState(false);
  const [optimizeSummaryOpen, setOptimizeSummaryOpen] = useState(false);
  const [generatePdfDialogOpen, setGeneratePdfDialogOpen] = useState(false);
  const [planifierDialogOpen, setPlanifierDialogOpen] = useState(false);

  // État pour le dialog d'assignation d'assistant aux besoins opératoires
  const [assignAssistantDialog, setAssignAssistantDialog] = useState<{
    open: boolean;
    operationId: string;
    besoinOperationId: string;
    besoinOperationNom: string;
    date: string;
    periode: 'matin' | 'apres_midi';
    siteId: string;
    siteName: string;
  }>({
    open: false,
    operationId: '',
    besoinOperationId: '',
    besoinOperationNom: '',
    date: '',
    periode: 'matin',
    siteId: '',
    siteName: '',
  });

  // Calculer les semaines du mois
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);

  // Obtenir la première et dernière semaine du mois (complètes)
  const firstWeekStart = startOfWeek(monthStart, { locale: fr });
  const lastWeekEnd = endOfWeek(monthEnd, { locale: fr });

  const startDate = format(firstWeekStart, 'yyyy-MM-dd');
  const endDate = format(lastWeekEnd, 'yyyy-MM-dd');

  // Générer toutes les semaines du mois
  const getMonthWeeks = () => {
    const weeks: Date[][] = [];
    let currentWeekStart = firstWeekStart;

    while (currentWeekStart <= monthEnd) {
      const weekEnd = endOfWeek(currentWeekStart, { locale: fr });
      const weekDays = eachDayOfInterval({ start: currentWeekStart, end: weekEnd });
      weeks.push(weekDays);
      currentWeekStart = addWeeks(currentWeekStart, 1);
    }

    return weeks;
  };

  const monthWeeks = getMonthWeeks();

  // Pour la compatibilité avec les vues existantes (on prend la première semaine)
  const weekDays = monthWeeks[0] || [];

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      // BATCH QUERY 1: Fetch unified summary for status + deficit details
      const { data: unifiedSummary } = await supabase
        .from('besoins_unified_summary')
        .select('*')
        .gte('date', startDate)
        .lte('date', endDate);

      // Create status and deficit lookup maps
      // key for sites: `${site_id}-${date}-${periode}`
      // key for salles: `salle-${salle_id}-${date}-${periode}`
      const statusMap = new Map<string, 'satisfait' | 'non_satisfait'>();
      const deficitMap = new Map<string, DeficitDetail[]>();

      (unifiedSummary || []).forEach(row => {
        if (!row.date || !row.demi_journee) return;

        // Determine the key based on type
        let key: string;
        if (row.type_besoin === 'bloc' && row.salle_id) {
          key = `salle-${row.salle_id}-${row.date}-${row.demi_journee}`;
        } else if (row.site_id) {
          key = `${row.site_id}-${row.date}-${row.demi_journee}`;
        } else {
          return;
        }

        // Track status
        if (row.statut === 'DEFICIT') {
          statusMap.set(key, 'non_satisfait');
        } else if (!statusMap.has(key)) {
          statusMap.set(key, 'satisfait');
        }

        // Track deficit details for bloc operations
        if (row.type_besoin === 'bloc' && row.statut === 'DEFICIT' && row.besoin_operation_nom) {
          const deficits = deficitMap.get(key) || [];
          deficits.push({
            besoin_operation_nom: row.besoin_operation_nom,
            nombre_requis: Number(row.nombre_requis) || 0,
            nombre_assigne: Number(row.nombre_assigne) || 0,
            balance: Number(row.balance) || 0
          });
          deficitMap.set(key, deficits);
        }
      });

      // Helper functions
      const getStatus = (siteId: string, date: string, periode: 'matin' | 'apres_midi'): 'satisfait' | 'non_satisfait' => {
        const key = `${siteId}-${date}-${periode}`;
        return statusMap.get(key) || 'satisfait';
      };

      const getDeficits = (siteId: string, date: string, periode: 'matin' | 'apres_midi'): DeficitDetail[] => {
        const key = `${siteId}-${date}-${periode}`;
        return deficitMap.get(key) || [];
      };

      // BATCH QUERY 2: Fetch all active sites
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

      // BATCH QUERY 3: Fetch salles
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
        salle_id: salle.id
      }));

      const adminSite = {
        id: '00000000-0000-0000-0000-000000000001',
        nom: 'Administratif',
        actif: true,
        fermeture: false,
        adresse: '',
        created_at: '',
        updated_at: ''
      };

      const allSites = [...sites, ...salleSites, adminSite];

      // BATCH QUERY 4: Fetch all besoins for the week
      const { data: allBesoins } = await supabase
        .from('besoin_effectif')
        .select(`*, medecins(id, first_name, name, besoin_secretaires)`)
        .gte('date', startDate)
        .lte('date', endDate)
        .eq('type', 'medecin')
        .eq('actif', true);

      // BATCH QUERY 5: Fetch all capacites for the week
      const { data: allCapacites } = await supabase
        .from('capacite_effective')
        .select(`*, secretaires(id, first_name, name)`)
        .gte('date', startDate)
        .lte('date', endDate)
        .eq('actif', true);

      // BATCH QUERY 6: Fetch all bloc operations for the week
      const { data: allOperations } = await supabase
        .from('planning_genere_bloc_operatoire')
        .select(`
          *,
          medecins(id, first_name, name, besoin_secretaires),
          types_intervention(id, nom, code),
          salles_operation(id, name)
        `)
        .gte('date', startDate)
        .lte('date', endDate)
        .neq('statut', 'annule');

      // BATCH QUERY 7: Fetch all personnel needs
      const { data: allPersonnelNeeds } = await supabase
        .from('types_intervention_besoins_personnel')
        .select(`*, besoins_operations(id, nom)`)
        .eq('actif', true);

      // Group data by site/salle
      const besoinsBySite = new Map<string, typeof allBesoins>();
      (allBesoins || []).forEach(b => {
        const siteId = b.site_id;
        if (!besoinsBySite.has(siteId)) besoinsBySite.set(siteId, []);
        besoinsBySite.get(siteId)!.push(b);
      });

      const capacitesBySite = new Map<string, typeof allCapacites>();
      const capacitesByBlocId = new Map<string, typeof allCapacites>();
      (allCapacites || []).forEach(c => {
        // Group by site (for non-bloc)
        if (!c.planning_genere_bloc_operatoire_id) {
          const siteId = c.site_id;
          if (!capacitesBySite.has(siteId)) capacitesBySite.set(siteId, []);
          capacitesBySite.get(siteId)!.push(c);
        } else {
          // Group by bloc operation id
          const blocId = c.planning_genere_bloc_operatoire_id;
          if (!capacitesByBlocId.has(blocId)) capacitesByBlocId.set(blocId, []);
          capacitesByBlocId.get(blocId)!.push(c);
        }
      });

      const operationsBySalle = new Map<string, typeof allOperations>();
      (allOperations || []).forEach(op => {
        if (op.salle_assignee) {
          if (!operationsBySalle.has(op.salle_assignee)) operationsBySalle.set(op.salle_assignee, []);
          operationsBySalle.get(op.salle_assignee)!.push(op);
        }
      });

      const personnelNeedsByType = new Map<string, typeof allPersonnelNeeds>();
      (allPersonnelNeeds || []).forEach(pn => {
        if (!personnelNeedsByType.has(pn.type_intervention_id)) personnelNeedsByType.set(pn.type_intervention_id, []);
        personnelNeedsByType.get(pn.type_intervention_id)!.push(pn);
      });

      // Build dashboard data for each site
      const dashboardData = allSites.map((site) => {
        const isSalleSite = site.id.startsWith('salle-');

        const daysMap = new Map<string, DayData>();

        if (isSalleSite) {
          const salleId = (site as any).salle_id;
          const operations = operationsBySalle.get(salleId) || [];

          operations.forEach(op => {
            const date = op.date;
            if (!daysMap.has(date)) {
              daysMap.set(date, {
                date,
                medecins: [],
                secretaires: [],
                besoin_secretaires_matin: 0,
                besoin_secretaires_apres_midi: 0,
                status_matin: 'non_satisfait',
                status_apres_midi: 'non_satisfait',
                deficits_matin: [],
                deficits_apres_midi: []
              });
            }
            const day = daysMap.get(date)!;
            const periode = op.periode === 'matin' ? 'matin' : 'apres_midi';

            // Add medecin
            if (op.medecins) {
              const existingMedecin = day.medecins.find(m => m.id === (op.medecins as any).id);
              if (existingMedecin) {
                existingMedecin[periode] = true;
              } else {
                day.medecins.push({
                  id: (op.medecins as any).id,
                  nom: (op.medecins as any).name || '',
                  prenom: (op.medecins as any).first_name || '',
                  matin: periode === 'matin',
                  apres_midi: periode === 'apres_midi'
                });
              }
            }

            // Calculate total personnel needed from pre-fetched data
            const personnelNeeds = personnelNeedsByType.get(op.type_intervention_id) || [];
            const totalBesoin = personnelNeeds.reduce((sum, pn) => sum + pn.nombre_requis, 0);
            if (periode === 'matin') {
              day.besoin_secretaires_matin += totalBesoin;
            } else {
              day.besoin_secretaires_apres_midi += totalBesoin;
            }

            // Add assigned secretaires from pre-fetched data
            const assignments = capacitesByBlocId.get(op.id) || [];
            assignments.forEach(assign => {
              if (assign.secretaires) {
                const existingSecretaire = day.secretaires.find(s => s.id === (assign.secretaires as any).id);
                if (existingSecretaire) {
                  existingSecretaire[periode] = true;
                  if (assign.is_1r) existingSecretaire.is_1r = true;
                  if (assign.is_2f) existingSecretaire.is_2f = true;
                  if (assign.is_3f) existingSecretaire.is_3f = true;
                } else {
                  day.secretaires.push({
                    id: (assign.secretaires as any).id,
                    nom: (assign.secretaires as any).name || '',
                    prenom: (assign.secretaires as any).first_name || '',
                    matin: periode === 'matin',
                    apres_midi: periode === 'apres_midi',
                    is_1r: assign.is_1r,
                    is_2f: assign.is_2f,
                    is_3f: assign.is_3f
                  });
                }
              }
            });
          });
        } else {
          // Regular site processing
          const besoins = besoinsBySite.get(site.id) || [];
          const capacite = capacitesBySite.get(site.id) || [];

          besoins.forEach((besoin) => {
            const date = besoin.date;
            if (!daysMap.has(date)) {
              daysMap.set(date, {
                date,
                medecins: [],
                secretaires: [],
                besoin_secretaires_matin: 0,
                besoin_secretaires_apres_midi: 0,
                status_matin: 'non_satisfait',
                status_apres_midi: 'non_satisfait',
                deficits_matin: [],
                deficits_apres_midi: []
              });
            }
            const day = daysMap.get(date)!;

            if (besoin.medecins) {
              const medecinNom = (besoin.medecins as any).name || '';
              const medecinPrenom = (besoin.medecins as any).first_name || '';
              const periode = besoin.demi_journee === 'matin' ? 'matin' : 'apres_midi';

              const existingMedecin = day.medecins.find(m => m.id === (besoin.medecins as any).id);
              if (existingMedecin) {
                existingMedecin[periode] = true;
              } else {
                day.medecins.push({
                  id: (besoin.medecins as any).id,
                  nom: medecinNom,
                  prenom: medecinPrenom,
                  matin: periode === 'matin',
                  apres_midi: periode === 'apres_midi'
                });
              }

              const besoinSecretaire = (besoin.medecins as any).besoin_secretaires ?? 1.2;
              if (periode === 'matin') {
                day.besoin_secretaires_matin += besoinSecretaire;
              } else {
                day.besoin_secretaires_apres_midi += besoinSecretaire;
              }
            }
          });

          capacite.forEach((cap) => {
            const date = cap.date;
            if (!daysMap.has(date)) {
              daysMap.set(date, {
                date,
                medecins: [],
                secretaires: [],
                besoin_secretaires_matin: 0,
                besoin_secretaires_apres_midi: 0,
                status_matin: 'non_satisfait',
                status_apres_midi: 'non_satisfait',
                deficits_matin: [],
                deficits_apres_midi: []
              });
            }
            const day = daysMap.get(date)!;

            if (cap.secretaires) {
              const secretaireNom = (cap.secretaires as any).name || '';
              const secretairePrenom = (cap.secretaires as any).first_name || '';
              const periode = cap.demi_journee === 'matin' ? 'matin' : 'apres_midi';

              const existingSecretaire = day.secretaires.find(s => s.id === (cap.secretaires as any).id);
              if (existingSecretaire) {
                existingSecretaire[periode] = true;
                if (cap.is_1r) existingSecretaire.is_1r = true;
                if (cap.is_2f) existingSecretaire.is_2f = true;
                if (cap.is_3f) existingSecretaire.is_3f = true;
              } else {
                day.secretaires.push({
                  id: (cap.secretaires as any).id,
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
        }

        // Apply status and deficits from unified summary
        const days = Array.from(daysMap.values()).map(day => {
          const salleId = isSalleSite ? (site as any).salle_id : null;
          const statusKey = isSalleSite ? `salle-${salleId}` : site.id;

          return {
            ...day,
            status_matin: getStatus(statusKey, day.date, 'matin'),
            status_apres_midi: getStatus(statusKey, day.date, 'apres_midi'),
            deficits_matin: getDeficits(statusKey, day.date, 'matin'),
            deficits_apres_midi: getDeficits(statusKey, day.date, 'apres_midi')
          };
        });

        return {
          site_id: site.id,
          site_nom: site.nom,
          site_fermeture: site.fermeture || false,
          fermeture: site.fermeture || false,
          days
        };
      });

      setDashboardSites(dashboardData);

      // Fetch secretaires data with pre-fetched capacites
      const { data: secretairesData } = await supabase
        .from('secretaires')
        .select('*')
        .eq('actif', true)
        .order('first_name');

      if (!secretairesData) return;

      // BATCH QUERY: All capacites with relations for secretaires
      const { data: allSecretaireCapacites } = await supabase
        .from('capacite_effective')
        .select(`
          *,
          sites(nom),
          besoins_operations(id, nom),
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
        .gte('date', startDate)
        .lte('date', endDate)
        .eq('actif', true);

      // Group capacites by secretaire
      const capacitesBySecretaire = new Map<string, typeof allSecretaireCapacites>();
      (allSecretaireCapacites || []).forEach(c => {
        if (c.secretaire_id) {
          if (!capacitesBySecretaire.has(c.secretaire_id)) capacitesBySecretaire.set(c.secretaire_id, []);
          capacitesBySecretaire.get(c.secretaire_id)!.push(c);
        }
      });

      const secretairesWeekData = secretairesData.map((secretaire) => {
        const capacite = capacitesBySecretaire.get(secretaire.id) || [];
        const daysMap = new Map<string, SecretaireDayData>();

        capacite.forEach((cap) => {
          const date = cap.date;
          if (!daysMap.has(date)) {
            daysMap.set(date, { date, matin: [], apres_midi: [] });
          }
          const day = daysMap.get(date)!;
          const periode = cap.demi_journee === 'matin' ? 'matin' : 'apres_midi';

          const assignment: SecretaireAssignment = {
            site_nom: (cap.sites as any)?.nom,
            is_1r: cap.is_1r,
            is_2f: cap.is_2f,
            is_3f: cap.is_3f,
            validated: (cap.planning_genere_bloc_operatoire as any)?.validated
          };

          if ((cap.planning_genere_bloc_operatoire as any)?.medecins) {
            assignment.medecin_nom = (cap.planning_genere_bloc_operatoire as any).medecins.name || '';
          }

          if (cap.besoin_operation_id && (cap as any).besoins_operations) {
            assignment.besoin_operation_nom = (cap as any).besoins_operations.nom;
          } else if ((cap.planning_genere_bloc_operatoire as any)?.types_intervention) {
            assignment.besoin_operation_nom = (cap.planning_genere_bloc_operatoire as any).types_intervention.nom;
          }

          if ((cap.planning_genere_bloc_operatoire as any)?.salles_operation) {
            assignment.salle_nom = (cap.planning_genere_bloc_operatoire as any).salles_operation.name;
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
      });

      setDashboardSecretaires(
        secretairesWeekData.sort((a, b) => a.nom_complet.localeCompare(b.nom_complet))
      );

      // Fetch medecins data
      const { data: medecinsData } = await supabase
        .from('medecins')
        .select(`id, first_name, name, actif, specialite_id, specialites(nom)`)
        .eq('actif', true)
        .order('name');

      if (!medecinsData) return;

      // For medecins, we still need individual queries due to structure
      const medecinsWeekData = await Promise.all(
        medecinsData.map(async (medecin) => {
          const { data: besoins } = await supabase
            .from('besoin_effectif')
            .select(`date, demi_journee, site_id, type, type_intervention_id, sites(nom), types_intervention(nom)`)
            .eq('medecin_id', medecin.id)
            .gte('date', startDate)
            .lte('date', endDate)
            .eq('actif', true)
            .order('date');

          const daysMap = new Map<string, MedecinDayData>();

          besoins?.forEach((besoin) => {
            if (!daysMap.has(besoin.date)) {
              daysMap.set(besoin.date, { date: besoin.date, matin: [], apres_midi: [] });
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

      // Créer la liste unifiée des collaborateurs
      const allCollaborateurs: Collaborateur[] = [
        // Ajouter les assistants
        ...secretairesWeekData.map(s => ({
          id: s.id,
          nom_complet: s.nom_complet,
          type: 'assistant' as const,
          actif: s.actif,
          horaire_flexible: s.horaire_flexible,
          flexible_jours_supplementaires: s.flexible_jours_supplementaires,
          nombre_jours_supplementaires: s.nombre_jours_supplementaires,
          days: s.days.map(d => ({
            date: d.date,
            matin: d.matin.map(a => ({
              site_nom: a.site_nom,
              besoin_operation_nom: a.besoin_operation_nom,
              type_intervention_nom: a.type_intervention_nom,
              salle_nom: a.salle_nom,
              is_1r: a.is_1r,
              is_2f: a.is_2f,
              is_3f: a.is_3f,
              validated: a.validated,
            })),
            apres_midi: d.apres_midi.map(a => ({
              site_nom: a.site_nom,
              besoin_operation_nom: a.besoin_operation_nom,
              type_intervention_nom: a.type_intervention_nom,
              salle_nom: a.salle_nom,
              is_1r: a.is_1r,
              is_2f: a.is_2f,
              is_3f: a.is_3f,
              validated: a.validated,
            })),
          })),
        })),
        // Ajouter les médecins
        ...medecinsWeekData.map(m => ({
          id: m.id,
          nom_complet: m.nom_complet,
          type: 'medecin' as const,
          actif: m.actif,
          specialite_nom: m.specialite_nom,
          days: m.days.map(d => ({
            date: d.date,
            matin: d.matin.map(a => ({
              site_nom: a.site_nom,
              site_id: a.site_id,
              type_intervention: a.type_intervention,
            })),
            apres_midi: d.apres_midi.map(a => ({
              site_nom: a.site_nom,
              site_id: a.site_id,
              type_intervention: a.type_intervention,
            })),
          })),
        })),
      ];

      setCollaborateurs(allCollaborateurs);

      // Use pre-fetched operations for bloc view
      const operations: DashboardOperation[] = (allOperations || []).map((operation) => ({
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

      // Construire les données pour la vue bloc opératoire en tableau
      // Grouper les opérations par salle
      const sallesMap = new Map<string, BlocSalle>();

      // Initialiser toutes les salles
      (sallesData || []).forEach(salle => {
        sallesMap.set(salle.id, {
          id: salle.id,
          nom: salle.name || 'Salle inconnue',
          operations: []
        });
      });

      // Ajouter les opérations à chaque salle
      (allOperations || []).forEach(operation => {
        if (!operation.salle_assignee) return;

        const salle = sallesMap.get(operation.salle_assignee);
        if (!salle) return;

        // Récupérer les assistants assignés à cette opération
        const assignments = capacitesByBlocId.get(operation.id) || [];
        const assistants: BlocAssistant[] = assignments
          .filter(assign => assign.secretaires)
          .map(assign => {
            // Trouver le besoin opération si présent
            const besoinOp = (allPersonnelNeeds || []).find(
              pn => pn.besoin_operation_id === assign.besoin_operation_id
            );

            return {
              id: (assign.secretaires as any).id,
              nom: (assign.secretaires as any).name || '',
              prenom: (assign.secretaires as any).first_name || '',
              besoin_operation_id: assign.besoin_operation_id || undefined,
              besoin_operation_nom: besoinOp?.besoins_operations?.nom,
              besoin_operation_code: undefined,
              is_1r: assign.is_1r,
              is_2f: assign.is_2f,
              is_3f: assign.is_3f
            };
          });

        // Calculer les besoins de personnel pour cette opération
        const personnelNeeds = personnelNeedsByType.get(operation.type_intervention_id) || [];
        const besoins_personnel: BesoinPersonnel[] = personnelNeeds.map(pn => {
          // Compter combien d'assistants sont assignés à ce besoin
          const nombreAssigne = assistants.filter(
            a => a.besoin_operation_id === pn.besoin_operation_id
          ).length;

          return {
            besoin_operation_id: pn.besoin_operation_id,
            besoin_operation_nom: (pn.besoins_operations as any)?.nom || 'Inconnu',
            nombre_requis: pn.nombre_requis,
            nombre_assigne: nombreAssigne
          };
        });

        const blocOperation: BlocOperation = {
          id: operation.id,
          date: operation.date,
          periode: operation.periode as 'matin' | 'apres_midi',
          medecin_id: operation.medecin_id,
          medecin_nom: (operation.medecins as any)?.name || '',
          medecin_prenom: (operation.medecins as any)?.first_name || '',
          type_intervention_id: operation.type_intervention_id,
          type_intervention_nom: (operation.types_intervention as any)?.nom || 'Inconnu',
          type_intervention_code: (operation.types_intervention as any)?.code || '',
          salle_id: operation.salle_assignee,
          salle_nom: (operation.salles_operation as any)?.name || '',
          assistants,
          besoins_personnel
        };

        salle.operations.push(blocOperation);
      });

      setBlocSalles(Array.from(sallesMap.values()));

      // Fetch absences pour la période (statut approuve ou en_attente)
      const { data: absencesData } = await supabase
        .from('absences')
        .select(`
          id,
          date_debut,
          date_fin,
          secretaire_id,
          medecin_id,
          secretaires:secretaire_id(first_name, name),
          medecins:medecin_id(first_name, name)
        `)
        .lte('date_debut', endDate)
        .gte('date_fin', startDate)
        .in('statut', ['approuve', 'en_attente']);

      // Construire un map des absences par date
      const absencesMap: Record<string, Array<{ id: string; nom: string; type: 'medecin' | 'assistant' }>> = {};

      (absencesData || []).forEach(absence => {
        const start = parseISO(absence.date_debut);
        const end = parseISO(absence.date_fin);
        const days = eachDayOfInterval({ start, end });

        days.forEach(day => {
          const dateStr = format(day, 'yyyy-MM-dd');
          if (!absencesMap[dateStr]) absencesMap[dateStr] = [];

          if (absence.medecin_id && (absence.medecins as any)) {
            const med = absence.medecins as any;
            absencesMap[dateStr].push({
              id: absence.medecin_id,
              nom: `${med.first_name || ''} ${med.name || ''}`.trim(),
              type: 'medecin'
            });
          } else if (absence.secretaire_id && (absence.secretaires as any)) {
            const sec = absence.secretaires as any;
            absencesMap[dateStr].push({
              id: absence.secretaire_id,
              nom: `${sec.first_name || ''} ${sec.name || ''}`.trim(),
              type: 'assistant'
            });
          }
        });
      });

      setAbsencesByDate(absencesMap);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, [currentMonth]);

  // Real-time updates
  useEffect(() => {
    const channel = supabase
      .channel('dashboard-updates')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'capacite_effective' },
        () => fetchDashboardData()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'besoin_effectif' },
        () => fetchDashboardData()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'planning_genere_bloc_operatoire' },
        () => fetchDashboardData()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentMonth]);

  const handlePreviousMonth = () => setCurrentMonth(subMonths(currentMonth, 1));
  const handleNextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));

  // Render content based on view mode
  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      );
    }

    // Tous les jours du mois (pour le scroll horizontal)
    const allMonthDays = eachDayOfInterval({ start: firstWeekStart, end: lastWeekEnd });

    switch (viewMode) {
      case 'site':
        return (
          <div className="h-full overflow-hidden">
            <SitesTableView
              sites={dashboardSites}
              weekDays={allMonthDays}
              onDayClick={(siteId, date) => console.log('Day clicked:', siteId, date)}
              onRefresh={fetchDashboardData}
              absencesByDate={absencesByDate}
            />
          </div>
        );

      case 'collaborateur':
        return (
          <div className="h-full overflow-hidden">
            <CollaborateursTableView
              collaborateurs={collaborateurs}
              weekDays={allMonthDays}
              onRefresh={fetchDashboardData}
              absencesByDate={absencesByDate}
            />
          </div>
        );

      case 'bloc':
        return (
          <div className="h-full overflow-hidden">
            <BlocOperatoireTableView
              salles={blocSalles}
              weekDays={allMonthDays}
              onRefresh={fetchDashboardData}
              onAssignAssistant={(params) => {
                setAssignAssistantDialog({
                  open: true,
                  ...params,
                });
              }}
            />
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header fixe - design épuré */}
      <div className="shrink-0 bg-card/80 backdrop-blur-xl border-b border-border/30 px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          {/* Left side: Month Navigation */}
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={handlePreviousMonth}
              className="h-8 w-8 rounded-lg hover:bg-muted"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>

            <div className="min-w-[160px] text-center">
              <span className="text-lg font-bold text-foreground capitalize">
                {format(currentMonth, 'MMMM yyyy', { locale: fr })}
              </span>
            </div>

            <Button
              variant="ghost"
              size="icon"
              onClick={handleNextMonth}
              className="h-8 w-8 rounded-lg hover:bg-muted"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {/* Center: View Mode Selector */}
          <div className="flex items-center gap-1 p-1 bg-muted/50 rounded-xl border border-border/30">
            {(Object.keys(viewModeLabels) as ViewMode[]).map((mode) => (
              <TabButton
                key={mode}
                active={viewMode === mode}
                onClick={() => setViewMode(mode)}
                icon={viewModeLabels[mode].icon}
              >
                {viewModeLabels[mode].label}
              </TabButton>
            ))}
          </div>

          {/* Right side: Actions Button */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-md shadow-primary/20"
              >
                <Sparkles className="h-4 w-4 mr-2" />
                Actions
                <ChevronDown className="h-4 w-4 ml-2" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => setOptimizeSummaryOpen(true)}>
                <Sparkles className="h-4 w-4 mr-2 text-blue-500" />
                Optimiser la semaine
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setPlanifierDialogOpen(true)}>
                <CalendarPlanIcon className="h-4 w-4 mr-2 text-blue-500" />
                Planifier
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setGeneratePdfDialogOpen(true)}>
                <FileText className="h-4 w-4 mr-2 text-purple-500" />
                Générer PDF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Planning Area - prend tout l'espace restant, le scroll est géré par SitesTableView */}
      <div className="flex-1 min-h-0 overflow-hidden p-4">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          renderContent()
        )}
      </div>

      {/* Dialogs */}
      <AddOperationDialog
        open={addOperationDialogOpen}
        onOpenChange={setAddOperationDialogOpen}
        currentWeekStart={currentMonth}
        onSuccess={fetchDashboardData}
      />

      <AssignAssistantToBesoinDialog
        open={assignAssistantDialog.open}
        onOpenChange={(open) => setAssignAssistantDialog(prev => ({ ...prev, open }))}
        operationId={assignAssistantDialog.operationId}
        besoinOperationId={assignAssistantDialog.besoinOperationId}
        besoinOperationNom={assignAssistantDialog.besoinOperationNom}
        date={assignAssistantDialog.date}
        periode={assignAssistantDialog.periode}
        siteId={assignAssistantDialog.siteId}
        siteName={assignAssistantDialog.siteName}
        onSuccess={fetchDashboardData}
      />

      <UnfilledNeedsSummaryDialog
        open={optimizeSummaryOpen}
        onOpenChange={setOptimizeSummaryOpen}
        onRefresh={fetchDashboardData}
      />

      <GeneratePdfDialog
        open={generatePdfDialogOpen}
        onOpenChange={setGeneratePdfDialogOpen}
      />

      <OptimizePlanningDialog
        open={planifierDialogOpen}
        onOpenChange={setPlanifierDialogOpen}
      />
    </div>
  );
};

export default DashboardPage;
