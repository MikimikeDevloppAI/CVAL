import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

// ISO Week utilities
function startOfISOWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = (day === 0 ? -6 : 1) - day; // Monday = 1, Sunday = 0
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function endOfISOWeek(date: Date): Date {
  const start = startOfISOWeek(date);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  end.setUTCHours(23, 59, 59, 999);
  return end;
}

function formatDateUTC(date: Date): string {
  return date.toISOString().split('T')[0];
}

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

    // Normalize to ISO week bounds (Monday to Sunday)
    const refDate = new Date(selected_dates[0]);
    const weekStartDate = startOfISOWeek(refDate);
    const weekEndDate = endOfISOWeek(refDate);
    const weekStart = formatDateUTC(weekStartDate);
    const weekEnd = formatDateUTC(weekEndDate);
    
    console.log(`📊 Using ISO week bounds: ${weekStart} (Monday) to ${weekEnd} (Sunday)`);

    // Validate all selected dates are in the same week
    for (const dateStr of selected_dates) {
      const d = new Date(dateStr);
      if (d < weekStartDate || d > weekEndDate) {
        throw new Error(`All selected dates must be in the same ISO week. Date ${dateStr} is outside the week ${weekStart} to ${weekEnd}.`);
      }
    }
    console.log('✅ All selected dates validated within the same ISO week');

    let blocResults = null;
    let sitesResults = null;

  // Get or create planning_id for the ISO week
  let planning_id;
  
  // Search 1: Exact match by week bounds
  const { data: existingPlanningExact } = await supabaseServiceRole
    .from('planning')
    .select('*')
    .eq('date_debut', weekStart)
    .eq('date_fin', weekEnd)
    .maybeSingle();

  if (existingPlanningExact) {
    planning_id = existingPlanningExact.id;
    console.log(`📋 Found existing planning by exact match: ${planning_id}`);
  } else {
    // Search 2: Fallback - find planning that contains the reference date
    const refDateStr = formatDateUTC(refDate);
    const { data: existingPlanningContains } = await supabaseServiceRole
      .from('planning')
      .select('*')
      .lte('date_debut', refDateStr)
      .gte('date_fin', refDateStr)
      .maybeSingle();
    
    if (existingPlanningContains) {
      console.log(`📋 Found existing planning by containment: ${existingPlanningContains.id} (original bounds: ${existingPlanningContains.date_debut} to ${existingPlanningContains.date_fin})`);
      
      // Update to ISO week bounds if different
      if (existingPlanningContains.date_debut !== weekStart || 
          existingPlanningContains.date_fin !== weekEnd) {
        const { error: updateError } = await supabaseServiceRole
          .from('planning')
          .update({
            date_debut: weekStart,
            date_fin: weekEnd
          })
          .eq('id', existingPlanningContains.id);
        
        if (updateError) throw updateError;
        console.log(`📋 Updated existing planning ${existingPlanningContains.id} to ISO week bounds: ${weekStart} to ${weekEnd}`);
      }
      
      planning_id = existingPlanningContains.id;
      console.log(`📋 Using planning: ${planning_id} (now covers ${weekStart} to ${weekEnd})`);
    } else {
      // Create new planning with ISO week bounds
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
      console.log(`📋 Created new planning: ${planning_id} for ISO week ${weekStart} to ${weekEnd}`);
    }
  }

  console.log(`📋 Using planning_id: ${planning_id} for week ${weekStart} to ${weekEnd}`);

  // Update planning timestamp to mark optimization start
  const { error: timestampError } = await supabaseServiceRole
    .from('planning')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', planning_id);

  if (timestampError) {
    console.error('⚠️ Failed to update planning timestamp:', timestampError);
    // Non-blocking - continue anyway
  }
  console.log('⏰ Updated planning.updated_at to mark optimization start');

  // Delete existing unified personnel rows (only selected dates or full week)
  // Conditional cleanup based on optimization type
  if (selected_dates.length < 7) {
    console.log(`\n🧹 Cleaning up ${selected_dates.length} specific dates (without planning_id filter to catch erroneous old entries)...`);
    for (const date of selected_dates) {
      // Clean sites/admin if optimizing sites
      if (optimize_sites) {
        console.log(`  🏢 Deleting site/admin personnel for ${date} (all planning_id)...`);
        await supabaseServiceRole
          .from('planning_genere_personnel')
          .delete()
          .eq('date', date)
          .in('type_assignation', ['site', 'administratif']);
        
        console.log(`  🔒 Resetting closing responsibles for ${date} (all planning_id)...`);
        await supabaseServiceRole
          .from('planning_genere')
          .update({ 
            responsable_1r_id: null, 
            responsable_2f_id: null 
          })
          .eq('date', date);
      }
      
      // Clean bloc if optimizing bloc
      if (optimize_bloc) {
        console.log(`  🏥 Deleting bloc operations/personnel for ${date} (all planning_id)...`);
        await supabaseServiceRole
          .from('planning_genere_bloc_operatoire')
          .delete()
          .eq('date', date);
        
        await supabaseServiceRole
          .from('planning_genere_personnel')
          .delete()
          .eq('date', date)
          .eq('type_assignation', 'bloc');
      } else {
        console.log(`  ⏭️  Skipping bloc cleanup for ${date} (optimize_bloc=false)`);
      }
      
      console.log(`  ✅ Cleaned date ${date}`);
    }
    console.log('✅ Partial cleanup complete (all old entries removed regardless of planning_id)');
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
        selected_dates,
        planning_id  // Pass planning_id to avoid duplicate creation
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
        selected_dates,
        planning_id  // Pass planning_id to avoid duplicate creation
      })
    });

    if (!sitesResponse.ok) {
      const errorText = await sitesResponse.text();
      throw new Error(`Sites optimization failed: ${errorText}`);
    }

    sitesResults = await sitesResponse.json();
    console.log(`✅ Sites phase complete: ${JSON.stringify(sitesResults)}`);
  }

  // PHASE 3: Flexible secretaries (REMOVED - now handled in Phase 2)
  let flexibleResults = null;
  console.log('👥 Phase 3: SKIPPED (flexible secretaries now handled in Phase 2 with absence checks)');

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
