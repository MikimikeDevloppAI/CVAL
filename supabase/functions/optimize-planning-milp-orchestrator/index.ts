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

  // Delete existing unified personnel rows for this week/day (idempotency)
  console.log('🧹 Cleaning up existing unified personnel entries...');
  await supabaseServiceRole
    .from('planning_genere_personnel')
    .delete()
    .gte('date', weekStartStr)
    .lte('date', weekEndStr)
    .in('type_assignation', ['site', 'administratif']);

  // PHASE 1: Bloc opératoire
  if (optimize_bloc) {
    console.log('🏥 Phase 1: Optimizing bloc operatoire...');
    
    // Delete existing bloc operations and bloc personnel for the week
    await supabaseServiceRole
      .from('planning_genere_bloc_operatoire')
      .delete()
      .eq('planning_id', planning_id)
      .gte('date', weekStartStr)
      .lte('date', weekEndStr);

    await supabaseServiceRole
      .from('planning_genere_personnel')
      .delete()
      .gte('date', weekStartStr)
      .lte('date', weekEndStr)
      .eq('type_assignation', 'bloc');

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
  }

  // PHASE 1.5 skipped: unified table handles site/admin directly
  console.log('📋 Phase 1.5 skipped (using planning_genere_personnel directly)');

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

  // PHASE 4: Assign closing responsibles (1R, 2F, 3F)
  let closingResults = null;
  console.log('🔒 Phase 4: Assigning closing responsibles...');
  
  const closingUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/assign-closing-responsibles`;
  const closingResponse = await fetch(closingUrl, {
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

  if (!closingResponse.ok) {
    const errorText = await closingResponse.text();
    console.error('⚠️ Closing responsibles assignment failed:', errorText);
  } else {
    closingResults = await closingResponse.json();
    console.log(`✅ Closing responsibles phase complete: ${JSON.stringify(closingResults)}`);
  }

    console.log('🎉 Orchestrator complete!');

    return new Response(JSON.stringify({
      success: true,
      bloc_results: blocResults,
      sites_results: sitesResults,
      flexible_results: flexibleResults,
      closing_results: closingResults
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
