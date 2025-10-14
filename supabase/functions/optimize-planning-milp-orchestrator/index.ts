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

  // PHASE 1: Bloc opératoire
  if (optimize_bloc) {
    console.log('🏥 Phase 1: Optimizing bloc operatoire...');
    
    // Delete existing bloc assignments
    await supabaseServiceRole
      .from('planning_genere_bloc_operatoire')
      .delete()
      .eq('date', single_day);

    const blocUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/optimize-planning-milp-bloc`;
    const blocResponse = await fetch(blocUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
      },
      body: JSON.stringify({ single_day })
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
          planning_id: null, // Will be set later
          date: single_day,
          periode: b.periode,
          type: 'bloc_operatoire',
          planning_genere_bloc_operatoire_id: b.id,
          statut: 'planifie'
        }));
        
        await supabaseServiceRole
          .from('planning_genere')
          .insert(blocEntries);
        
        console.log(`  ✅ ${blocEntries.length} bloc entries created in planning_genere`);
      }
    }
  }

  // PHASE 2: Sites + remaining bloc needs
  if (optimize_sites) {
    console.log('🏢 Phase 2: Optimizing sites...');
    
    // Delete existing sites assignments
    await supabaseServiceRole
      .from('planning_genere_site_besoin')
      .delete()
      .eq('date', single_day);

    const sitesUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/optimize-planning-milp-sites`;
    const sitesResponse = await fetch(sitesUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
      },
      body: JSON.stringify({ 
        single_day,
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
  
  // Calculate week start and end
  const targetDate = new Date(single_day);
  const dayOfWeek = targetDate.getDay();
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Monday
  const weekStart = new Date(targetDate);
  weekStart.setDate(targetDate.getDate() + diff);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  
  const weekStartStr = weekStart.toISOString().split('T')[0];
  const weekEndStr = weekEnd.toISOString().split('T')[0];
  
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
