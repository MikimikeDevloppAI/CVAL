import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

interface SecretaryScore {
  id: string;
  name: string;
  score: number; // 1R = 1 point, 2F = 2 points
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

    const { week_start, week_end } = await req.json();
    
    if (!week_start || !week_end) {
      throw new Error('week_start and week_end parameters are required');
    }

    console.log(`📅 Assigning closing responsibles for: ${week_start} to ${week_end}`);

    // Step 1: Get the 4 previous weeks to calculate scores
    const fourWeeksAgo = new Date(week_start);
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
    const fourWeeksAgoStr = fourWeeksAgo.toISOString().split('T')[0];

    // Step 2: Calculate scores for each secretary based on past 4 weeks
    const { data: pastAssignments, error: pastError } = await supabase
      .from('planning_genere_personnel')
      .select('secretaire_id, responsable_1r_id, responsable_2f_id, responsable_3f_id')
      .eq('type_assignation', 'site')
      .gte('date', fourWeeksAgoStr)
      .lt('date', week_start)
      .not('secretaire_id', 'is', null);

    if (pastError) throw pastError;

    // Calculate scores
    const scores = new Map<string, number>();
    for (const assignment of pastAssignments || []) {
      const secId = assignment.secretaire_id;
      if (!secId) continue;
      
      if (!scores.has(secId)) scores.set(secId, 0);
      
      // Count if this secretary was 1R, 2F, or 3F
      if (assignment.responsable_1r_id === secId) {
        scores.set(secId, scores.get(secId)! + 1);
      }
      if (assignment.responsable_2f_id === secId) {
        scores.set(secId, scores.get(secId)! + 2);
      }
      if (assignment.responsable_3f_id === secId) {
        scores.set(secId, scores.get(secId)! + 2); // 3F also counts as 2 points
      }
    }

    console.log(`📊 Calculated scores for ${scores.size} secretaries`);

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

    let assignmentCount = 0;

    // Step 6: Assign closing responsibles for each site/date
    for (const siteDay of sitesNeedingClosing) {
      const { date, site_id } = siteDay;
      const dayOfWeek = new Date(date).getDay(); // 0=Sunday, 1=Monday, 2=Tuesday, ...

      // Check if Paul Jacquier works on Thursday (4) and Friday (5) this week
      const needsThreeF = paulJacquier && dayOfWeek === 4; // Thursday = 4
      
      if (needsThreeF && paulJacquier) {
        // Check if Paul Jacquier actually works Thursday and Friday
        const { data: jacquierThursday, error: jThurError } = await supabase
          .from('besoin_effectif')
          .select('id')
          .eq('medecin_id', paulJacquier.id)
          .eq('date', date)
          .limit(1)
          .maybeSingle();

        if (jThurError) throw jThurError;

        const friday = new Date(date);
        friday.setDate(friday.getDate() + 1);
        const fridayStr = friday.toISOString().split('T')[0];

        const { data: jacquierFriday, error: jFriError } = await supabase
          .from('besoin_effectif')
          .select('id')
          .eq('medecin_id', paulJacquier.id)
          .eq('date', fridayStr)
          .limit(1)
          .maybeSingle();

        if (jFriError) throw jFriError;

        if (jacquierThursday && jacquierFriday) {
          console.log(`⚠️ Paul Jacquier works Thursday ${date} and Friday ${fridayStr}, need 3F on Thursday`);
        }
      }

      // Get secretaries assigned to this site on this date (morning and afternoon)
      const { data: assignedMorning, error: amError } = await supabase
        .from('planning_genere_personnel')
        .select('secretaire_id, secretaires(id, first_name, name)')
        .eq('date', date)
        .eq('site_id', site_id)
        .eq('periode', 'matin')
        .eq('type_assignation', 'site')
        .not('secretaire_id', 'is', null);

      if (amError) throw amError;

      const { data: assignedAfternoon, error: pmError } = await supabase
        .from('planning_genere_personnel')
        .select('secretaire_id, secretaires(id, first_name, name)')
        .eq('date', date)
        .eq('site_id', site_id)
        .eq('periode', 'apres_midi')
        .eq('type_assignation', 'site')
        .not('secretaire_id', 'is', null);

      if (pmError) throw pmError;

      // Find secretaries working BOTH morning and afternoon
      const morningIds = new Set(assignedMorning?.map(a => a.secretaire_id).filter(Boolean) || []);
      const afternoonIds = new Set(assignedAfternoon?.map(a => a.secretaire_id).filter(Boolean) || []);
      
      const bothPeriods = Array.from(morningIds).filter(id => afternoonIds.has(id));

      if (bothPeriods.length === 0) {
        console.log(`⚠️ No secretary works both periods on ${date} at ${siteDay.site_nom}`);
        continue;
      }

      // Filter out Florence Bron on Tuesdays for 2F role
      let candidates = bothPeriods;
      const isTuesday = dayOfWeek === 2;
      
      // Sort candidates by score (lowest first)
      candidates.sort((a, b) => {
        const scoreA = scores.get(a) || 0;
        const scoreB = scores.get(b) || 0;
        return scoreA - scoreB;
      });

      // Assign 1R (lowest score)
      const responsable1R = candidates[0];
      
      // Assign 2F or 3F (second lowest score, but not Florence Bron on Tuesday for 2F)
      let responsable2F3F = null;
      for (const candidate of candidates) {
        if (candidate === responsable1R) continue;
        
        // If Tuesday and Florence Bron, skip for 2F
        if (isTuesday && florenceBron && candidate === florenceBron.id) {
          console.log(`🚫 Skipping Florence Bron for 2F on Tuesday ${date}`);
          continue;
        }
        
        responsable2F3F = candidate;
        break;
      }

      // If we can't find a 2F (e.g., only Florence Bron available on Tuesday), use 1R for both
      if (!responsable2F3F) {
        responsable2F3F = responsable1R;
      }

      const secName1R = secretaries?.find(s => s.id === responsable1R);
      const secName2F3F = secretaries?.find(s => s.id === responsable2F3F);
      
      console.log(`✅ ${date} ${siteDay.site_nom}: 1R=${secName1R?.first_name} ${secName1R?.name} (score: ${scores.get(responsable1R) || 0}), ${needsThreeF ? '3F' : '2F'}=${secName2F3F?.first_name} ${secName2F3F?.name} (score: ${scores.get(responsable2F3F) || 0})`);

      // Update morning records
      const updateDataMorning: any = {
        responsable_1r_id: responsable1R,
      };
      if (needsThreeF) {
        updateDataMorning.responsable_3f_id = responsable2F3F;
      } else {
        updateDataMorning.responsable_2f_id = responsable2F3F;
      }

      const { error: updateMorningError } = await supabase
        .from('planning_genere_personnel')
        .update(updateDataMorning)
        .eq('date', date)
        .eq('site_id', site_id)
        .eq('periode', 'matin')
        .eq('type_assignation', 'site');

      if (updateMorningError) throw updateMorningError;

      // Update afternoon records
      const { error: updateAfternoonError } = await supabase
        .from('planning_genere_personnel')
        .update(updateDataMorning) // Same responsibles for afternoon
        .eq('date', date)
        .eq('site_id', site_id)
        .eq('periode', 'apres_midi')
        .eq('type_assignation', 'site');

      if (updateAfternoonError) throw updateAfternoonError;

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
