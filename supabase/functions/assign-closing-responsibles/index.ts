import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

interface SecretaryScore {
  id: string;
  name: string;
  score: number; // 1R = 2 points, 2F = 10 points, 3F = 15 points
  count_1r: number;
  count_2f: number;
  count_3f: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('🔒 Starting closing responsibles assignment');
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { week_start, week_end, selected_dates } = await req.json();
    
    if (!week_start || !week_end) {
      throw new Error('week_start and week_end parameters are required');
    }

    if (selected_dates && selected_dates.length > 0) {
      console.log(`📅 Assigning closing responsibles for ${selected_dates.length} date(s):`, selected_dates);
    } else {
      console.log(`📅 Assigning closing responsibles for: ${week_start} to ${week_end}`);
    }

    // Track scores for current week with new point system (1R=2pts, 2F=10pts, 3F=15pts)
    const currentWeekScores = new Map<string, SecretaryScore>();
    
    // Get current week assignments to count scores (excluding selected dates being re-optimized)
    const { data: currentWeekAssignments, error: cwError } = await supabase
      .from('capacite_effective')
      .select('secretaire_id, is_1r, is_2f, is_3f, date')
      .gte('date', week_start)
      .lte('date', week_end)
      .not('secretaire_id', 'is', null);

    if (cwError) throw cwError;

    // Calculate current week scores with new weights (excluding selected dates)
    for (const assignment of currentWeekAssignments || []) {
      // Skip dates being re-optimized
      if (selected_dates && selected_dates.includes(assignment.date)) {
        continue;
      }
      
      const secId = assignment.secretaire_id;
      if (!secId) continue;
      
      if (!currentWeekScores.has(secId)) {
        currentWeekScores.set(secId, { 
          id: secId, 
          name: '', 
          score: 0, 
          count_1r: 0, 
          count_2f: 0, 
          count_3f: 0 
        });
      }
      
      const secScore = currentWeekScores.get(secId)!;
      
      if (assignment.is_1r) {
        secScore.score += 2;
        secScore.count_1r += 1;
      }
      if (assignment.is_2f) {
        secScore.score += 10;
        secScore.count_2f += 1;
      }
      if (assignment.is_3f) {
        secScore.score += 15;
        secScore.count_3f += 1;
      }
    }
    
    console.log(`📊 Current week scores calculated for ${currentWeekScores.size} secretaries (1R=2pts, 2F=10pts, 3F=15pts)`);

    // Step 3: Get all secretaries info
    const { data: secretaries, error: secError } = await supabase
      .from('secretaires')
      .select('id, first_name, name')
      .eq('actif', true);

    if (secError) throw secError;

    // Find Florence Bron's ID
    const florenceBron = secretaries?.find(s => 
      (s.first_name?.toLowerCase() === 'florence' && s.name?.toLowerCase() === 'bron') ||
      (s.name?.toLowerCase().includes('bron') && s.first_name?.toLowerCase().includes('florence'))
    );

    // Find Paul Jacquier's ID
    const { data: medecins, error: medError } = await supabase
      .from('medecins')
      .select('id, first_name, name')
      .eq('actif', true);

    if (medError) throw medError;

    const paulJacquier = medecins?.find(m => 
      (m.first_name?.toLowerCase() === 'paul' && m.name?.toLowerCase() === 'jacquier') ||
      (m.name?.toLowerCase().includes('jacquier') && m.first_name?.toLowerCase().includes('paul'))
    );

    console.log(`🔍 Florence Bron ID: ${florenceBron?.id || 'not found'}`);
    console.log(`🔍 Paul Jacquier ID: ${paulJacquier?.id || 'not found'}`);

    // Step 4: Get sites that require closing
    const { data: sites, error: sitesError } = await supabase
      .from('sites')
      .select('id, nom, fermeture')
      .eq('fermeture', true)
      .eq('actif', true);

    if (sitesError) throw sitesError;

    console.log(`🏢 Found ${sites?.length || 0} sites requiring closing`);

    // Step 5: Get current week planning to identify sites needing closing responsibles
    const { data: currentWeekNeeds, error: needsError } = await supabase
      .from('besoin_effectif')
      .select('date, site_id, demi_journee, medecin:medecins(id, first_name, name)')
      .eq('type', 'medecin')
      .gte('date', week_start)
      .lte('date', week_end)
      .in('site_id', sites?.map(s => s.id) || []);

    if (needsError) throw needsError;

    // Group needs by date and site
    const needsByDateAndSite = new Map<string, Set<string>>(); // key: date|site_id, value: set of periods
    for (const need of currentWeekNeeds || []) {
      const key = `${need.date}|${need.site_id}`;
      if (!needsByDateAndSite.has(key)) {
        needsByDateAndSite.set(key, new Set());
      }
      const periods = need.demi_journee === 'toute_journee' 
        ? ['matin', 'apres_midi'] 
        : [need.demi_journee];
      
      for (const period of periods) {
        needsByDateAndSite.get(key)!.add(period);
      }
    }

    // Filter sites that have doctors working both morning and afternoon
    const sitesNeedingClosing: Array<{date: string, site_id: string, site_nom: string}> = [];
    for (const [key, periods] of needsByDateAndSite.entries()) {
      if (periods.has('matin') && periods.has('apres_midi')) {
        const [date, site_id] = key.split('|');
        const site = sites?.find(s => s.id === site_id);
        sitesNeedingClosing.push({ date, site_id, site_nom: site?.nom || '' });
      }
    }

    console.log(`🔒 Found ${sitesNeedingClosing.length} site/date combinations needing closing responsibles`);
    
    // Log détaillé de chaque site/date nécessitant des responsables
    for (const siteDay of sitesNeedingClosing) {
      console.log(`  📍 ${siteDay.site_nom} - ${siteDay.date}: nécessite 1R et 2F/3F`);
    }

    // Sort by date to ensure day-by-day processing in chronological order
    sitesNeedingClosing.sort((a, b) => a.date.localeCompare(b.date));
    console.log(`📅 Processing in chronological order from ${sitesNeedingClosing[0]?.date} to ${sitesNeedingClosing[sitesNeedingClosing.length - 1]?.date}`);

    let assignmentCount = 0;

    // Step 6: Assign closing responsibles for each site/date
    for (const siteDay of sitesNeedingClosing) {
      const { date, site_id } = siteDay;
      const dayOfWeek = new Date(date).getDay(); // 0=Sunday, 1=Monday, 2=Tuesday, ...

      // Check if Paul Jacquier works Thursday AND Friday at THIS SPECIFIC SITE
      let needsThreeF = false;
      
      if (paulJacquier && dayOfWeek === 4) { // Thursday = 4
        // Check if Paul Jacquier works Thursday at this site
        const { data: jacquierThursday, error: jThurError } = await supabase
          .from('besoin_effectif')
          .select('id')
          .eq('medecin_id', paulJacquier.id)
          .eq('site_id', site_id) // Check for THIS site
          .eq('date', date)
          .limit(1)
          .maybeSingle();

        if (jThurError) throw jThurError;

        const friday = new Date(date);
        friday.setDate(friday.getDate() + 1);
        const fridayStr = friday.toISOString().split('T')[0];

        // Check if Paul Jacquier works Friday at this site
        const { data: jacquierFriday, error: jFriError } = await supabase
          .from('besoin_effectif')
          .select('id')
          .eq('medecin_id', paulJacquier.id)
          .eq('site_id', site_id) // Check for THIS site
          .eq('date', fridayStr)
          .limit(1)
          .maybeSingle();

        if (jFriError) throw jFriError;

        if (jacquierThursday && jacquierFriday) {
          needsThreeF = true;
          console.log(`⚠️ Paul Jacquier works Thursday ${date} and Friday ${fridayStr} at ${siteDay.site_nom}, need 3F on Thursday`);
        }
      }

      // Get secretaries assigned to this site on this date (morning and afternoon)
      const { data: assignedMorning, error: amError } = await supabase
        .from('capacite_effective')
        .select('secretaire_id, secretaires!secretaire_id(id, first_name, name)')
        .eq('date', date)
        .eq('site_id', site_id)
        .eq('demi_journee', 'matin')
        .not('secretaire_id', 'is', null);

      if (amError) throw amError;

      const { data: assignedAfternoon, error: pmError } = await supabase
        .from('capacite_effective')
        .select('secretaire_id, secretaires!secretaire_id(id, first_name, name)')
        .eq('date', date)
        .eq('site_id', site_id)
        .eq('demi_journee', 'apres_midi')
        .not('secretaire_id', 'is', null);

      if (pmError) throw pmError;

      // Find secretaries working BOTH morning and afternoon
      const morningIds = new Set(assignedMorning?.map(a => a.secretaire_id).filter(Boolean) || []);
      const afternoonIds = new Set(assignedAfternoon?.map(a => a.secretaire_id).filter(Boolean) || []);
      
      const bothPeriods = Array.from(morningIds).filter(id => afternoonIds.has(id));

      console.log(`  🔍 ${date} ${siteDay.site_nom}: ${morningIds.size} secrétaires matin, ${afternoonIds.size} après-midi, ${bothPeriods.length} présentes toute la journée`);
      
      if (bothPeriods.length === 0) {
        console.log(`  ⚠️ Aucune secrétaire ne travaille toute la journée - impossible d'assigner 1R/2F/3F`);
        continue;
      }
      
      // Si une seule personne toute la journée, on ne peut pas assigner deux rôles distincts
      if (bothPeriods.length === 1) {
        console.log(`  ⚠️ Une seule secrétaire toute la journée - assignation d'un seul rôle (2F/3F) pour éviter check_single_responsable_role`);
        
        const singleSecId = bothPeriods[0];
        const secName = secretaries?.find(s => s.id === singleSecId);
        
        // Assigner uniquement 2F ou 3F (pas 1R)
        const update2F3FData = needsThreeF ? { is_3f: true } : { is_2f: true };
        
        // Reset flags
        await supabase
          .from('capacite_effective')
          .update({ is_1r: false, is_2f: false, is_3f: false })
          .eq('date', date)
          .eq('site_id', site_id);
        
        // Set 2F/3F morning
        await supabase
          .from('capacite_effective')
          .update(update2F3FData)
          .eq('date', date)
          .eq('site_id', site_id)
          .eq('demi_journee', 'matin')
          .eq('secretaire_id', singleSecId);
        
        // Set 2F/3F afternoon
        await supabase
          .from('capacite_effective')
          .update(update2F3FData)
          .eq('date', date)
          .eq('site_id', site_id)
          .eq('demi_journee', 'apres_midi')
          .eq('secretaire_id', singleSecId);
        
        console.log(`  ✅ ${secName?.first_name} ${secName?.name}: ${needsThreeF ? '3F' : '2F'} uniquement (1R impossible)`);
        assignmentCount += 1;
        continue;
      }
      
      // Log des secrétaires candidates
      const candidatesNames = bothPeriods.map(id => {
        const sec = secretaries?.find(s => s.id === id);
        return sec ? `${sec.first_name} ${sec.name}` : id;
      }).join(', ');
      console.log(`  👥 Candidates pour responsabilités: ${candidatesNames}`);

      const isTuesday = dayOfWeek === 2;
      
      // Ensure all candidates have a score entry
      for (const candidateId of bothPeriods) {
        if (!currentWeekScores.has(candidateId)) {
          currentWeekScores.set(candidateId, { 
            id: candidateId, 
            name: '', 
            score: 0, 
            count_1r: 0, 
            count_2f: 0, 
            count_3f: 0 
          });
        }
      }
      
      // STEP 1: Assign 2F or 3F
      // Priority: choose someone with lowest score who doesn't have 2F/3F already this week
      let responsable2F3F = null;
      
      if (needsThreeF) {
        // For 3F: use only current week score (no historical)
        const candidates3F = bothPeriods.map(id => {
          const current = currentWeekScores.get(id)!;
          return {
            id,
            score: current.score,
            has2F3F: current.count_2f > 0 || current.count_3f > 0
          };
        }).sort((a, b) => {
          // Prioritize those without 2F/3F this week
          if (a.has2F3F !== b.has2F3F) return a.has2F3F ? 1 : -1;
          return a.score - b.score;
        });
        
        responsable2F3F = candidates3F[0].id;
      } else {
        // For 2F: only current week score, avoid Florence Bron on Tuesday
        const candidates2F = bothPeriods.map(id => {
          const current = currentWeekScores.get(id)!;
          return {
            id,
            score: current.score,
            has2F3F: current.count_2f > 0 || current.count_3f > 0,
            isFlorenceTuesday: isTuesday && florenceBron && id === florenceBron.id
          };
        }).sort((a, b) => {
          // Skip Florence Bron on Tuesday for 2F
          if (a.isFlorenceTuesday !== b.isFlorenceTuesday) return a.isFlorenceTuesday ? 1 : -1;
          // Prioritize those without 2F/3F this week
          if (a.has2F3F !== b.has2F3F) return a.has2F3F ? 1 : -1;
          return a.score - b.score;
        });
        
        responsable2F3F = candidates2F[0].id;
        
        if (candidates2F[0].isFlorenceTuesday) {
          console.log(`⚠️ Florence Bron assigned 2F on Tuesday ${date} (no other option)`);
        }
      }
      
      // Update score for 2F/3F
      const score2F3F = currentWeekScores.get(responsable2F3F)!;
      const pointsFor2F3F = needsThreeF ? 15 : 10;
      score2F3F.score += pointsFor2F3F;
      if (needsThreeF) {
        score2F3F.count_3f += 1;
      } else {
        score2F3F.count_2f += 1;
      }
      
      // STEP 2: Assign 1R
      // Choose someone with lowest score, excluding 2F/3F
      // IMPORTANT: Must be different from responsable2F3F to avoid check_single_responsable_role violation
      const candidates1R = bothPeriods
        .filter(id => id !== responsable2F3F)
        .map(id => {
          const current = currentWeekScores.get(id)!;
          let adjustedScore = current.score;
          
          // If this person already has 2F or 3F twice this week, penalize heavily to avoid giving 1R
          if ((current.count_2f + current.count_3f) >= 2) {
            adjustedScore += 50; // Heavy penalty to avoid assigning 1R
          }
          
          return {
            id,
            adjustedScore,
            actualScore: current.score
          };
        })
        .sort((a, b) => a.adjustedScore - b.adjustedScore);
      
      let responsable1R = candidates1R.length > 0 ? candidates1R[0].id : responsable2F3F;
      
      // Update score for 1R
      const score1R = currentWeekScores.get(responsable1R)!;
      score1R.score += 2;
      score1R.count_1r += 1;
      
      const secName1R = secretaries?.find(s => s.id === responsable1R);
      const secName2F3F = secretaries?.find(s => s.id === responsable2F3F);
      
      console.log(`✅ ${date} ${siteDay.site_nom}: 1R=${secName1R?.first_name} ${secName1R?.name} (score: ${score1R.score}, 1R:${score1R.count_1r}, 2F:${score1R.count_2f}, 3F:${score1R.count_3f}), ${needsThreeF ? '3F' : '2F'}=${secName2F3F?.first_name} ${secName2F3F?.name} (score: ${score2F3F.score}, 1R:${score2F3F.count_1r}, 2F:${score2F3F.count_2f}, 3F:${score2F3F.count_3f})`);

      // First, reset all responsable flags for this site/date
      const { error: resetError } = await supabase
        .from('capacite_effective')
        .update({ is_1r: false, is_2f: false, is_3f: false })
        .eq('date', date)
        .eq('site_id', site_id);

      if (resetError) throw resetError;

      // Update morning records - set 1R flag
      const { error: update1RMorningError } = await supabase
        .from('capacite_effective')
        .update({ is_1r: true })
        .eq('date', date)
        .eq('site_id', site_id)
        .eq('demi_journee', 'matin')
        .eq('secretaire_id', responsable1R);

      if (update1RMorningError) throw update1RMorningError;

      // Update morning records - set 2F or 3F flag
      const update2F3FData = needsThreeF ? { is_3f: true } : { is_2f: true };
      const { error: update2F3FMorningError } = await supabase
        .from('capacite_effective')
        .update(update2F3FData)
        .eq('date', date)
        .eq('site_id', site_id)
        .eq('demi_journee', 'matin')
        .eq('secretaire_id', responsable2F3F);

      if (update2F3FMorningError) throw update2F3FMorningError;

      // Update afternoon records - set 1R flag
      const { error: update1RAfternoonError } = await supabase
        .from('capacite_effective')
        .update({ is_1r: true })
        .eq('date', date)
        .eq('site_id', site_id)
        .eq('demi_journee', 'apres_midi')
        .eq('secretaire_id', responsable1R);

      if (update1RAfternoonError) throw update1RAfternoonError;

      // Update afternoon records - set 2F or 3F flag
      const { error: update2F3FAfternoonError } = await supabase
        .from('capacite_effective')
        .update(update2F3FData)
        .eq('date', date)
        .eq('site_id', site_id)
        .eq('demi_journee', 'apres_midi')
        .eq('secretaire_id', responsable2F3F);

      if (update2F3FAfternoonError) throw update2F3FAfternoonError;

      assignmentCount++;
    }

    console.log(`🎉 Assigned closing responsibles for ${assignmentCount} site/date combinations`);

    return new Response(JSON.stringify({
      success: true,
      assignments_count: assignmentCount,
      sites_processed: sitesNeedingClosing.length
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('❌ Error assigning closing responsibles:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
