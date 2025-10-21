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
  
  
  
  return model;
}
