import type {
  SiteNeed,
  CapaciteEffective,
  WeekData,
  AssignmentSummary,
  DynamicContext
} from './types.ts';
import { ADMIN_SITE_ID } from './types.ts';
import { calculateDynamicScore } from './score-calculator.ts';

const DEBUG_VERBOSE = false;

export function buildMILPModelSoft(
  date: string,
  needs: SiteNeed[],
  capacites: CapaciteEffective[],
  week_data: WeekData,
  week_assignments: AssignmentSummary[]
) {
  if (DEBUG_VERBOSE) {
    console.log(`🔧 Construction du modèle MILP pour ${date}...`);
  }
  
  // Merge ADMIN needs with regular needs
  const adminNeedsForDate = week_data.admin_needs.filter((n: SiteNeed) => n.date === date);
  const allNeeds = [...needs, ...adminNeedsForDate];
  
  if (DEBUG_VERBOSE) {
    console.log(`  📊 Besoins sites/bloc: ${needs.length}, Besoins ADMIN: ${adminNeedsForDate.length}`);
  }
  
  const todayCapacites = capacites.filter(c => c.date === date);
  
  const model: any = {
    optimize: 'score_total',
    opType: 'max',
    constraints: {},
    variables: {},
    binaries: {}
  };
  
  // Dynamic context (snapshot)
  const context: DynamicContext = {
    week_assignments,
    today_assignments: new Map()
  };
  
  
  // ============================================================
  // VARIABLES AND COEFFICIENTS
  // ============================================================
  let variableCount = 0;
  let blocVariableCount = 0;
  
  for (let needIndex = 0; needIndex < allNeeds.length; needIndex++) {
    try {
      const need = allNeeds[needIndex];
      
      const isTargetBlocSite = need.site_id === '86f1047f-c4ff-441f-a064-42ee2f8ef37a' && need.type === 'bloc_operatoire';
      
      if (isTargetBlocSite) {
        console.log(`\n🎯 BLOC DEBUG - ${need.periode}`);
        console.log(`   🏥 BLOC IDs: op=${need.bloc_operation_id?.slice(0,8)}..., besoin=${need.besoin_operation_id?.slice(0,8)}...`);
      }
      
      // Create unique need ID with numeric period code (1=matin, 2=apres_midi)
      const periodCode = need.periode === 'matin' ? '1' : '2';
      const needId = need.type === 'bloc_operatoire' && need.bloc_operation_id && need.besoin_operation_id
        ? `${need.site_id}_${need.date}_${periodCode}_${need.bloc_operation_id}_${need.besoin_operation_id}`
        : `${need.site_id}_${need.date}_${periodCode}`;
      
      if (isTargetBlocSite) {
        console.log(`   📝 needId: ${needId}`);
      }
    
    
    let acceptedCount = 0;
    
    for (const cap of todayCapacites) {
      if (!cap.secretaire_id || cap.demi_journee !== need.periode) continue;
      
      const isAdminSite = need.site_id === ADMIN_SITE_ID;
      
      if (!isAdminSite) {
        if (need.type === 'bloc_operatoire' && need.besoin_operation_id) {
          const hasCompetence = week_data.secretaires_besoins.some(
            (sb: any) => sb.secretaire_id === cap.secretaire_id && 
                  sb.besoin_operation_id === need.besoin_operation_id
          );
          if (!hasCompetence) continue;
        } else {
          const isEligible = week_data.secretaires_sites.some(
            ss => ss.secretaire_id === cap.secretaire_id && ss.site_id === need.site_id
          );
          if (!isEligible) continue;
        }
      }
      
      const varName = `assign_${cap.secretaire_id}_${needId}`;
      
      const score = calculateDynamicScore(
        cap.secretaire_id,
        need,
        context,
        {
          besoins: week_data.secretaires_besoins,
          medecins: week_data.secretaires_medecins,
          sites: week_data.secretaires_sites
        },
        week_data.secretaires.find(s => s.id === cap.secretaire_id)!
      );
      
      if (score <= 0) continue;
      
      model.variables[varName] = { score_total: score };
      model.binaries[varName] = 1;
      variableCount++;
      acceptedCount++;
      
      if (need.type === 'bloc_operatoire') {
        blocVariableCount++;
      }
      
      if (isTargetBlocSite && acceptedCount <= 3) {
        console.log(`   ✅ Variable: ${varName} (score: ${score.toFixed(2)})`);
      }
    }
    
    if (isTargetBlocSite) {
      console.log(`   ✅ ${acceptedCount} variables créées pour ce besoin BLOC`);
    }
      
    } catch (error) {
      const err = error as Error;
      console.error(`\n❌ ERREUR lors du traitement du besoin [${needIndex + 1}/${allNeeds.length}]:`);
      console.error(`   Type: ${err.name}`);
      console.error(`   Message: ${err.message}`);
      console.error(`   Stack: ${err.stack}`);
      
      // Log du besoin qui a causé l'erreur
      const failedNeed = allNeeds[needIndex];
      console.error(`   Besoin en erreur:`, {
        type: failedNeed.type,
        site_id: failedNeed.site_id?.slice(0, 8),
        periode: failedNeed.periode,
        bloc_op: failedNeed.bloc_operation_id?.slice(0, 8),
        besoin_op: failedNeed.besoin_operation_id?.slice(0, 8)
      });
      
      // Continue avec le besoin suivant au lieu d'arrêter tout
      continue;
    }
  }
  
  
  // ============================================================
  // CONSTRAINTS: Need satisfaction (min=max for productive sites, max only for ADMIN)
  // ============================================================
  for (let needIndex = 0; needIndex < allNeeds.length; needIndex++) {
    const need = allNeeds[needIndex];
    const periodCode = need.periode === 'matin' ? '1' : '2';
    const needId = need.type === 'bloc_operatoire' && need.bloc_operation_id && need.besoin_operation_id
      ? `${need.site_id}_${need.date}_${periodCode}_${need.bloc_operation_id}_${need.besoin_operation_id}`
      : `${need.site_id}_${need.date}_${periodCode}`;
    
    const isAdminSite = need.site_id === ADMIN_SITE_ID;
    
    const constraintName = `max_need_${needId}`;
    model.constraints[constraintName] = { max: need.nombre_max };
    
    for (const varName of Object.keys(model.variables)) {
      if (varName.startsWith('assign_') && varName.endsWith(`_${needId}`)) {
        model.variables[varName][constraintName] = 1;
      }
    }
  }
  
  const slotNeeds = new Map<string, SiteNeed[]>();
  for (const need of allNeeds) {
    const slotKey = `${need.site_id}_${need.date}_${need.periode}`;
    if (!slotNeeds.has(slotKey)) {
      slotNeeds.set(slotKey, []);
    }
    slotNeeds.get(slotKey)!.push(need);
  }
  
  for (const [slotKey, needsInSlot] of slotNeeds) {
    const totalMax = needsInSlot.length === 1 
      ? needsInSlot[0].nombre_max 
      : Math.ceil(needsInSlot.reduce((sum, n) => sum + n.nombre_max, 0));
    
    const constraintName = `max_slot_${slotKey}`;
    model.constraints[constraintName] = { max: totalMax };
    
    for (const varName of Object.keys(model.variables)) {
      if (varName.startsWith('assign_') && varName.includes(slotKey)) {
        model.variables[varName][constraintName] = 1;
      }
    }
  }
  
  const secretairesByPeriode = new Map<string, string[]>();
  
  for (let needIndex = 0; needIndex < allNeeds.length; needIndex++) {
    const need = allNeeds[needIndex];
    const periodCode = need.periode === 'matin' ? '1' : '2';
    const needId = need.type === 'bloc_operatoire' && need.bloc_operation_id && need.besoin_operation_id
      ? `${need.site_id}_${need.date}_${periodCode}_${need.bloc_operation_id}_${need.besoin_operation_id}`
      : `${need.site_id}_${need.date}_${periodCode}`;
    
    for (const cap of todayCapacites) {
      if (!cap.secretaire_id || cap.demi_journee !== need.periode) continue;
      
      const key = `${cap.secretaire_id}_${need.periode}`;
      const varName = `assign_${cap.secretaire_id}_${needId}`;
      
      if (!model.variables[varName]) continue;
      
      if (!secretairesByPeriode.has(key)) {
        secretairesByPeriode.set(key, []);
      }
      secretairesByPeriode.get(key)!.push(varName);
    }
  }
  
  for (const [key, varNames] of secretairesByPeriode) {
    const constraintName = `max_one_${key}`;
    model.constraints[constraintName] = { max: 1 };
    
    for (const varName of varNames) {
      if (model.variables[varName]) {
        model.variables[varName][constraintName] = 1;
      }
    }
  }
  
  // ============================================================
  // CONSTRAINT: Closure sites = 2 full-day people
  // ============================================================
  const closureSites = week_data.sites.filter(s => s.fermeture);
  
  for (const site of closureSites) {
    const morningNeed = allNeeds.find(
      n => n.site_id === site.id && n.date === date && n.periode === 'matin'
    );
    const afternoonNeed = allNeeds.find(
      n => n.site_id === site.id && n.date === date && n.periode === 'apres_midi'
    );
    
    if (morningNeed && afternoonNeed && 
        morningNeed.medecins_ids.length > 0 && 
        afternoonNeed.medecins_ids.length > 0) {
      
      const fullDayVars: string[] = [];
      
      for (const cap of todayCapacites.filter(c => c.secretaire_id)) {
      const morningNeedId = morningNeed.type === 'bloc_operatoire' && morningNeed.bloc_operation_id && morningNeed.besoin_operation_id
          ? `${site.id}_${date}_1_${morningNeed.bloc_operation_id}_${morningNeed.besoin_operation_id}`
          : `${site.id}_${date}_1`;
        const afternoonNeedId = afternoonNeed.type === 'bloc_operatoire' && afternoonNeed.bloc_operation_id && afternoonNeed.besoin_operation_id
          ? `${site.id}_${date}_2_${afternoonNeed.bloc_operation_id}_${afternoonNeed.besoin_operation_id}`
          : `${site.id}_${date}_2`;
        
        const morningVar = `assign_${cap.secretaire_id}_${morningNeedId}`;
        const afternoonVar = `assign_${cap.secretaire_id}_${afternoonNeedId}`;
        
        if (model.variables[morningVar] && model.variables[afternoonVar]) {
          const fullDayVar = `fullday_${cap.secretaire_id}_${site.id}_${date}`;
          model.binaries[fullDayVar] = 1;
          model.variables[fullDayVar] = { score_total: 0 };
          
          // fullDayVar <= morningVar
          const fdMConstraint = `fd_m_${fullDayVar}`;
          model.constraints[fdMConstraint] = { max: 0 };
          model.variables[fullDayVar][fdMConstraint] = 1;
          model.variables[morningVar][fdMConstraint] = -1;
          
          // fullDayVar <= afternoonVar
          const fdAConstraint = `fd_a_${fullDayVar}`;
          model.constraints[fdAConstraint] = { max: 0 };
          model.variables[fullDayVar][fdAConstraint] = 1;
          model.variables[afternoonVar][fdAConstraint] = -1;
          
          // 2*fullDayVar >= morningVar + afternoonVar - 1
          const fdSumConstraint = `fd_sum_${fullDayVar}`;
          model.constraints[fdSumConstraint] = { min: -1 };
          model.variables[fullDayVar][fdSumConstraint] = -2;
          model.variables[morningVar][fdSumConstraint] = 1;
          model.variables[afternoonVar][fdSumConstraint] = 1;
          
          fullDayVars.push(fullDayVar);
        }
      }
      
      if (fullDayVars.length >= 2) {
        const closureConstraint = `closure_${site.id}_${date}`;
        model.constraints[closureConstraint] = { min: 2 };
        for (const fdVar of fullDayVars) {
          model.variables[fdVar][closureConstraint] = 1;
        }
      }
    }
  }
  
  
  // ============================================================
  // CONSTRAINT: Bloc + forbidden site on same day (Big-M)
  // ============================================================
  const FORBIDDEN_SITES = [
    '7723c334-d06c-413d-96f0-be281d76520d', // Vieille ville
    '043899a1-a232-4c4b-9d7d-0eb44dad00ad'  // Centre Esplanade
  ];

  const secretairesWithCapacites = new Set(
    todayCapacites.filter(c => c.secretaire_id).map(c => c.secretaire_id)
  );

  for (const secretaire_id of secretairesWithCapacites) {
    // Collect all BLOC assignment variables for this secretary
    const blocVarsMatin: string[] = [];
    const blocVarsAM: string[] = [];
    
    for (const varName of Object.keys(model.variables)) {
      if (!varName.startsWith(`assign_${secretaire_id}_`)) continue;
      
      // Check if this is a bloc variable
      const isBlocVar = allNeeds.some(need => {
        const periodCode = need.periode === 'matin' ? '1' : '2';
        const needId = need.type === 'bloc_operatoire' && need.bloc_operation_id && need.besoin_operation_id
          ? `${need.site_id}_${need.date}_${periodCode}_${need.bloc_operation_id}_${need.besoin_operation_id}`
          : `${need.site_id}_${need.date}_${periodCode}`;
        
        return varName === `assign_${secretaire_id}_${needId}` && 
               need.type === 'bloc_operatoire';
      });
      
      if (isBlocVar) {
        if (varName.includes('_1_')) blocVarsMatin.push(varName);
        if (varName.includes('_2_')) blocVarsAM.push(varName);
      }
    }
    
    // Collect all FORBIDDEN SITE assignment variables for this secretary
    const forbiddenVarsMatin: string[] = [];
    const forbiddenVarsAM: string[] = [];
    
    for (const varName of Object.keys(model.variables)) {
      if (!varName.startsWith(`assign_${secretaire_id}_`)) continue;
      
      // Check if this is a forbidden site variable
      const isForbiddenVar = FORBIDDEN_SITES.some(siteId => 
        varName.includes(`_${siteId}_`)
      );
      
      if (isForbiddenVar) {
        if (varName.includes('_1_')) forbiddenVarsMatin.push(varName);
        if (varName.includes('_2_')) forbiddenVarsAM.push(varName);
      }
    }
    
    // Create auxiliary variable: bloc_forbidden_secretaireId_date
    // This variable = 1 if (bloc_matin AND forbidden_AM) OR (forbidden_matin AND bloc_AM)
    const auxVar = `bloc_forbidden_${secretaire_id}_${date}`;
    model.binaries[auxVar] = 1;
    model.variables[auxVar] = { 
      score_total: -10000 // PENALTIES.BLOC_EXCLUSION
    };
    
    // Linking constraint 1: auxVar >= bloc_matin + forbidden_AM - 1
    if (blocVarsMatin.length > 0 && forbiddenVarsAM.length > 0) {
      const constraint1 = `bloc_forbidden_1_${secretaire_id}_${date}`;
      model.constraints[constraint1] = { min: -1 };
      
      model.variables[auxVar][constraint1] = -1;
      for (const varName of blocVarsMatin) {
        model.variables[varName][constraint1] = 1;
      }
      for (const varName of forbiddenVarsAM) {
        model.variables[varName][constraint1] = 1;
      }
    }
    
    // Linking constraint 2: auxVar >= forbidden_matin + bloc_AM - 1
    if (forbiddenVarsMatin.length > 0 && blocVarsAM.length > 0) {
      const constraint2 = `bloc_forbidden_2_${secretaire_id}_${date}`;
      model.constraints[constraint2] = { min: -1 };
      
      model.variables[auxVar][constraint2] = -1;
      for (const varName of forbiddenVarsMatin) {
        model.variables[varName][constraint2] = 1;
      }
      for (const varName of blocVarsAM) {
        model.variables[varName][constraint2] = 1;
      }
    }
    
    // Linking constraint 3: auxVar <= bloc_matin + forbidden_AM
    if (blocVarsMatin.length > 0 && forbiddenVarsAM.length > 0) {
      const constraint3 = `bloc_forbidden_3_${secretaire_id}_${date}`;
      model.constraints[constraint3] = { max: 0 };
      
      model.variables[auxVar][constraint3] = 1;
      for (const varName of blocVarsMatin) {
        model.variables[varName][constraint3] = -1;
      }
      for (const varName of forbiddenVarsAM) {
        model.variables[varName][constraint3] = -1;
      }
    }
    
    // Linking constraint 4: auxVar <= forbidden_matin + bloc_AM
    if (forbiddenVarsMatin.length > 0 && blocVarsAM.length > 0) {
      const constraint4 = `bloc_forbidden_4_${secretaire_id}_${date}`;
      model.constraints[constraint4] = { max: 0 };
      
      model.variables[auxVar][constraint4] = 1;
      for (const varName of forbiddenVarsMatin) {
        model.variables[varName][constraint4] = -1;
      }
      for (const varName of blocVarsAM) {
        model.variables[varName][constraint4] = -1;
      }
    }
  }

  // ============================================================
  // CONSTRAINT: Site change penalty (Big-M)
  // ============================================================
  const HIGH_PENALTY_SITES = [
    '043899a1-a232-4c4b-9d7d-0eb44dad00ad', // Centre Esplanade
    '7723c334-d06c-413d-96f0-be281d76520d'  // Vieille ville
  ];

  for (const secretaire_id of secretairesWithCapacites) {
    // Group variables by site for morning and afternoon
    const siteVarsMatin = new Map<string, string[]>();
    const siteVarsAM = new Map<string, string[]>();
    
    for (const varName of Object.keys(model.variables)) {
      if (!varName.startsWith(`assign_${secretaire_id}_`)) continue;
      
      // Extract site_id from variable name
      const need = allNeeds.find(n => {
        const periodCode = n.periode === 'matin' ? '1' : '2';
        const needId = n.type === 'bloc_operatoire' && n.bloc_operation_id && n.besoin_operation_id
          ? `${n.site_id}_${n.date}_${periodCode}_${n.bloc_operation_id}_${n.besoin_operation_id}`
          : `${n.site_id}_${n.date}_${periodCode}`;
        return varName === `assign_${secretaire_id}_${needId}`;
      });
      
      if (!need) continue;
      
      // Skip ADMIN site (no penalty for admin changes)
      if (need.site_id === ADMIN_SITE_ID) continue;
      
      if (need.periode === 'matin') {
        if (!siteVarsMatin.has(need.site_id)) {
          siteVarsMatin.set(need.site_id, []);
        }
        siteVarsMatin.get(need.site_id)!.push(varName);
      } else {
        if (!siteVarsAM.has(need.site_id)) {
          siteVarsAM.set(need.site_id, []);
        }
        siteVarsAM.get(need.site_id)!.push(varName);
      }
    }
    
    // For each pair of different sites (morning vs afternoon)
    for (const [siteIdMatin, varsMatin] of siteVarsMatin) {
      for (const [siteIdAM, varsAM] of siteVarsAM) {
        if (siteIdMatin === siteIdAM) continue; // Same site = no change
        
        // Determine penalty
        const isHighPenalty = 
          HIGH_PENALTY_SITES.includes(siteIdMatin) || 
          HIGH_PENALTY_SITES.includes(siteIdAM);
        const penalty = isHighPenalty ? -60 : -40;
        
        // Create auxiliary variable: site_change_secretaireId_date_siteMatin_siteAM
        const auxVar = `site_change_${secretaire_id}_${date}_${siteIdMatin.slice(0,8)}_${siteIdAM.slice(0,8)}`;
        model.binaries[auxVar] = 1;
        model.variables[auxVar] = { 
          score_total: penalty 
        };
        
        // Linking constraint 1: auxVar >= site_matin + site_AM - 1
        const constraint1 = `site_change_1_${auxVar}`;
        model.constraints[constraint1] = { min: -1 };
        model.variables[auxVar][constraint1] = -1;
        
        for (const varName of varsMatin) {
          model.variables[varName][constraint1] = 1;
        }
        for (const varName of varsAM) {
          model.variables[varName][constraint1] = 1;
        }
        
        // Linking constraint 2: auxVar <= sum(site_matin)
        const constraint2 = `site_change_2_${auxVar}`;
        model.constraints[constraint2] = { max: 0 };
        model.variables[auxVar][constraint2] = 1;
        
        for (const varName of varsMatin) {
          model.variables[varName][constraint2] = -1;
        }
        
        // Linking constraint 3: auxVar <= sum(site_AM)
        const constraint3 = `site_change_3_${auxVar}`;
        model.constraints[constraint3] = { max: 0 };
        model.variables[auxVar][constraint3] = 1;
        
        for (const varName of varsAM) {
          model.variables[varName][constraint3] = -1;
        }
      }
    }
  }

  console.log(`\n🔧 Variables auxiliaires créées pour ${date}:`);
  const auxVarsBloc = Object.keys(model.variables).filter(v => v.startsWith('bloc_forbidden_')).length;
  const auxVarsSite = Object.keys(model.variables).filter(v => v.startsWith('site_change_')).length;
  console.log(`   🚫 ${auxVarsBloc} variables bloc_forbidden`);
  console.log(`   🔄 ${auxVarsSite} variables site_change`);
  
  return model;
}
