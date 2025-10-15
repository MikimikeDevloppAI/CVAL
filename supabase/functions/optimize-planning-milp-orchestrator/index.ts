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

    const { selected_dates, optimize_bloc = true, optimize_sites = true } = await req.json().catch(() => ({}));
    
    if (!selected_dates || !Array.isArray(selected_dates) || selected_dates.length === 0) {
      throw new Error('selected_dates parameter is required and must be a non-empty array');
    }

    console.log(`📅 Partial optimization for ${selected_dates.length} date(s):`, selected_dates);

    // Calculate week bounds from selected dates
    const dates = selected_dates.map(d => new Date(d)).sort((a, b) => a.getTime() - b.getTime());
    const weekStart = dates[0].toISOString().split('T')[0];
    const weekEnd = dates[dates.length - 1].toISOString().split('T')[0];
    
    console.log(`📊 Week range: ${weekStart} to ${weekEnd}`);

    let blocResults = null;
    let sitesResults = null;

  // Get or create planning_id for the week
  let planning_id;
  const { data: existingPlanning } = await supabaseServiceRole
    .from('planning')
    .select('*')
    .eq('date_debut', weekStart)
    .eq('date_fin', weekEnd)
    .maybeSingle();

  if (existingPlanning) {
    planning_id = existingPlanning.id;
  } else {
    const { data: newPlanning, error: planningError } = await supabaseServiceRole
      .from('planning')
      .insert({
        date_debut: weekStart,
        date_fin: weekEnd,
        statut: 'en_cours'
      })
      .select()
      .single();
    if (planningError) throw planningError;
    planning_id = newPlanning.id;
  }

  console.log(`📋 Using planning_id: ${planning_id} for week ${weekStart} to ${weekEnd}`);

  // Delete existing unified personnel rows (only selected dates or full week)
  // Conditional cleanup based on optimization type
  if (selected_dates.length < 7) {
    console.log(`\n🧹 Cleaning up ${selected_dates.length} specific dates...`);
    for (const date of selected_dates) {
      // Clean sites/admin if optimizing sites
      if (optimize_sites) {
        console.log(`  🏢 Deleting site/admin personnel for ${date}...`);
        await supabaseServiceRole
          .from('planning_genere_personnel')
          .delete()
          .eq('planning_id', planning_id)
          .eq('date', date)
          .in('type_assignation', ['site', 'administratif']);
        
        console.log(`  🔒 Resetting closing responsibles for ${date}...`);
        await supabaseServiceRole
          .from('planning_genere')
          .update({ 
            responsable_1r_id: null, 
            responsable_2f_id: null 
          })
          .eq('planning_id', planning_id)
          .eq('date', date);
      }
      
      // Clean bloc if optimizing bloc
      if (optimize_bloc) {
        console.log(`  🏥 Deleting bloc operations/personnel for ${date}...`);
        await supabaseServiceRole
          .from('planning_genere_bloc_operatoire')
          .delete()
          .eq('planning_id', planning_id)
          .eq('date', date);
        
        await supabaseServiceRole
          .from('planning_genere_personnel')
          .delete()
          .eq('planning_id', planning_id)
          .eq('date', date)
          .eq('type_assignation', 'bloc');
      } else {
        console.log(`  ⏭️  Skipping bloc cleanup for ${date} (optimize_bloc=false)`);
      }
      
      console.log(`  ✅ Cleaned date ${date}`);
    }
    console.log('✅ Partial cleanup complete');
  } else {
    console.log('🧹 Cleaning up full week...');
    
    // Clean sites/admin if optimizing sites
    if (optimize_sites) {
      console.log('  🏢 Deleting all site/admin personnel...');
      await supabaseServiceRole
        .from('planning_genere_personnel')
        .delete()
        .eq('planning_id', planning_id)
        .in('type_assignation', ['site', 'administratif']);
      
      console.log('  🔒 Resetting all closing responsibles...');
      await supabaseServiceRole
        .from('planning_genere')
        .update({ 
          responsable_1r_id: null, 
          responsable_2f_id: null 
        })
        .eq('planning_id', planning_id);
    }
    
    // Clean bloc if optimizing bloc
    if (optimize_bloc) {
      console.log('  🏥 Deleting all bloc operations/personnel...');
      await supabaseServiceRole
        .from('planning_genere_bloc_operatoire')
        .delete()
        .eq('planning_id', planning_id);
      
      await supabaseServiceRole
        .from('planning_genere_personnel')
        .delete()
        .eq('planning_id', planning_id)
        .eq('type_assignation', 'bloc');
    } else {
      console.log('  ⏭️  Skipping bloc cleanup (optimize_bloc=false)');
    }
    
    console.log('✅ Full cleanup complete');
  }

  // PHASE 1: Bloc opératoire
  if (optimize_bloc) {
    console.log('🏥 Phase 1: Optimizing bloc operatoire...');

    const blocUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/optimize-planning-milp-bloc`;
    const blocResponse = await fetch(blocUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
      },
      body: JSON.stringify({ 
        week_start: weekStart, 
        week_end: weekEnd, 
        selected_dates 
      })
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

  // PHASE 2: Sites optimization (always exclude bloc-assigned secretaries)
  if (optimize_sites) {
    console.log('🏢 Phase 2: Optimizing sites (excluding bloc-assigned secretaries)...');

    const sitesUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/optimize-planning-milp-sites`;
    const sitesResponse = await fetch(sitesUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
      },
      body: JSON.stringify({ 
        week_start: weekStart,
        week_end: weekEnd,
        exclude_bloc_assigned: true, // Always exclude to avoid conflicts
        selected_dates
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
      week_start: weekStart,
      week_end: weekEnd,
      planning_id,
      selected_dates
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
      week_start: weekStart,
      week_end: weekEnd,
      selected_dates
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
