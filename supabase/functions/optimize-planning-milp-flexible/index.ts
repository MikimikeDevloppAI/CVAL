import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const ADMIN_SITE_ID = '00000000-0000-0000-0000-000000000001';

interface DayScore {
  date: string;
  score_matin: number;
  score_apres_midi: number;
  score_total: number;
  details_matin: string;
  details_apres_midi: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('🎯 Starting Flexible Secretaries Tension-Based Assignment');
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { week_start, week_end, selected_dates, secretary_assignments } = await req.json();
    
    if (!week_start || !week_end) {
      throw new Error('week_start and week_end are required');
    }

    // Filter selected_dates to keep only weekdays (Monday-Friday)
    const selectedWeekdays = (selected_dates || []).filter((date: string) => {
      const dayOfWeek = new Date(date).getDay();
      return dayOfWeek >= 1 && dayOfWeek <= 5; // Exclude Saturday (6) and Sunday (0)
    });

    console.log(`📅 Analyzing week ${week_start} to ${week_end}`);
    console.log(`📅 Selected weekdays for optimization: ${selectedWeekdays.length > 0 ? selectedWeekdays.join(', ') : 'ALL'}`);

    // ==================== FETCH DATA ====================
    
    // 1. Get all flexible secretaries
    const { data: allSecretaires, error: secError } = await supabase
      .from('secretaires')
      .select('id, name, first_name, horaire_flexible, pourcentage_temps, prefered_admin')
      .eq('actif', true)
      .eq('horaire_flexible', true)
      .gt('pourcentage_temps', 0);

    if (secError) throw secError;

    if (!allSecretaires || allSecretaires.length === 0) {
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'No flexible secretaries found',
        assignments_created: 0
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`Found ${allSecretaires.length} flexible secretaries`);

    // DELETE existing capacities for flexible secretaries on selected weekdays ONLY
    if (selectedWeekdays.length > 0) {
      console.log(`\n🗑️ Deleting existing capacities for flexible secretaries on selected dates...`);
      
      for (const secretary of allSecretaires) {
        const { error: deleteError } = await supabase
          .from('capacite_effective')
          .delete()
          .eq('secretaire_id', secretary.id)
          .in('date', selectedWeekdays);
        
        if (deleteError) {
          console.error(`❌ Error deleting capacities for ${secretary.first_name}:`, deleteError);
        } else {
          console.log(`   Deleted capacities for ${secretary.first_name} ${secretary.name} on ${selectedWeekdays.length} selected days`);
        }
      }
      
      console.log(`✅ Deletion complete\n`);
    }

    // 2. Get holidays
    const { data: holidays } = await supabase
      .from('jours_feries')
      .select('date')
      .eq('actif', true)
      .gte('date', week_start)
      .lte('date', week_end);

    const holidaySet = new Set((holidays || []).map(h => h.date));

    // 3. Get absences for flexible secretaries
    const { data: absences } = await supabase
      .from('absences')
      .select('secretaire_id, date_debut, date_fin, heure_debut, heure_fin')
      .in('secretaire_id', allSecretaires.map(s => s.id))
      .eq('type_personne', 'secretaire')
      .in('statut', ['approuve', 'en_attente'])
      .gte('date_fin', week_start)
      .lte('date_debut', week_end);

    // Build absence map
    const absenceMap = new Map<string, Set<string>>();
    for (const absence of absences || []) {
      if (!absenceMap.has(absence.secretaire_id)) {
        absenceMap.set(absence.secretaire_id, new Set());
      }
      
      const absenceSet = absenceMap.get(absence.secretaire_id)!;
      const startDate = new Date(absence.date_debut);
      const endDate = new Date(absence.date_fin);
      
      for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        
        if (absence.heure_debut && absence.heure_fin) {
          const affectsMatin = absence.heure_debut < '12:30:00' && absence.heure_fin > '07:30:00';
          const affectsApresMidi = absence.heure_debut < '18:00:00' && absence.heure_fin > '13:00:00';
          
          if (affectsMatin) absenceSet.add(`${dateStr}_matin`);
          if (affectsApresMidi) absenceSet.add(`${dateStr}_apres_midi`);
        } else {
          absenceSet.add(dateStr);
        }
      }
    }

    // 4. Get secretaire preferences
    const { data: secSites } = await supabase
      .from('secretaires_sites')
      .select('secretaire_id, site_id')
      .in('secretaire_id', allSecretaires.map(s => s.id));

    const secSitesMap = new Map<string, Set<string>>();
    for (const ss of secSites || []) {
      if (!secSitesMap.has(ss.secretaire_id)) {
        secSitesMap.set(ss.secretaire_id, new Set());
      }
      secSitesMap.get(ss.secretaire_id)!.add(ss.site_id);
    }

    const { data: secBesoins } = await supabase
      .from('secretaires_besoins_operations')
      .select('secretaire_id, besoin_operation_id')
      .in('secretaire_id', allSecretaires.map(s => s.id));

    const secBesoinsMap = new Map<string, Set<string>>();
    for (const sb of secBesoins || []) {
      if (!secBesoinsMap.has(sb.secretaire_id)) {
        secBesoinsMap.set(sb.secretaire_id, new Set());
      }
      secBesoinsMap.get(sb.secretaire_id)!.add(sb.besoin_operation_id);
    }

    // 5. Get existing capacities for flexible secretaries
    const { data: existingCapacities } = await supabase
      .from('capacite_effective')
      .select('secretaire_id, date, demi_journee')
      .in('secretaire_id', allSecretaires.map(s => s.id))
      .gte('date', week_start)
      .lte('date', week_end);

    const existingCapacitiesMap = new Map<string, Set<string>>();
    for (const cap of existingCapacities || []) {
      if (!existingCapacitiesMap.has(cap.secretaire_id)) {
        existingCapacitiesMap.set(cap.secretaire_id, new Set());
      }
      existingCapacitiesMap.get(cap.secretaire_id)!.add(`${cap.date}_${cap.demi_journee}`);
    }

    // ==================== PROCESS EACH FLEXIBLE SECRETARY ====================

    let totalAssignmentsCreated = 0;

    for (const secretary of allSecretaires) {
      console.log(`\n👤 Processing ${secretary.first_name} ${secretary.name}`);

      // Calculate required days
      const absencesForSec = absenceMap.get(secretary.id) || new Set();

      // Generate week dates
      const weekDates: string[] = [];
      const start = new Date(week_start);
      const end = new Date(week_end);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        weekDates.push(d.toISOString().split('T')[0]);
      }

      // Count holidays and absences
      let holidaysCount = 0;
      let absenceDaysCount = 0;

      for (const date of weekDates) {
        const dayOfWeek = new Date(date).getDay();
        if (dayOfWeek === 6 || dayOfWeek === 0) continue; // Skip weekends

        if (holidaySet.has(date)) {
          holidaysCount++;
        } else if (absencesForSec.has(date) || 
                   (absencesForSec.has(`${date}_matin`) && absencesForSec.has(`${date}_apres_midi`))) {
          absenceDaysCount++;
        }
      }

      const totalRequired = Math.round((secretary.pourcentage_temps / 100) * 5);
      const availableDays = 5 - holidaysCount - absenceDaysCount;
      const joursRequis = Math.max(0, Math.min(totalRequired, availableDays));

      // Override with custom assignment if provided
      let finalJoursRequis = joursRequis;
      if (secretary_assignments && Array.isArray(secretary_assignments)) {
        const customAssignment = secretary_assignments.find(
          (a: any) => a.secretaire_id === secretary.id
        );
        if (customAssignment && typeof customAssignment.jours_requis === 'number') {
          finalJoursRequis = customAssignment.jours_requis;
          console.log(`  ⚙️ Using custom assignment: ${finalJoursRequis} days (instead of calculated ${joursRequis})`);
        }
      }

      console.log(`  ${secretary.pourcentage_temps}% = ${totalRequired} days total`);
      console.log(`  ${holidaysCount} holidays, ${absenceDaysCount} absence days`);
      console.log(`  ${finalJoursRequis} days needed`);

      if (finalJoursRequis <= 0) {
        console.log(`  ✅ Already fulfilled requirement`);
        continue;
      }

      // Calculate scores for each eligible day
      const dayScores: DayScore[] = [];

      for (const date of weekDates) {
        const dayOfWeek = new Date(date).getDay();
        
        // Skip weekends, holidays, and absence days
        if (dayOfWeek === 6 || dayOfWeek === 0) continue;
        if (holidaySet.has(date)) continue;
        if (absencesForSec.has(date)) continue;
        
        // Check if both periods are blocked by absence
        const matinBlocked = absencesForSec.has(`${date}_matin`);
        const apresMidiBlocked = absencesForSec.has(`${date}_apres_midi`);
        if (matinBlocked && apresMidiBlocked) continue;

        // Calculate score for this day
        const scoreMatin = matinBlocked 
          ? { score: -9999, details: 'Blocked by absence' }
          : await calculatePeriodScore(supabase, date, 'matin', secretary.id, secSitesMap, secBesoinsMap);

        const scoreApresMidi = apresMidiBlocked 
          ? { score: -9999, details: 'Blocked by absence' }
          : await calculatePeriodScore(supabase, date, 'apres_midi', secretary.id, secSitesMap, secBesoinsMap);

        const scoreTotal = scoreMatin.score + scoreApresMidi.score;

        dayScores.push({
          date,
          score_matin: scoreMatin.score,
          score_apres_midi: scoreApresMidi.score,
          score_total: scoreTotal,
          details_matin: scoreMatin.details,
          details_apres_midi: scoreApresMidi.details
        });
      }

      // Sort by score (descending) and select top N days
      dayScores.sort((a, b) => b.score_total - a.score_total);
      const selectedDays = dayScores.slice(0, finalJoursRequis);

      console.log(`\n  📊 Top ${finalJoursRequis} days selected:`);
      for (const day of selectedDays) {
        console.log(`    ${day.date}: ${day.score_total} pts (M: ${day.score_matin}, AM: ${day.score_apres_midi})`);
        console.log(`      Matin: ${day.details_matin}`);
        console.log(`      Après-midi: ${day.details_apres_midi}`);
      }

      // Create capacities for selected days
      for (const day of selectedDays) {
        // Insert new capacities
        const capacitiesToInsert = [];

        if (day.score_matin > -9999) {
          capacitiesToInsert.push({
            secretaire_id: secretary.id,
            date: day.date,
            demi_journee: 'matin',
            site_id: ADMIN_SITE_ID,
            actif: true
          });
        }

        if (day.score_apres_midi > -9999) {
          capacitiesToInsert.push({
            secretaire_id: secretary.id,
            date: day.date,
            demi_journee: 'apres_midi',
            site_id: ADMIN_SITE_ID,
            actif: true
          });
        }

        if (capacitiesToInsert.length > 0) {
          const { error: insertError } = await supabase
            .from('capacite_effective')
            .insert(capacitiesToInsert);

          if (insertError) {
            console.error(`    ❌ Error inserting capacities for ${day.date}:`, insertError);
          } else {
            totalAssignmentsCreated += capacitiesToInsert.length;
            console.log(`    ✅ Created ${capacitiesToInsert.length} capacities for ${day.date}`);
          }
        }
      }
    }

    console.log(`\n✅ Optimization complete: ${totalAssignmentsCreated} capacities created`);

    return new Response(JSON.stringify({ 
      success: true,
      message: `Created ${totalAssignmentsCreated} capacities for flexible secretaries`,
      assignments_created: totalAssignmentsCreated
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: any) {
    console.error('❌ Error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error?.message || 'Unknown error'
    }), { 
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
});

async function calculatePeriodScore(
  supabase: any,
  date: string,
  periode: 'matin' | 'apres_midi',
  secretaire_id: string,
  secSitesMap: Map<string, Set<string>>,
  secBesoinsMap: Map<string, Set<string>>
): Promise<{ score: number; details: string }> {
  
  const preferredSites = secSitesMap.get(secretaire_id) || new Set();
  const competentBesoins = secBesoinsMap.get(secretaire_id) || new Set();

  let totalScore = 0;
  const details: string[] = [];

  // ==================== SITE SCORE ====================
  
  // Get all site needs for this date/period
  const { data: siteBesoins } = await supabase
    .from('besoin_effectif')
    .select(`
      site_id,
      medecin_id,
      medecins!inner(besoin_secretaires)
    `)
    .eq('date', date)
    .eq('demi_journee', periode)
    .eq('type', 'medecin')
    .eq('actif', true)
    .in('site_id', Array.from(preferredSites));

  // Group by site and sum needs
  const siteNeedsMap = new Map<string, number>();
  for (const besoin of siteBesoins || []) {
    const current = siteNeedsMap.get(besoin.site_id) || 0;
    siteNeedsMap.set(besoin.site_id, current + (besoin.medecins?.besoin_secretaires || 1.2));
  }

  // Get available capacities for each site
  for (const [siteId, need] of siteNeedsMap) {
    const { data: availableCapacities } = await supabase
      .from('capacite_effective')
      .select('secretaire_id')
      .eq('date', date)
      .eq('demi_journee', periode)
      .eq('actif', true);

    // Count how many of these secretaries have this site in preferences
    const { data: secWithSite } = await supabase
      .from('secretaires_sites')
      .select('secretaire_id')
      .eq('site_id', siteId)
      .in('secretaire_id', (availableCapacities || []).map((c: any) => c.secretaire_id));

    const capacitiesCount = secWithSite?.length || 0;
    const ecart = need - capacitiesCount;

    let siteScore = 0;
    if (ecart > 0) {
      // Shortage: heavy penalty
      siteScore = Math.pow(ecart, 2) * 100;
      details.push(`Site manque ${ecart.toFixed(1)} → +${siteScore}`);
    } else if (ecart === 0) {
      // Just right
      siteScore = 50;
      details.push(`Site équilibré → +${siteScore}`);
    } else {
      // Surplus: regressive score
      siteScore = Math.max(0, 50 + (ecart * 10));
      details.push(`Site surplus ${Math.abs(ecart).toFixed(1)} → +${siteScore}`);
    }

    totalScore += siteScore;
  }

  // ==================== BLOC SCORE ====================
  
  // Get all bloc needs for this date/period
  const { data: blocBesoins } = await supabase
    .from('planning_genere_bloc_operatoire')
    .select(`
      id,
      type_intervention_id,
      types_intervention_besoins_personnel!inner(
        besoin_operation_id,
        nombre_requis
      )
    `)
    .eq('date', date)
    .eq('periode', periode)
    .in('types_intervention_besoins_personnel.besoin_operation_id', Array.from(competentBesoins));

  for (const bloc of blocBesoins || []) {
    for (const besoin of (bloc as any).types_intervention_besoins_personnel || []) {
      const besoinOpId = besoin.besoin_operation_id;
      const nombreRequis = besoin.nombre_requis;

      // Get available capacities
      const { data: availableCapacities } = await supabase
        .from('capacite_effective')
        .select('secretaire_id')
        .eq('date', date)
        .eq('demi_journee', periode)
        .eq('actif', true);

      // Count how many have this competence
      const { data: secWithCompetence } = await supabase
        .from('secretaires_besoins_operations')
        .select('secretaire_id')
        .eq('besoin_operation_id', besoinOpId)
        .in('secretaire_id', (availableCapacities || []).map((c: any) => c.secretaire_id));

      const capacitiesCount = secWithCompetence?.length || 0;
      const ecart = nombreRequis - capacitiesCount;

      let blocScore = 0;
      if (ecart > 0) {
        // Shortage: very heavy penalty for blocs
        blocScore = Math.pow(ecart, 2) * 150;
        details.push(`Bloc manque ${ecart} → +${blocScore}`);
      } else if (ecart === 0) {
        // Just right
        blocScore = 60;
        details.push(`Bloc équilibré → +${blocScore}`);
      } else {
        // Surplus: regressive score
        blocScore = Math.max(0, 60 + (ecart * 12));
        details.push(`Bloc surplus ${Math.abs(ecart)} → +${blocScore}`);
      }

      totalScore += blocScore;
    }
  }

  const detailsStr = details.length > 0 ? details.join(', ') : 'No tension';

  return { score: totalScore, details: detailsStr };
}
