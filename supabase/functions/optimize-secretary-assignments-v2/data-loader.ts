import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { WeekData, AssignmentSummary } from './types.ts';

function getWeekBounds(dates: string[]): { start: string; end: string } {
  const sortedDates = dates.sort();
  const firstDate = new Date(sortedDates[0]);
  const lastDate = new Date(sortedDates[sortedDates.length - 1]);
  
  // Get Monday of the first week
  const firstMonday = new Date(firstDate);
  const firstDay = firstMonday.getDay();
  const diffToMonday = firstDay === 0 ? -6 : 1 - firstDay;
  firstMonday.setDate(firstMonday.getDate() + diffToMonday);
  
  // Get Sunday of the last week
  const lastSunday = new Date(lastDate);
  const lastDay = lastSunday.getDay();
  const diffToSunday = lastDay === 0 ? 0 : 7 - lastDay;
  lastSunday.setDate(lastSunday.getDate() + diffToSunday);
  
  return {
    start: firstMonday.toISOString().split('T')[0],
    end: lastSunday.toISOString().split('T')[0]
  };
}

export async function loadWeekData(
  dates: string[],
  supabase: SupabaseClient
): Promise<WeekData> {
  console.log(`📦 Chargement des données pour les dates: ${dates.join(', ')}`);
  
  // Get full week bounds
  const weekBounds = getWeekBounds(dates);
  console.log(`📅 Semaine complète: ${weekBounds.start} → ${weekBounds.end}`);
  
  // Load all data in parallel
  const [
    secretairesRes,
    medecinsRes,
    sitesRes,
    besoinsOpsRes,
    secBesoinsRes,
    secMedecinsRes,
    secSitesRes,
    capacitesRes,
    besoinsEffRes,
    planningBlocRes,
    typesIntervRes
  ] = await Promise.all([
    supabase.from('secretaires').select('*').eq('actif', true),
    supabase.from('medecins').select('*').eq('actif', true),
    supabase.from('sites').select('*').eq('actif', true),
    supabase.from('besoins_operations').select('*').eq('actif', true),
    supabase.from('secretaires_besoins_operations').select('*'),
    supabase.from('secretaires_medecins').select('*'),
    supabase.from('secretaires_sites').select('*'),
    supabase
      .from('capacite_effective')
      .select('*')
      .gte('date', weekBounds.start)
      .lte('date', weekBounds.end)
      .eq('actif', true),
    supabase
      .from('besoin_effectif')
      .select('*')
      .gte('date', weekBounds.start)
      .lte('date', weekBounds.end)
      .eq('actif', true),
    supabase
      .from('planning_genere_bloc_operatoire')
      .select('*')
      .gte('date', weekBounds.start)
      .lte('date', weekBounds.end),
    supabase
      .from('types_intervention_besoins_personnel')
      .select('*')
      .eq('actif', true)
  ]);

  if (secretairesRes.error) throw secretairesRes.error;
  if (medecinsRes.error) throw medecinsRes.error;
  if (sitesRes.error) throw sitesRes.error;
  if (besoinsOpsRes.error) throw besoinsOpsRes.error;
  if (secBesoinsRes.error) throw secBesoinsRes.error;
  if (secMedecinsRes.error) throw secMedecinsRes.error;
  if (secSitesRes.error) throw secSitesRes.error;
  if (capacitesRes.error) throw capacitesRes.error;
  if (besoinsEffRes.error) throw besoinsEffRes.error;
  if (planningBlocRes.error) throw planningBlocRes.error;
  if (typesIntervRes.error) throw typesIntervRes.error;

  const medecins = medecinsRes.data || [];
  const medecins_map = new Map(medecins.map(m => [m.id, m]));

  console.log(`\n✅ Données chargées:`);
  console.log(`  ✅ Secrétaires : ${secretairesRes.data?.length}`);
  console.log(`  ✅ Médecins : ${medecinsRes.data?.length}`);
  console.log(`  ✅ Sites : ${sitesRes.data?.length}`);
  console.log(`  ✅ Besoins opérations : ${besoinsOpsRes.data?.length}`);
  console.log(`  ✅ Secrétaires-besoins : ${secBesoinsRes.data?.length}`);
  console.log(`  ✅ Secrétaires-médecins : ${secMedecinsRes.data?.length}`);
  console.log(`  ✅ Secrétaires-sites : ${secSitesRes.data?.length}`);
  console.log(`  ✅ Capacités effectives : ${capacitesRes.data?.length}`);
  console.log(`  ✅ Besoins effectifs : ${besoinsEffRes.data?.length}`);
  console.log(`  ✅ Planning bloc : ${planningBlocRes.data?.length}`);
  console.log(`  ✅ Types intervention besoins : ${typesIntervRes.data?.length}`);

  return {
    secretaires: secretairesRes.data || [],
    medecins,
    medecins_map,
    sites: sitesRes.data || [],
    besoins_operations: besoinsOpsRes.data || [],
    secretaires_besoins: secBesoinsRes.data || [],
    secretaires_medecins: secMedecinsRes.data || [],
    secretaires_sites: secSitesRes.data || [],
    capacites_effective: capacitesRes.data || [],
    besoins_effectifs: besoinsEffRes.data || [],
    planning_bloc: planningBlocRes.data || [],
    types_intervention_besoins: typesIntervRes.data || []
  };
}

export async function getCurrentWeekAssignments(
  weekData: WeekData,
  optimizedDates: string[]
): Promise<AssignmentSummary[]> {
  const assignments: AssignmentSummary[] = [];
  const ADMIN_SITE_ID = '00000000-0000-0000-0000-000000000001';
  
  // Get all capacites that have been assigned (site_id != admin or have bloc links)
  for (const cap of weekData.capacites_effective) {
    // Skip if this date will be optimized (we'll use fresh data)
    if (optimizedDates.includes(cap.date)) continue;
    
    if (!cap.secretaire_id) continue;
    
    // Check if assigned (not admin, or has bloc link)
    const isAssigned = 
      cap.site_id !== ADMIN_SITE_ID || 
      cap.planning_genere_bloc_operatoire_id !== null;
    
    if (!isAssigned) continue;
    
    // Find site priorite
    const sitePriorite = weekData.secretaires_sites.find(
      ss => ss.secretaire_id === cap.secretaire_id && ss.site_id === cap.site_id
    );
    
    // Check if it's a bloc
    const isBloc = cap.planning_genere_bloc_operatoire_id !== null;
    
    assignments.push({
      secretaire_id: cap.secretaire_id,
      site_id: cap.site_id,
      date: cap.date,
      periode: cap.demi_journee,
      is_admin: cap.site_id === ADMIN_SITE_ID,
      is_bloc: isBloc,
      site_priorite: sitePriorite ? parseInt(sitePriorite.priorite) as (1 | 2 | 3) : null
    });
  }
  
  console.log(`📊 Assignations existantes de la semaine: ${assignments.length}`);
  
  return assignments;
}
