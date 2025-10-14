import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('🎛️ Starting MILP orchestrator');
    
    const supabaseServiceRole = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { single_day, optimize_bloc = true, optimize_sites = true } = await req.json().catch(() => ({}));
    
    if (!single_day) {
      throw new Error('single_day parameter is required');
    }

    console.log(`📅 Orchestrating optimization for: ${single_day}`);
    console.log(`   Bloc: ${optimize_bloc ? 'YES' : 'NO'}, Sites: ${optimize_sites ? 'YES' : 'NO'}`);

    let blocResults = null;
    let sitesResults = null;

  // Get or create planning_id for the week
  const targetDate = new Date(single_day);
  const dayOfWeek = targetDate.getDay();
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const weekStart = new Date(targetDate);
  weekStart.setDate(targetDate.getDate() + diff);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  
  const weekStartStr = weekStart.toISOString().split('T')[0];
  const weekEndStr = weekEnd.toISOString().split('T')[0];

  let planning_id;
  const { data: existingPlanning } = await supabaseServiceRole
    .from('planning')
    .select('*')
    .eq('date_debut', weekStartStr)
    .eq('date_fin', weekEndStr)
    .maybeSingle();

  if (existingPlanning) {
    planning_id = existingPlanning.id;
  } else {
    const { data: newPlanning, error: planningError } = await supabaseServiceRole
      .from('planning')
      .insert({
        date_debut: weekStartStr,
        date_fin: weekEndStr,
        statut: 'en_cours'
      })
      .select()
      .single();
    if (planningError) throw planningError;
    planning_id = newPlanning.id;
  }

  console.log(`📋 Using planning_id: ${planning_id} for week ${weekStartStr} to ${weekEndStr}`);

  // Delete ALL existing planning_genere entries for this day (idempotency)
  console.log('🧹 Cleaning up existing entries...');
  await supabaseServiceRole
    .from('planning_genere')
    .delete()
    .eq('date', single_day)
    .in('type', ['site', 'administratif', 'bloc_operatoire']);

  await supabaseServiceRole
    .from('planning_genere_site_besoin')
    .delete()
    .eq('date', single_day);

  // PHASE 1: Bloc opératoire
  if (optimize_bloc) {
    console.log('🏥 Phase 1: Optimizing bloc operatoire...');
    
    // Delete existing bloc assignments for the entire week
    await supabaseServiceRole
      .from('planning_genere_bloc_operatoire')
      .delete()
      .eq('planning_id', planning_id)
      .gte('date', weekStartStr)
      .lte('date', weekEndStr);

    const blocUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/optimize-planning-milp-bloc`;
    const blocResponse = await fetch(blocUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
      },
      body: JSON.stringify({ week_start: weekStartStr, week_end: weekEndStr })
    });

    if (!blocResponse.ok) {
      const errorText = await blocResponse.text();
      throw new Error(`Bloc optimization failed: ${errorText}`);
    }

    blocResults = await blocResponse.json();
    console.log(`✅ Bloc phase complete: ${JSON.stringify(blocResults)}`);
    
    // Create planning_genere entries for bloc
    if (blocResults.blocs_assigned > 0) {
      const { data: blocOps } = await supabaseServiceRole
        .from('planning_genere_bloc_operatoire')
        .select('id, periode')
        .eq('date', single_day);
      
      if (blocOps && blocOps.length > 0) {
        const blocEntries = blocOps.map((b: any) => ({
          planning_id,
          date: single_day,
          periode: b.periode,
          type: 'bloc_operatoire',
          planning_genere_bloc_operatoire_id: b.id,
          statut: 'planifie'
        }));
        
        await supabaseServiceRole
          .from('planning_genere')
          .insert(blocEntries);
        
        console.log(`  ✅ ${blocEntries.length} bloc entries created in planning_genere with planning_id`);
      }
    }
  }

  // PHASE 1.5: Generate empty personnel rows
  console.log('📋 Phase 1.5: Generating empty personnel rows for the week...');
  
  // Delete existing site besoins/personnel for the week
  await supabaseServiceRole
    .from('planning_genere_site_besoin')
    .delete()
    .gte('date', weekStartStr)
    .lte('date', weekEndStr);
  
  // Helper to get dates in range
  const getDatesInRange = (start: string, end: string): string[] => {
    const dates = [];
    const current = new Date(start);
    const endDate = new Date(end);
    while (current <= endDate) {
      dates.push(current.toISOString().split('T')[0]);
      current.setDate(current.getDate() + 1);
    }
    return dates;
  };
  
  // Fetch all besoins (doctor needs) for the week
  const { data: besoinsData, error: besoinsError } = await supabaseServiceRole
    .from('besoin_effectif')
    .select('*, medecins(besoin_secretaires)')
    .gte('date', weekStartStr)
    .lte('date', weekEndStr)
    .eq('type', 'medecin')
    .eq('actif', true);

  console.log(`  📊 Fetched ${besoinsData?.length || 0} besoin_effectif records`);
  if (besoinsError) console.error('  ❌ Error fetching besoins:', besoinsError);

  // Log besoins by date
  const besoinsByDate = new Map<string, number>();
  for (const b of besoinsData || []) {
    besoinsByDate.set(b.date, (besoinsByDate.get(b.date) || 0) + 1);
  }
  console.log('  📅 Besoins by date:', Object.fromEntries(besoinsByDate));
  
  // Fetch all sites (excluding bloc)
  const { data: sitesData } = await supabaseServiceRole
    .from('sites')
    .select('*')
    .eq('actif', true);
  
  const sites = sitesData?.filter((s: any) => !s.nom?.includes('Bloc opératoire')) || [];
  
  // Generate rows for each date/site/periode
  let totalPersonnelRows = 0;
  for (const date of getDatesInRange(weekStartStr, weekEndStr)) {
    const dayBesoins = besoinsData?.filter((b: any) => b.date === date) || [];
    
    for (const site of sites) {
      for (const periode of ['matin', 'apres_midi']) {
        // Find medecins for this site/period
        const medecinsThisPeriod = dayBesoins.filter((b: any) => {
          if (b.site_id !== site.id) return false;
          if (b.demi_journee === periode || b.demi_journee === 'toute_journee') return true;
          return false;
        });
        
        if (medecinsThisPeriod.length === 0) {
          // Log pour déboguer
          if (dayBesoins.some((b: any) => b.site_id === site.id)) {
            console.log(`    ⚠️ Site ${site.nom} has besoins but none for ${periode} on ${date}`);
          }
          continue;
        }
        
        // Calculate total need
        const totalBesoin = medecinsThisPeriod.reduce((sum: number, b: any) => {
          return sum + (Number(b.medecins?.besoin_secretaires) || 1.2);
        }, 0);
        
        const nombreRequis = Math.ceil(totalBesoin);
        const medecinsIds = medecinsThisPeriod.map((b: any) => b.medecin_id);
        
        // Create besoin entry
        const { data: savedBesoin } = await supabaseServiceRole
          .from('planning_genere_site_besoin')
          .insert({
            planning_id,
            date,
            site_id: site.id,
            periode,
            medecins_ids: medecinsIds,
            nombre_secretaires_requis: nombreRequis,
            statut: 'planifie'
          })
          .select()
          .single();
        
        // Create empty personnel rows
        const personnelRows = [];
        for (let ordre = 1; ordre <= nombreRequis; ordre++) {
          personnelRows.push({
            planning_genere_site_besoin_id: savedBesoin.id,
            secretaire_id: null,
            ordre
          });
        }
        
        if (personnelRows.length > 0) {
          await supabaseServiceRole
            .from('planning_genere_site_personnel')
            .insert(personnelRows);
          totalPersonnelRows += personnelRows.length;
        }
      }
    }
  }
  
  console.log(`✅ Phase 1.5 complete: ${totalPersonnelRows} empty personnel rows created`);

  // PHASE 2: Sites optimization (simplified)
  if (optimize_sites) {
    console.log('🏢 Phase 2: Optimizing sites (filling pre-generated rows)...');

    const sitesUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/optimize-planning-milp-sites`;
    const sitesResponse = await fetch(sitesUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
      },
      body: JSON.stringify({ 
        week_start: weekStartStr,
        week_end: weekEndStr,
        exclude_bloc_assigned: optimize_bloc
      })
    });

    if (!sitesResponse.ok) {
      const errorText = await sitesResponse.text();
      throw new Error(`Sites optimization failed: ${errorText}`);
    }

    sitesResults = await sitesResponse.json();
    console.log(`✅ Sites phase complete: ${JSON.stringify(sitesResults)}`);
  }

  // PHASE 3: Flexible secretaries
  let flexibleResults = null;
  console.log('👥 Phase 3: Optimizing flexible secretaries...');
  
  const flexibleUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/optimize-planning-milp-flexible`;
  const flexibleResponse = await fetch(flexibleUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
    },
    body: JSON.stringify({ 
      week_start: weekStartStr,
      week_end: weekEndStr
    })
  });

  if (!flexibleResponse.ok) {
    const errorText = await flexibleResponse.text();
    console.error('⚠️ Flexible optimization failed:', errorText);
  } else {
    flexibleResults = await flexibleResponse.json();
    console.log(`✅ Flexible phase complete: ${JSON.stringify(flexibleResults)}`);
  }

    console.log('🎉 Orchestrator complete!');

    return new Response(JSON.stringify({
      success: true,
      bloc_results: blocResults,
      sites_results: sitesResults,
      flexible_results: flexibleResults
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('❌ Orchestrator error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
