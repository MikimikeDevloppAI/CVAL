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
    console.log('👥 Starting Flexible Secretaries optimization');
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { week_start, week_end, planning_id } = await req.json();
    
    if (!week_start || !week_end) {
      throw new Error('week_start and week_end are required');
    }

    console.log(`📅 Optimizing flexible secretaries for week ${week_start} to ${week_end}`);

    // 1. Fetch flexible secretaries without assignments
    const { data: flexibleSecretaries, error: secError } = await supabase
      .from('secretaires')
      .select('id, name, first_name, horaire_flexible, pourcentage_temps, prefere_port_en_truie, sites_assignes')
      .eq('actif', true)
      .eq('horaire_flexible', true)
      .gt('pourcentage_temps', 0);

    if (secError) throw secError;

    if (!flexibleSecretaries || flexibleSecretaries.length === 0) {
      console.log('ℹ️ No flexible secretaries found');
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'No flexible secretaries to optimize',
        flexible_assigned: 0
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`Found ${flexibleSecretaries.length} flexible secretaries`);

    // Filter out those already assigned this week
    const { data: existingAssignments } = await supabase
      .from('planning_genere')
      .select('secretaire_id, date, periode')
      .gte('date', week_start)
      .lte('date', week_end)
      .eq('type', 'site')
      .in('secretaire_id', flexibleSecretaries.map(s => s.id));

    const assignedSecretaryIds = new Set(existingAssignments?.map(a => a.secretaire_id) || []);
    const unassignedFlexible = flexibleSecretaries.filter(s => !assignedSecretaryIds.has(s.id));

    if (unassignedFlexible.length === 0) {
      console.log('ℹ️ All flexible secretaries already assigned');
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'All flexible secretaries already assigned',
        flexible_assigned: 0
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`${unassignedFlexible.length} flexible secretaries to assign`);

    // 2. Calculate required days for each
    const secretariesWithDays = unassignedFlexible.map(sec => ({
      ...sec,
      jours_requis: Math.round((sec.pourcentage_temps / 100) * 5)
    }));
    
    for (const sec of secretariesWithDays) {
      console.log(`  ${sec.first_name} ${sec.name}: ${sec.pourcentage_temps}% = ${sec.jours_requis} jours`);
    }

    // 3. Fetch unsatisfied needs (missing secretaries)
    const { data: siteBesoins, error: besoinsError } = await supabase
      .from('planning_genere_site_besoin')
      .select(`
        id,
        date,
        periode,
        site_id,
        nombre_secretaires_requis,
        sites!inner(nom)
      `)
      .gte('date', week_start)
      .lte('date', week_end);

    if (besoinsError) throw besoinsError;

    // Get personnel assignments
    const { data: personnelAssignments, error: personnelError } = await supabase
      .from('planning_genere_site_personnel')
      .select(`
        id,
        planning_genere_site_besoin_id,
        secretaire_id,
        ordre
      `)
      .in('planning_genere_site_besoin_id', siteBesoins?.map(b => b.id) || []);

    if (personnelError) throw personnelError;

    // Calculate unsatisfied needs
    const unsatisfiedNeeds: any[] = [];
    for (const besoin of siteBesoins || []) {
      const assigned = personnelAssignments?.filter(p => 
        p.planning_genere_site_besoin_id === besoin.id && p.secretaire_id !== null
      ).length || 0;
      
      const manque = besoin.nombre_secretaires_requis - assigned;
      if (manque > 0) {
        // Get unassigned personnel rows
        const unassignedRows = personnelAssignments?.filter(p => 
          p.planning_genere_site_besoin_id === besoin.id && p.secretaire_id === null
        ) || [];
        
        for (let i = 0; i < Math.min(manque, unassignedRows.length); i++) {
          unsatisfiedNeeds.push({
            date: besoin.date,
            periode: besoin.periode,
            site_id: besoin.site_id,
            site_nom: (besoin.sites as any).nom,
            personnel_row_id: unassignedRows[i].id,
            besoin_id: besoin.id
          });
        }
      }
    }

    console.log(`Found ${unsatisfiedNeeds.length} unsatisfied need slots`);

    if (unsatisfiedNeeds.length === 0) {
      console.log('ℹ️ No unsatisfied needs to fill');
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'No unsatisfied needs',
        flexible_assigned: 0
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 4. Group needs by date to identify full-day opportunities
    const needsByDate = new Map<string, any[]>();
    for (const need of unsatisfiedNeeds) {
      if (!needsByDate.has(need.date)) {
        needsByDate.set(need.date, []);
      }
      needsByDate.get(need.date)!.push(need);
    }

    // Filter for dates that have both morning and afternoon needs
    const fullDayDates: string[] = [];
    for (const [date, needs] of needsByDate.entries()) {
      const hasMatin = needs.some(n => n.periode === 'matin');
      const hasApresMidi = needs.some(n => n.periode === 'apres_midi');
      if (hasMatin && hasApresMidi) {
        fullDayDates.push(date);
      }
    }

    console.log(`${fullDayDates.length} dates with full-day opportunities`);

    if (fullDayDates.length === 0) {
      console.log('ℹ️ No full-day opportunities available');
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'No full-day assignment opportunities',
        flexible_assigned: 0
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 5. Simple greedy assignment (can be replaced with MILP if needed)
    let totalAssigned = 0;
    
    for (const secretary of secretariesWithDays) {
      const daysToAssign: string[] = [];
      
      for (const date of fullDayDates) {
        if (daysToAssign.length >= secretary.jours_requis) break;
        
        const dateNeeds = needsByDate.get(date)!;
        const matinNeed = dateNeeds.find(n => n.periode === 'matin');
        const apresMidiNeed = dateNeeds.find(n => n.periode === 'apres_midi');
        
        if (!matinNeed || !apresMidiNeed) continue;
        
        // Check site compatibility
        const matinCompatible = secretary.sites_assignes.includes(matinNeed.site_id);
        const apresMidiCompatible = secretary.sites_assignes.includes(apresMidiNeed.site_id);
        
        if (matinCompatible && apresMidiCompatible && matinNeed.site_id === apresMidiNeed.site_id) {
          daysToAssign.push(date);
        }
      }
      
      console.log(`  Assigning ${secretary.first_name} ${secretary.name} to ${daysToAssign.length} days`);
      
      // Assign secretary to selected days
      for (const date of daysToAssign) {
        const dateNeeds = needsByDate.get(date)!;
        const matinNeed = dateNeeds.find(n => n.periode === 'matin');
        const apresMidiNeed = dateNeeds.find(n => n.periode === 'apres_midi');
        
        // Assign to morning
        await supabase
          .from('planning_genere_site_personnel')
          .update({ secretaire_id: secretary.id })
          .eq('id', matinNeed.personnel_row_id);
        
        // Assign to afternoon
        await supabase
          .from('planning_genere_site_personnel')
          .update({ secretaire_id: secretary.id })
          .eq('id', apresMidiNeed.personnel_row_id);
        
        // Remove from unsatisfied list
        const matinIndex = unsatisfiedNeeds.findIndex(n => n.personnel_row_id === matinNeed.personnel_row_id);
        if (matinIndex > -1) unsatisfiedNeeds.splice(matinIndex, 1);
        
        const apresMidiIndex = unsatisfiedNeeds.findIndex(n => n.personnel_row_id === apresMidiNeed.personnel_row_id);
        if (apresMidiIndex > -1) unsatisfiedNeeds.splice(apresMidiIndex, 1);
        
        totalAssigned += 2; // matin + apres_midi
        
        console.log(`    ✓ Assigned to ${matinNeed.site_nom} on ${date}`);
      }
    }

    // 6. Optimize with swaps for Port-en-Truie preference
    console.log('🔄 Checking for beneficial swaps...');
    
    const portEnTruieSiteId = (await supabase
      .from('sites')
      .select('id')
      .ilike('nom', '%Port-en-Truie%')
      .single()).data?.id;
    
    if (portEnTruieSiteId) {
      for (const secretary of secretariesWithDays) {
        if (!secretary.prefere_port_en_truie) continue;
        
        // Get this secretary's current assignments
        const { data: secAssignments } = await supabase
          .from('planning_genere_site_personnel')
          .select(`
            id,
            planning_genere_site_besoin!inner(date, periode, site_id)
          `)
          .eq('secretaire_id', secretary.id)
          .gte('planning_genere_site_besoin.date', week_start)
          .lte('planning_genere_site_besoin.date', week_end);
        
        if (!secAssignments) continue;
        
        for (const assignment of secAssignments) {
          const besoin = (assignment.planning_genere_site_besoin as any);
          if (besoin.site_id === portEnTruieSiteId) continue; // Already at preferred site
          
          // Find someone at Port-en-Truie same day/period who could swap
          const { data: portAssignments } = await supabase
            .from('planning_genere_site_personnel')
            .select(`
              id,
              secretaire_id,
              secretaires!inner(sites_assignes, prefere_port_en_truie),
              planning_genere_site_besoin!inner(date, periode, site_id)
            `)
            .eq('planning_genere_site_besoin.date', besoin.date)
            .eq('planning_genere_site_besoin.periode', besoin.periode)
            .eq('planning_genere_site_besoin.site_id', portEnTruieSiteId)
            .not('secretaire_id', 'is', null);
          
          for (const portAssignment of portAssignments || []) {
            const otherSecretary = (portAssignment.secretaires as any);
            
            // Check if swap is beneficial
            // Beneficial if: flexible secretary prefers Port-en-Truie AND other doesn't
            if (!otherSecretary.prefere_port_en_truie && 
                otherSecretary.sites_assignes.includes(besoin.site_id)) {
              
              console.log(`  🔄 Swapping ${secretary.first_name} to Port-en-Truie with secretaire ${portAssignment.secretaire_id}`);
              
              // Execute swap
              await supabase
                .from('planning_genere_site_personnel')
                .update({ secretaire_id: portAssignment.secretaire_id })
                .eq('id', assignment.id);
              
              await supabase
                .from('planning_genere_site_personnel')
                .update({ secretaire_id: secretary.id })
                .eq('id', portAssignment.id);
              
              break; // Only one swap per assignment
            }
          }
        }
      }
    }

    // 7. Delete administrative assignments for assigned flexible secretaries
    const assignedFlexibleIds = secretariesWithDays
      .filter(s => s.jours_requis > 0)
      .map(s => s.id);
    
    if (assignedFlexibleIds.length > 0) {
      await supabase
        .from('planning_genere')
        .delete()
        .eq('type', 'administratif')
        .in('secretaire_id', assignedFlexibleIds)
        .gte('date', week_start)
        .lte('date', week_end);
    }

    console.log('✅ Flexible secretaries optimization complete');

    return new Response(JSON.stringify({
      success: true,
      flexible_assigned: totalAssigned,
      secretaries_processed: secretariesWithDays.length
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('❌ Error in flexible optimization:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
