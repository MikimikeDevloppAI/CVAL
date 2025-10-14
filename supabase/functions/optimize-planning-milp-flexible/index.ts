import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import solver from 'https://esm.sh/javascript-lp-solver@0.4.24';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

interface Position {
  personnel_row_id: string;
  besoin_id: string;
  date: string;
  periode: 'matin' | 'apres_midi';
  site_id: string;
  site_nom: string;
  is_manquant: boolean;
  current_secretaire_id: string | null;
  current_secretaire_info: {
    is_flexible: boolean;
    prefere_port_en_truie: boolean;
    sites_assignes: string[];
    name: string;
    first_name: string;
  } | null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('👥 Starting Flexible Secretaries MILP optimization');
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { week_start, week_end, planning_id } = await req.json();
    
    if (!week_start || !week_end) {
      throw new Error('week_start and week_end are required');
    }

    console.log(`📅 Optimizing flexible secretaries for week ${week_start} to ${week_end}`);

    // ==================== DATA COLLECTION ====================
    
    // 1. Fetch ALL secretaries (for preferences)
    const { data: allSecretaires, error: allSecError } = await supabase
      .from('secretaires')
      .select('id, name, first_name, prefere_port_en_truie, sites_assignes, horaire_flexible, pourcentage_temps')
      .eq('actif', true);

    if (allSecError) throw allSecError;

    // Build secretary map for quick lookup
    const secretaryMap = new Map(allSecretaires?.map(s => [s.id, s]) || []);

    // 2. Get flexible secretaries
    const flexibleSecretaries = allSecretaires?.filter(s => 
      s.horaire_flexible && s.pourcentage_temps && s.pourcentage_temps > 0
    ) || [];

    if (flexibleSecretaries.length === 0) {
      console.log('ℹ️ No flexible secretaries found');
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'No flexible secretaries to optimize',
        flexible_assigned: 0,
        secretaries_processed: 0
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`Found ${flexibleSecretaries.length} flexible secretaries`);

    // Filter out those already assigned this week
    const { data: existingAssignments } = await supabase
      .from('planning_genere_site_personnel')
      .select(`
        secretaire_id,
        planning_genere_site_besoin!inner(date, periode)
      `)
      .gte('planning_genere_site_besoin.date', week_start)
      .lte('planning_genere_site_besoin.date', week_end)
      .in('secretaire_id', flexibleSecretaries.map(s => s.id));

    const assignedSecretaryIds = new Set(existingAssignments?.map(a => a.secretaire_id) || []);
    const unassignedFlexible = flexibleSecretaries.filter(s => !assignedSecretaryIds.has(s.id));

    if (unassignedFlexible.length === 0) {
      console.log('ℹ️ All flexible secretaries already assigned');
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'All flexible secretaries already assigned',
        flexible_assigned: 0,
        secretaries_processed: 0
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`${unassignedFlexible.length} flexible secretaries to assign`);

    // Calculate required days for each
    const secretariesWithDays = unassignedFlexible.map(sec => ({
      ...sec,
      jours_requis: Math.round((sec.pourcentage_temps / 100) * 5)
    }));
    
    for (const sec of secretariesWithDays) {
      console.log(`  ${sec.first_name} ${sec.name}: ${sec.pourcentage_temps}% = ${sec.jours_requis} jours`);
    }

    // 3. Fetch ALL site besoins for the week
    const { data: allSiteBesoins, error: besoinsError } = await supabase
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

    // 4. Fetch ALL personnel assignments (assigned AND unassigned)
    const { data: allPersonnelRows, error: personnelError } = await supabase
      .from('planning_genere_site_personnel')
      .select(`
        id,
        planning_genere_site_besoin_id,
        secretaire_id,
        ordre
      `)
      .in('planning_genere_site_besoin_id', allSiteBesoins?.map(b => b.id) || []);

    if (personnelError) throw personnelError;

    // 5. Get Port-en-Truie ID
    const { data: portEnTruieSite } = await supabase
      .from('sites')
      .select('id')
      .ilike('nom', '%Port-en-Truie%')
      .single();
    const PORT_EN_TRUIE_ID = portEnTruieSite?.id;

    // ==================== BUILD POSITIONS ====================
    
    const positions: Position[] = [];

    for (const besoin of allSiteBesoins || []) {
      const personnelRows = allPersonnelRows?.filter(
        p => p.planning_genere_site_besoin_id === besoin.id
      ) || [];
      
      for (const row of personnelRows) {
        const currentSecretary = row.secretaire_id ? secretaryMap.get(row.secretaire_id) : null;
        
        positions.push({
          personnel_row_id: row.id,
          besoin_id: besoin.id,
          date: besoin.date,
          periode: besoin.periode,
          site_id: besoin.site_id,
          site_nom: (besoin.sites as any).nom,
          is_manquant: row.secretaire_id === null,
          current_secretaire_id: row.secretaire_id,
          current_secretaire_info: currentSecretary ? {
            is_flexible: currentSecretary.horaire_flexible || false,
            prefere_port_en_truie: currentSecretary.prefere_port_en_truie || false,
            sites_assignes: currentSecretary.sites_assignes || [],
            name: currentSecretary.name || '',
            first_name: currentSecretary.first_name || ''
          } : null
        });
      }
    }

    console.log(`Built ${positions.length} positions (${positions.filter(p => p.is_manquant).length} manquants, ${positions.filter(p => !p.is_manquant).length} occupés)`);

    if (positions.length === 0) {
      console.log('ℹ️ No positions available');
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'No positions available',
        flexible_assigned: 0,
        secretaries_processed: 0
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ==================== BUILD MILP MODEL ====================
    
    console.log('🧮 Building MILP model...');
    
    const model: any = {
      optimize: 'score',
      opType: 'max',
      constraints: {},
      variables: {},
      ints: {}
    };

    const PENALTY_DISPLACEMENT = 20;

    // Get unique dates from positions
    const allDates = [...new Set(positions.map(p => p.date))].sort();
    
    console.log(`  Processing ${allDates.length} dates for optimization`);

    // For each flexible secretary
    for (const secretary of secretariesWithDays) {
      const f_id = secretary.id;
      const jours_requis = secretary.jours_requis;
      
      // Track day variables for this secretary
      const dayVars: string[] = [];
      
      // For each date
      for (const date of allDates) {
        // Create day variable: day_<f_id>_<date>
        const dayVarName = `day_${f_id}_${date}`;
        model.variables[dayVarName] = { score: 0 };
        model.ints[dayVarName] = 1;
        dayVars.push(dayVarName);
        
        // Track matin and apres_midi position variables for this date
        const matinPositionVars: string[] = [];
        const apresMidiPositionVars: string[] = [];
        
        // Process positions for this date
        const datePositions = positions.filter(p => p.date === date);
        
        for (const pos of datePositions) {
          // Check site compatibility
          if (!secretary.sites_assignes.includes(pos.site_id)) continue;
          
          const periode_key = pos.periode === 'matin' ? 'matin' : 'apres_midi';
          const varName = `x_${f_id}_${date}_${periode_key}_${pos.personnel_row_id}`;
          
          // Calculate coefficient (score)
          let coefficient = 0;
          
          // 1. Besoin manquant comblé: +100
          if (pos.is_manquant) {
            coefficient += 100;
          }
          
          // 2. Flexible préfère Port-en-Truie ET pos est Port-en-Truie: +80
          if (secretary.prefere_port_en_truie && pos.site_id === PORT_EN_TRUIE_ID) {
            coefficient += 80;
          }
          
          // 3. Swap bénéfique Port-en-Truie: +50
          if (!pos.is_manquant && 
              secretary.prefere_port_en_truie && 
              pos.site_id === PORT_EN_TRUIE_ID && 
              pos.current_secretaire_info &&
              !pos.current_secretaire_info.prefere_port_en_truie) {
            coefficient += 50;
          }
          
          // 4. Pénalité: déplacer quelqu'un de son site préféré: -30
          if (!pos.is_manquant && 
              pos.current_secretaire_info &&
              pos.current_secretaire_info.prefere_port_en_truie &&
              pos.site_id === PORT_EN_TRUIE_ID &&
              !secretary.prefere_port_en_truie) {
            coefficient -= 30;
          }
          
          // 5. Bonus: site compatible neutre: +10
          if (!pos.is_manquant && 
              pos.current_secretaire_info &&
              !pos.current_secretaire_info.prefere_port_en_truie) {
            coefficient += 10;
          }
          
          // Create variable
          model.variables[varName] = { score: coefficient };
          model.ints[varName] = 1;
          
          // Track for period
          if (pos.periode === 'matin') {
            matinPositionVars.push(varName);
          } else {
            apresMidiPositionVars.push(varName);
          }
          
          // Constraint: one secretary per period
          const constraintCapacity = `capacity_${f_id}_${date}_${periode_key}`;
          if (!model.constraints[constraintCapacity]) {
            model.constraints[constraintCapacity] = { max: 1 };
          }
          model.variables[varName][constraintCapacity] = 1;
          
          // Constraint: if occupied position, only one person can take it
          if (!pos.is_manquant) {
            const constraintOccupied = `occupied_${pos.personnel_row_id}`;
            if (!model.constraints[constraintOccupied]) {
              model.constraints[constraintOccupied] = { max: 1 };
            }
            model.variables[varName][constraintOccupied] = 1;
          }
        }
        
        // Constraint: day <= sum(matin positions)
        if (matinPositionVars.length > 0) {
          const constraintDayMatin = `day_leq_matin_${f_id}_${date}`;
          model.constraints[constraintDayMatin] = { max: 0 };
          model.variables[dayVarName][constraintDayMatin] = 1;
          for (const mv of matinPositionVars) {
            model.variables[mv][constraintDayMatin] = -1;
          }
        }
        
        // Constraint: day <= sum(apres_midi positions)
        if (apresMidiPositionVars.length > 0) {
          const constraintDayAM = `day_leq_am_${f_id}_${date}`;
          model.constraints[constraintDayAM] = { max: 0 };
          model.variables[dayVarName][constraintDayAM] = 1;
          for (const amv of apresMidiPositionVars) {
            model.variables[amv][constraintDayAM] = -1;
          }
        }
        
        // NEW Constraint: day >= sum(matin) + sum(apres_midi) - 1
        // Forces day=1 only if BOTH matin AND apres_midi are assigned
        // Rewritten as: sum(matin) + sum(apres_midi) - day <= 1
        if (matinPositionVars.length > 0 && apresMidiPositionVars.length > 0) {
          const constraintDayBoth = `day_geq_both_${f_id}_${date}`;
          model.constraints[constraintDayBoth] = { max: 1 };
          model.variables[dayVarName][constraintDayBoth] = -1; // -day
          for (const mv of matinPositionVars) {
            model.variables[mv][constraintDayBoth] = 1; // +matin
          }
          for (const amv of apresMidiPositionVars) {
            model.variables[amv][constraintDayBoth] = 1; // +apres_midi
          }
        }
      }
      
      // Constraint: sum(days) = jours_requis
      const constraintJoursRequis = `jours_requis_${f_id}`;
      model.constraints[constraintJoursRequis] = { equal: jours_requis };
      for (const dayVar of dayVars) {
        model.variables[dayVar][constraintJoursRequis] = 1;
      }
    }
    
    // Add displacement penalties
    for (const pos of positions) {
      if (pos.is_manquant || !pos.current_secretaire_id) continue;
      
      const displaceVarName = `displaced_${pos.current_secretaire_id}_${pos.date}_${pos.periode}`;
      model.variables[displaceVarName] = { score: -PENALTY_DISPLACEMENT };
      model.ints[displaceVarName] = 1;
      
      // displaced = 1 if any flexible takes this position
      const constraintDisplace = `displace_${pos.personnel_row_id}`;
      model.constraints[constraintDisplace] = { max: 0 };
      model.variables[displaceVarName][constraintDisplace] = -1;
      
      // Link to position variables
      for (const secretary of secretariesWithDays) {
        const periode_key = pos.periode === 'matin' ? 'matin' : 'apres_midi';
        const posVarName = `x_${secretary.id}_${pos.date}_${periode_key}_${pos.personnel_row_id}`;
        if (model.variables[posVarName]) {
          model.variables[posVarName][constraintDisplace] = 1;
        }
      }
    }

    console.log(`  📊 Variables: ${Object.keys(model.variables).length}`);
    console.log(`  📊 Constraints: ${Object.keys(model.constraints).length}`);

    // ==================== SOLVE MILP ====================
    
    console.log('⚡ Solving MILP...');
    const solution = solver.Solve(model);

    if (!solution.feasible) {
      console.log('❌ MILP infeasible - no valid solution found');
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'No feasible solution found for flexible secretaries',
        flexible_assigned: 0,
        secretaries_processed: 0
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`✅ MILP solution found with score: ${solution.result}`);

    // ==================== PARSE SOLUTION ====================
    
    const assignments: { 
      flexible_id: string; 
      personnel_row_id: string; 
      date: string; 
      periode: string;
      site_nom: string;
    }[] = [];
    const displacements: { 
      displaced_id: string; 
      date: string; 
      periode: 'matin' | 'apres_midi';
      displaced_name: string;
    }[] = [];

    for (const [varName, value] of Object.entries(solution)) {
      if (!varName.startsWith('x_') || value !== 1) continue;
      
      // Parse: x_<f_id>_<date>_<periode>_<personnel_row_id>
      const parts = varName.split('_');
      if (parts.length < 5) continue;
      
      const f_id = parts[1];
      const date = parts[2];
      const periode_key = parts[3]; // 'matin' or 'apres' or 'midi'
      const personnel_row_id = parts.slice(4).join('_'); // Handle UUIDs with underscores
      
      const position = positions.find(p => p.personnel_row_id === personnel_row_id);
      if (!position) continue;
      
      const periode: 'matin' | 'apres_midi' = periode_key === 'matin' ? 'matin' : 'apres_midi';
      
      assignments.push({
        flexible_id: f_id,
        personnel_row_id,
        date,
        periode,
        site_nom: position.site_nom
      });
      
      // If swap, record displacement
      if (!position.is_manquant && position.current_secretaire_id) {
        const displaced = secretaryMap.get(position.current_secretaire_id);
        displacements.push({
          displaced_id: position.current_secretaire_id,
          date,
          periode,
          displaced_name: displaced ? `${displaced.first_name} ${displaced.name}` : 'Unknown'
        });
      }
    }

    console.log(`📝 Applying ${assignments.length} assignments (${displacements.length} swaps)`);

    // ==================== APPLY SOLUTION ====================
    
    // 1. Update personnel assignments
    for (const assignment of assignments) {
      await supabase
        .from('planning_genere_site_personnel')
        .update({ secretaire_id: assignment.flexible_id })
        .eq('id', assignment.personnel_row_id);
      
      const secretary = secretaryMap.get(assignment.flexible_id);
      console.log(`  ✓ Assigned ${secretary?.first_name} ${secretary?.name} to ${assignment.site_nom} on ${assignment.date} ${assignment.periode}`);
    }

    // 2. Create administrative entries for displaced secretaries
    if (displacements.length > 0) {
      const adminEntries = displacements.map(d => ({
        planning_id,
        date: d.date,
        periode: d.periode,
        type: 'administratif',
        secretaire_id: d.displaced_id,
        statut: 'planifie'
      }));

      const { error: adminError } = await supabase
        .from('planning_genere')
        .insert(adminEntries);
      
      if (adminError) {
        console.error('❌ Error creating admin entries:', adminError);
      } else {
        console.log(`  ✅ Created ${adminEntries.length} admin entries for displaced secretaries`);
        for (const d of displacements) {
          console.log(`    🔄 ${d.displaced_name} displaced on ${d.date} ${d.periode}`);
        }
      }
    }

    // 3. Delete old administrative assignments for flexibles now assigned
    const actuallyAssignedFlexibleIds = [...new Set(assignments.map(a => a.flexible_id))];
    if (actuallyAssignedFlexibleIds.length > 0) {
      await supabase
        .from('planning_genere')
        .delete()
        .eq('type', 'administratif')
        .in('secretaire_id', actuallyAssignedFlexibleIds)
        .gte('date', week_start)
        .lte('date', week_end);
      
      console.log(`  🗑️ Deleted old admin entries for ${actuallyAssignedFlexibleIds.length} flexibles`);
    }

    // ==================== STATISTICS ====================
    
    const statsBySecretary = new Map<string, { jours: Set<string>; sites: Set<string> }>();
    for (const assignment of assignments) {
      if (!statsBySecretary.has(assignment.flexible_id)) {
        statsBySecretary.set(assignment.flexible_id, { jours: new Set(), sites: new Set() });
      }
      const stats = statsBySecretary.get(assignment.flexible_id)!;
      
      // Count full days
      const otherPeriode = assignment.periode === 'matin' ? 'apres_midi' : 'matin';
      const hasOtherPeriode = assignments.some(a => 
        a.flexible_id === assignment.flexible_id && 
        a.date === assignment.date && 
        a.periode === otherPeriode
      );
      
      if (hasOtherPeriode) {
        stats.jours.add(assignment.date);
      }
      
      stats.sites.add(assignment.site_nom);
    }

    console.log('✅ Flexible secretaries optimization complete');
    for (const [sec_id, stats] of statsBySecretary) {
      const secretary = secretaryMap.get(sec_id);
      console.log(`  📊 ${secretary?.first_name} ${secretary?.name}: ${stats.jours.size} jours sur ${Array.from(stats.sites).join(', ')}`);
    }

    return new Response(JSON.stringify({
      success: true,
      flexible_assigned: assignments.length,
      secretaries_processed: statsBySecretary.size,
      optimization_score: solution.result,
      swaps_executed: displacements.length
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('❌ Error in flexible MILP optimization:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
