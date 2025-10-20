import type {
  SiteNeed,
  CapaciteEffective,
  WeekData,
  AssignmentSummary,
  DynamicContext
} from './types.ts';
import { ADMIN_SITE_ID } from './types.ts';
import { calculateDynamicScore } from './score-calculator.ts';

export function buildMILPModelSoft(
  date: string,
  needs: SiteNeed[],
  capacites: CapaciteEffective[],
  week_data: WeekData,
  week_assignments: AssignmentSummary[]
) {
  console.log(`\n🏗️ Construction du modèle MILP...`);
  console.log(`  📅 Date: ${date}`);
  console.log(`  📋 Besoins: ${needs.length}`);
  console.log(`  👥 Capacités: ${capacites.filter(c => c.date === date).length}`);
  
  const model: any = {
    optimize: 'score_total',
    opType: 'max',
    constraints: {},
    variables: {},
    binaries: {}
  };
  
  const todayCapacites = capacites.filter(c => c.date === date);
  
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
  
  for (let needIndex = 0; needIndex < needs.length; needIndex++) {
    const need = needs[needIndex];
    // Create unique need ID - for bloc include BOTH bloc_operation_id AND besoin_operation_id
    const needId = need.type === 'bloc_operatoire' && need.bloc_operation_id && need.besoin_operation_id
      ? `${need.site_id}_${need.date}_${need.periode}_bloc_${need.bloc_operation_id}_${need.besoin_operation_id}`
      : `${need.site_id}_${need.date}_${need.periode}`;
    
    console.log(`\n  📌 Besoin ${needId}:`, {
      site_id: need.site_id,
      periode: need.periode,
      nombre_max: need.nombre_max,
      type: need.type,
      bloc_operation_id: need.bloc_operation_id,
      besoin_operation_id: need.besoin_operation_id
    });
    
    for (const cap of todayCapacites) {
      if (!cap.secretaire_id) continue;
      if (cap.demi_journee !== need.periode) continue;
      
      // Check eligibility
      const isAdminSite = need.site_id === ADMIN_SITE_ID;
      
      if (!isAdminSite) {
        // For bloc: ONLY check competence (secretaires_besoins_operations)
        // No need to check site membership for bloc
        if (need.type === 'bloc_operatoire' && need.besoin_operation_id) {
          const hasCompetence = week_data.secretaires_besoins.some(
            sb => sb.secretaire_id === cap.secretaire_id && 
                  sb.besoin_operation_id === need.besoin_operation_id
          );
          if (!hasCompetence) continue;
        } else {
          // For regular site needs: check site membership
          const isEligible = week_data.secretaires_sites.some(
            ss => ss.secretaire_id === cap.secretaire_id && ss.site_id === need.site_id
          );
          if (!isEligible) continue;
        }
      }
      
      // Binary variable
      const varName = `assign_${cap.secretaire_id}_${needId}`;
      model.binaries[varName] = 1;
      
      // Calculate dynamic score
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
      
      // Initialize variable with objective coefficient
      model.variables[varName] = { score_total: score };
      variableCount++;
      
      if (need.type === 'bloc_operatoire') {
        blocVariableCount++;
      }
      
      if (variableCount <= 10) {
        console.log(`    ✅ Variable ${varName} créée avec score: ${score.toFixed(2)}`);
      }
    }
  }
  
  if (variableCount > 10) {
    console.log(`    ... et ${variableCount - 10} autres variables créées`);
  }
  console.log(`  🏥 Variables BLOC: ${blocVariableCount}`);
  
  // ============================================================
  // CONSTRAINT: Max per individual need
  // ============================================================
  console.log(`\n📏 Contraintes par besoin individuel...`);
  for (let needIndex = 0; needIndex < needs.length; needIndex++) {
    const need = needs[needIndex];
    const needId = need.type === 'bloc_operatoire' && need.bloc_operation_id && need.besoin_operation_id
      ? `${need.site_id}_${need.date}_${need.periode}_bloc_${need.bloc_operation_id}_${need.besoin_operation_id}`
      : `${need.site_id}_${need.date}_${need.periode}`;
    
    const constraintName = `max_need_${needId}`;
    model.constraints[constraintName] = { max: need.nombre_max };
    
    // Add all variables for this specific need
    for (const varName of Object.keys(model.variables)) {
      if (varName.startsWith('assign_') && varName.endsWith(`_${needId}`)) {
        model.variables[varName][constraintName] = 1;
      }
    }
    
    if (needIndex < 5) {
      console.log(`  📊 Contrainte ${constraintName}: max ${need.nombre_max}`);
    }
  }
  
  // ============================================================
  // CONSTRAINT: Max total assignments per slot (site+date+periode)
  // ============================================================
  let constraintCount = 0;
  
  // Group needs by slot to create aggregated constraints
  const slotNeeds = new Map<string, SiteNeed[]>();
  for (const need of needs) {
    const slotKey = `${need.site_id}_${need.date}_${need.periode}`;
    if (!slotNeeds.has(slotKey)) {
      slotNeeds.set(slotKey, []);
    }
    slotNeeds.get(slotKey)!.push(need);
  }
  
  // Create one constraint per slot that limits TOTAL assignments
  for (const [slotKey, needsInSlot] of slotNeeds) {
    // Calculate max for this slot (should be the ceiling of sum of all needs)
    // But since each need is already a separate entity, we take the max of all nombre_max
    // For site needs: should be 1 need per slot, nombre_max is already correct
    // For bloc needs: multiple needs possible, sum their nombre_max
    const totalMax = needsInSlot.length === 1 
      ? needsInSlot[0].nombre_max 
      : Math.ceil(needsInSlot.reduce((sum, n) => sum + n.nombre_max, 0));
    
    const constraintName = `max_slot_${slotKey}`;
    model.constraints[constraintName] = { max: totalMax };
    constraintCount++;
    
    console.log(`  📊 Contrainte ${constraintName}: max ${totalMax} secrétaires (${needsInSlot.length} besoins)`);
    
    // Add ALL variables for this slot to this constraint
    // This includes both site needs and bloc needs (which have _bloc_ suffix)
    for (const varName of Object.keys(model.variables)) {
      if (!varName.startsWith('assign_')) continue;
      
      // Check if this variable is for this slot
      // Variables are named: assign_{secretaire_id}_{needId}
      // where needId is either {slotKey} or {slotKey}_bloc_{besoin_operation_id}
      if (varName.includes(slotKey)) {
        model.variables[varName][constraintName] = 1;
      }
    }
  }
  
  // ============================================================
  // CONSTRAINT: Max 1 assignment per secretary per half-day
  // ============================================================
  const secretairesByPeriode = new Map<string, string[]>();
  
  for (let needIndex = 0; needIndex < needs.length; needIndex++) {
    const need = needs[needIndex];
    const needId = need.type === 'bloc_operatoire' && need.bloc_operation_id && need.besoin_operation_id
      ? `${need.site_id}_${need.date}_${need.periode}_bloc_${need.bloc_operation_id}_${need.besoin_operation_id}`
      : `${need.site_id}_${need.date}_${need.periode}`;
    
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
    
    // Add coefficients to each variable for this constraint
    for (const varName of varNames) {
      if (model.variables[varName]) {
        model.variables[varName][constraintName] = 1;
      }
    }
    constraintCount++;
  }
  
  // ============================================================
  // CONSTRAINT: Closure sites = 2 full-day people
  // ============================================================
  const closureSites = week_data.sites.filter(s => s.fermeture);
  
  for (const site of closureSites) {
    const morningNeed = needs.find(
      n => n.site_id === site.id && n.date === date && n.periode === 'matin'
    );
    const afternoonNeed = needs.find(
      n => n.site_id === site.id && n.date === date && n.periode === 'apres_midi'
    );
    
    if (morningNeed && afternoonNeed && 
        morningNeed.medecins_ids.length > 0 && 
        afternoonNeed.medecins_ids.length > 0) {
      
      const fullDayVars: string[] = [];
      
      for (const cap of todayCapacites.filter(c => c.secretaire_id)) {
        const morningNeedId = morningNeed.type === 'bloc_operatoire' && morningNeed.bloc_operation_id && morningNeed.besoin_operation_id
          ? `${site.id}_${date}_matin_bloc_${morningNeed.bloc_operation_id}_${morningNeed.besoin_operation_id}`
          : `${site.id}_${date}_matin`;
        const afternoonNeedId = afternoonNeed.type === 'bloc_operatoire' && afternoonNeed.bloc_operation_id && afternoonNeed.besoin_operation_id
          ? `${site.id}_${date}_apres_midi_bloc_${afternoonNeed.bloc_operation_id}_${afternoonNeed.besoin_operation_id}`
          : `${site.id}_${date}_apres_midi`;
        
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
      
      // Constraint: sum of fullDayVar >= 2
      if (fullDayVars.length >= 2) {
        const closureConstraint = `closure_${site.id}_${date}`;
        model.constraints[closureConstraint] = { min: 2 };
        for (const fdVar of fullDayVars) {
          model.variables[fdVar][closureConstraint] = 1;
        }
        constraintCount++;
        console.log(`  📊 Contrainte ${closureConstraint}: >= 2 full-day`);
      }
    }
  }
  
  console.log(`\n✅ Modèle MILP construit:`);
  console.log(`  📊 Variables: ${Object.keys(model.variables).length}`);
  console.log(`  📊 Contraintes: ${Object.keys(model.constraints).length}`);
  console.log(`  📊 Variables binaires: ${Object.keys(model.binaries).length}`);
  
  // Afficher quelques exemples de variables avec leurs coefficients
  const varExamples = Object.entries(model.variables).slice(0, 5);
  console.log(`\n  🔍 Exemples de variables (5 premières):`);
  for (const [varName, coeffs] of varExamples) {
    const coeffsObj = coeffs as any;
    const constraintKeys = Object.keys(coeffsObj).filter(k => k !== 'score_total');
    console.log(`    ${varName}: score=${coeffsObj.score_total}, contraintes=[${constraintKeys.slice(0, 3).join(', ')}${constraintKeys.length > 3 ? '...' : ''}]`);
  }

  // Vérifier l'intégrité du modèle
  console.log(`\n🔍 Vérification de l'intégrité du modèle:`);
  let integrityOK = true;
  
  // Verify all binaries have variables
  for (const binVar of Object.keys(model.binaries)) {
    if (!model.variables[binVar]) {
      console.error(`  ❌ Variable binaire ${binVar} sans définition dans variables!`);
      integrityOK = false;
    }
  }
  
  // Verify all variables have binaries
  for (const varName of Object.keys(model.variables)) {
    if (!model.binaries[varName]) {
      console.error(`  ❌ Variable ${varName} sans déclaration binaire!`);
      integrityOK = false;
    }
  }
  
  if (integrityOK) {
    console.log(`  ✅ Toutes les variables sont correctement définies`);
  }

  console.log(`\n✅ Modèle MILP prêt pour résolution\n`);
  
  return model;
}
