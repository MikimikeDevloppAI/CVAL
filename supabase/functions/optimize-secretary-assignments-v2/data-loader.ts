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

function generateAdminNeeds(dates: string[]): any[] {
  const ADMIN_SITE_ID = '00000000-0000-0000-0000-000000000001';
  const adminNeeds: any[] = [];
  
  for (const date of dates) {
    for (const periode of ['matin', 'apres_midi']) {
      adminNeeds.push({
        site_id: ADMIN_SITE_ID,
        date,
        periode,
        nombre_suggere: 0,
        nombre_max: 999,
        medecins_ids: [],
        type: 'site'
      });
    }
  }
  
  return adminNeeds;
}

// 🆕 Fonction pour préparer les capacités des secrétaires flexibles
export async function prepareFlexibleCapacities(
  weekDates: string[],
  supabase: SupabaseClient
): Promise<void> {
  console.log('📦 Préparation des capacités flexibles pour optimisation globale...');
  
  // 1. Charger secrétaires flexibles
  const { data: flexibles, error: flexError } = await supabase
    .from('secretaires')
    .select('*')
    .eq('actif', true)
    .eq('horaire_flexible', true);
  
  if (flexError) {
    console.error('❌ Erreur chargement flexibles:', flexError);
    return;
  }
  
  if (!flexibles || flexibles.length === 0) {
    console.log('  ℹ️ Aucune secrétaire flexible trouvée');
    return;
  }
  
  console.log(`  👥 ${flexibles.length} secrétaire(s) flexible(s) trouvée(s)`);
  
  // 2. Charger jours fériés
  const { data: holidays } = await supabase
    .from('jours_feries')
    .select('date')
    .in('date', weekDates)
    .eq('actif', true);
  
  const holidaySet = new Set(holidays?.map(h => h.date) || []);
  console.log(`  📅 Jours fériés: ${holidaySet.size}`);
  
  // 3. Charger absences
  const { data: absences } = await supabase
    .from('absences')
    .select('*')
    .in('date_debut', weekDates)
    .or(`date_fin.in.(${weekDates.join(',')}),date_debut.lte.${weekDates[weekDates.length - 1]},date_fin.gte.${weekDates[0]}`)
    .eq('statut', 'approuve')
    .eq('type_personne', 'secretaire');
  
  // Build absence map per secretary
  const absencesBySecretaire = new Map<string, Set<string>>();
  for (const abs of absences || []) {
    if (!abs.secretaire_id) continue;
    
    if (!absencesBySecretaire.has(abs.secretaire_id)) {
      absencesBySecretaire.set(abs.secretaire_id, new Set());
    }
    
    // Handle date ranges
    const startDate = new Date(abs.date_debut);
    const endDate = new Date(abs.date_fin);
    
    for (const date of weekDates) {
      const currentDate = new Date(date);
      if (currentDate >= startDate && currentDate <= endDate) {
        if (abs.demi_journee) {
          absencesBySecretaire.get(abs.secretaire_id)!.add(`${date}_${abs.demi_journee}`);
        } else {
          absencesBySecretaire.get(abs.secretaire_id)!.add(date);
        }
      }
    }
  }
  
  console.log(`  🚫 Absences chargées pour ${absencesBySecretaire.size} secrétaire(s)`);
  
  // 4. Supprimer anciennes capacités flexibles pour cette semaine
  const flexibleIds = flexibles.map(f => f.id);
  if (flexibleIds.length > 0) {
    const { error: deleteError } = await supabase
      .from('capacite_effective')
      .delete()
      .in('secretaire_id', flexibleIds)
      .in('date', weekDates);
    
    if (deleteError) {
      console.error('❌ Erreur suppression anciennes capacités:', deleteError);
    }
  }
  
  // 5. Créer capacités pour TOUS les jours disponibles (Lun-Ven, hors absences/fériés)
  const capacitiesToInsert = [];
  const ADMIN_SITE_ID = '00000000-0000-0000-0000-000000000001';
  
  for (const flexible of flexibles) {
    console.log(`  👤 ${flexible.first_name} ${flexible.name} (${flexible.pourcentage_temps}%)`);
    
    const absencesSet = absencesBySecretaire.get(flexible.id) || new Set();
    let availableDaysCount = 0;
    
    for (const date of weekDates) {
      const dateObj = new Date(date + 'T00:00:00Z');
      const dayOfWeek = dateObj.getUTCDay();
      
      // Skip weekends
      if (dayOfWeek === 0 || dayOfWeek === 6) continue;
      
      // Skip holidays
      if (holidaySet.has(date)) continue;
      
      // Skip full-day absences
      if (absencesSet.has(date)) continue;
      
      let addedPeriodsForDay = 0;
      
      // Create capacities for both periods if not absent
      for (const periode of ['matin', 'apres_midi'] as const) {
        if (absencesSet.has(`${date}_${periode}`)) continue;
        
        capacitiesToInsert.push({
          secretaire_id: flexible.id,
          date,
          demi_journee: periode,
          site_id: ADMIN_SITE_ID,
          actif: true,
          is_1r: false,
          is_2f: false,
          is_3f: false
        });
        addedPeriodsForDay++;
      }
      
      if (addedPeriodsForDay === 2) {
        availableDaysCount++;
      }
    }
    
    console.log(`    ✅ ${availableDaysCount} jour(s) disponible(s)`);
  }
  
  console.log(`  📝 ${capacitiesToInsert.length} capacités flexibles à créer`);
  
  // 6. Insérer nouvelles capacités
  if (capacitiesToInsert.length > 0) {
    const { error: insertError } = await supabase
      .from('capacite_effective')
      .insert(capacitiesToInsert);
    
    if (insertError) {
      console.error('❌ Erreur insertion capacités:', insertError);
      throw insertError;
    }
    
    console.log(`  ✅ Capacités flexibles créées avec succès`);
  }
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
  
  // 🔍 DIAGNOSTIC: Compétences BLOC disponibles
  console.log(`\n🔍 DIAGNOSTIC Compétences BLOC (secretaires_besoins_operations):`);
  const secBesoins = secBesoinsRes.data || [];
  if (secBesoins.length === 0) {
    console.warn(`  ⚠️ AUCUNE compétence trouvée dans secretaires_besoins_operations!`);
  } else {
    // Grouper par besoin_operation_id
    const byBesoinOp = new Map<string, string[]>();
    secBesoins.forEach((sb: any) => {
      if (!byBesoinOp.has(sb.besoin_operation_id)) {
        byBesoinOp.set(sb.besoin_operation_id, []);
      }
      byBesoinOp.get(sb.besoin_operation_id)!.push(sb.secretaire_id);
    });
    
    console.log(`  📊 Compétences par besoin_operation_id:`);
    Array.from(byBesoinOp.entries()).slice(0, 5).forEach(([besoinId, secIds]) => {
      console.log(`    ${besoinId.slice(0,8)}: ${secIds.length} secrétaires → [${secIds.slice(0,3).map(id => id.slice(0,8)).join(', ')}...]`);
    });
  }

  const admin_needs = generateAdminNeeds(dates);
  console.log(`  ✅ Besoins ADMIN générés : ${admin_needs.length}`);

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
    types_intervention_besoins: typesIntervRes.data || [],
    admin_needs
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
      site_priorite: sitePriorite ? parseInt(sitePriorite.priorite) as (1 | 2 | 3 | 4) : null,
      is_1r: cap.is_1r || false,
      is_2f: cap.is_2f || false,
      is_3f: cap.is_3f || false
    });
  }
  
  console.log(`📊 Assignations existantes de la semaine: ${assignments.length}`);
  
  return assignments;
}
