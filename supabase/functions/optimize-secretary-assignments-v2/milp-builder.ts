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
  
  // 🔍 DIAGNOSTIC: Répartition des capacités du jour
  const todayCapacites = capacites.filter(c => c.date === date);
  const capByPeriod = { matin: 0, apres_midi: 0 };
  const capBySite: Record<string, number> = {};
  const capExamples: string[] = [];
  
  todayCapacites.forEach((c, idx) => {
    if (c.secretaire_id) {
      capByPeriod[c.demi_journee as keyof typeof capByPeriod]++;
      const siteKey = c.site_id?.slice(0,8) || 'unknown';
      capBySite[siteKey] = (capBySite[siteKey] || 0) + 1;
      if (idx < 5) {
        capExamples.push(`${c.secretaire_id.slice(0,8)}_${c.demi_journee}_${c.site_id?.slice(0,8)}`);
      }
    }
  });
  
  console.log('\n  📊 DIAGNOSTIC CAPACITÉS DU JOUR (avec secretaire_id):');
  console.log(`     Total: ${todayCapacites.filter(c => c.secretaire_id).length}`);
  console.log(`     Matin: ${capByPeriod.matin}, Après-midi: ${capByPeriod.apres_midi}`);
  console.log(`     Top 5 sites:`, Object.entries(capBySite).slice(0, 5).map(([s,n]) => `${s}:${n}`).join(', '));
  console.log(`     Exemples (5 premières):`, capExamples);
  
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
  
  for (let needIndex = 0; needIndex < needs.length; needIndex++) {
    console.log(`\n🔵 DÉBUT traitement besoin [${needIndex + 1}/${needs.length}]...`);
    
    try {
      const need = needs[needIndex];
      // Create unique need ID with numeric period code (1=matin, 2=apres_midi)
      const periodCode = need.periode === 'matin' ? '1' : '2';
      const needId = need.type === 'bloc_operatoire' && need.bloc_operation_id && need.besoin_operation_id
        ? `${need.site_id}_${need.date}_${periodCode}_bloc_${need.bloc_operation_id}_${need.besoin_operation_id}`
        : `${need.site_id}_${need.date}_${periodCode}`;
      
      // 🔍 LOG DÉTAILLÉ POUR CHAQUE BESOIN
      console.log(`\n  📋 Besoin [${needIndex + 1}/${needs.length}]:`, {
      type: need.type,
      site_id: need.site_id?.slice(0, 8),
      periode: need.periode,
      nombre_max: need.nombre_max,
      bloc_operation_id: need.bloc_operation_id?.slice(0, 8),
      besoin_operation_id: need.besoin_operation_id?.slice(0, 8)
    });
    
    // 📊 Comptage des capacités disponibles pour cette période
    const periodCaps = todayCapacites.filter(c => 
      c.secretaire_id && c.demi_journee === need.periode
    );
    console.log(`    📌 Capacités période ${need.periode}: ${periodCaps.length}`);
    
    // 🎓 Pour les besoins BLOC: comptage des secrétaires compétentes
    if (need.type === 'bloc_operatoire' && need.besoin_operation_id) {
      const competents = new Set(
        week_data.secretaires_besoins
          .filter((sb: any) => sb.besoin_operation_id === need.besoin_operation_id)
          .map((sb: any) => sb.secretaire_id)
      );
      const eligibleByCompetence = periodCaps.filter(c => competents.has(c.secretaire_id));
      console.log(`    🎓 Compétences pour besoin_op ${need.besoin_operation_id?.slice(0,8)}:`);
      console.log(`       - Total compétents (toutes périodes): ${competents.size}`);
      console.log(`       - Éligibles ce jour (période ${need.periode}): ${eligibleByCompetence.length}`);
      console.log(`       - Exemples compétents:`, Array.from(competents).slice(0, 3).map((id: any) => id.slice(0,8)));
    } else if (need.type === 'site') {
      // 🏢 Pour les besoins SITE: comptage des secrétaires membres du site
      const siteMembersInPeriod = periodCaps.filter(c => 
        week_data.secretaires_sites.some((ss: any) => 
          ss.secretaire_id === c.secretaire_id && ss.site_id === need.site_id
        )
      );
      console.log(`    🏢 Membres du site ${need.site_id?.slice(0,8)}:`);
      console.log(`       - Éligibles ce jour (période ${need.periode}): ${siteMembersInPeriod.length}`);
      if (siteMembersInPeriod.length > 0) {
        console.log(`       - Exemples:`, siteMembersInPeriod.slice(0, 3).map(c => c.secretaire_id?.slice(0,8)));
      }
    }
    
    let testedCount = 0;
    let rejectedNoCompetence = 0;
    let rejectedNotEligible = 0;
    let acceptedCount = 0;
    
    for (const cap of todayCapacites) {
      if (!cap.secretaire_id) {
        if (testedCount === 0) console.log(`    ⚠️ Capacité sans secretaire_id`);
        continue;
      }
      if (cap.demi_journee !== need.periode) continue;
      
      testedCount++;
      
      // LOG ELIGIBILITE pour les 3 premières secrétaires testées
      if (testedCount <= 3) {
        console.log(`    🔍 Test secrétaire ${cap.secretaire_id.slice(0,8)}... (cap.site=${cap.site_id?.slice(0,8)}..., need.type=${need.type})`);
      }
      
      // Check eligibility
      const isAdminSite = need.site_id === ADMIN_SITE_ID;
      
      if (!isAdminSite) {
        // For bloc: ONLY check competence (secretaires_besoins)
        // No need to check site membership for bloc
        if (need.type === 'bloc_operatoire' && need.besoin_operation_id) {
          // Check if secretary has competence for this besoin_operation
          const hasCompetence = week_data.secretaires_besoins.some(
            (sb: any) => sb.secretaire_id === cap.secretaire_id && 
                  sb.besoin_operation_id === need.besoin_operation_id
          );
          if (!hasCompetence) {
            rejectedNoCompetence++;
            if (rejectedNoCompetence <= 3) {
              console.log(`    ❌ BLOC rejeté: Secrétaire ${cap.secretaire_id.slice(0,8)}... pas de compétence pour besoin_op ${need.besoin_operation_id?.slice(0,8)}...`);
              console.log(`       (${week_data.secretaires_besoins.length} compétences chargées au total)`);
            }
            continue;
          } else if (testedCount <= 3) {
            console.log(`    ✅ BLOC accepté: Secrétaire ${cap.secretaire_id.slice(0,8)}... a la compétence`);
          }
        } else {
          // For regular site needs: check site membership
          const isEligible = week_data.secretaires_sites.some(
            ss => ss.secretaire_id === cap.secretaire_id && ss.site_id === need.site_id
          );
          if (!isEligible) {
            rejectedNotEligible++;
            if (testedCount <= 3) {
              console.log(`    ❌ SITE rejeté: Secrétaire ${cap.secretaire_id.slice(0,8)}... non membre du site`);
            }
            continue;
          } else if (testedCount <= 3) {
            console.log(`    ✅ SITE accepté: Secrétaire ${cap.secretaire_id.slice(0,8)}... membre du site`);
          }
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
      acceptedCount++;
      
      if (need.type === 'bloc_operatoire') {
        blocVariableCount++;
        if (blocVariableCount <= 5) {
          console.log(`    ✅ Variable BLOC ${varName} créée avec score: ${score.toFixed(2)}`);
        }
      }
      
      if (variableCount <= 10 && need.type !== 'bloc_operatoire') {
        console.log(`    ✅ Variable ${varName} créée avec score: ${score.toFixed(2)}`);
      }
    }
    
      // 📊 RÉSUMÉ APRÈS CHAQUE BESOIN
      const needIdShort = needId.slice(0, 35);
      console.log(`\n  ✅ Résumé besoin ${needIdShort}...`);
      console.log(`     Type: ${need.type}, Période: ${need.periode}`);
      console.log(`     Testés: ${testedCount}, Rejetés site: ${rejectedNotEligible}, Rejetés compétence: ${rejectedNoCompetence}, Acceptés: ${acceptedCount}`);
      if (need.type === 'bloc_operatoire') {
        console.log(`     🏥 BLOC: ${acceptedCount} variables créées pour ce besoin opératoire`);
      }
      
      console.log(`\n✅ FIN traitement besoin [${needIndex + 1}/${needs.length}]: ${acceptedCount} variables créées`);
      
    } catch (error) {
      const err = error as Error;
      console.error(`\n❌ ERREUR lors du traitement du besoin [${needIndex + 1}/${needs.length}]:`);
      console.error(`   Type: ${err.name}`);
      console.error(`   Message: ${err.message}`);
      console.error(`   Stack: ${err.stack}`);
      
      // Log du besoin qui a causé l'erreur
      const failedNeed = needs[needIndex];
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
  
  if (variableCount > 10) {
    console.log(`    ... et ${variableCount - 10} autres variables créées`);
  }
  console.log(`  🏥 Variables BLOC: ${blocVariableCount}`);
  
  // Log examples of BLOC variables
  if (blocVariableCount > 0) {
    const blocVarExamples = Object.keys(model.variables)
      .filter(v => v.includes('_bloc_'))
      .slice(0, 3);
    console.log(`  📋 Exemples de variables BLOC:`);
    blocVarExamples.forEach((v, i) => console.log(`    [${i+1}] ${v}`));
  }
  
  // ============================================================
  // CONSTRAINT: Max per individual need
  // ============================================================
  console.log(`\n📏 Contraintes par besoin individuel...`);
  for (let needIndex = 0; needIndex < needs.length; needIndex++) {
    const need = needs[needIndex];
    const periodCode = need.periode === 'matin' ? '1' : '2';
    const needId = need.type === 'bloc_operatoire' && need.bloc_operation_id && need.besoin_operation_id
      ? `${need.site_id}_${need.date}_${periodCode}_bloc_${need.bloc_operation_id}_${need.besoin_operation_id}`
      : `${need.site_id}_${need.date}_${periodCode}`;
    
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
    const periodCode = need.periode === 'matin' ? '1' : '2';
    const needId = need.type === 'bloc_operatoire' && need.bloc_operation_id && need.besoin_operation_id
      ? `${need.site_id}_${need.date}_${periodCode}_bloc_${need.bloc_operation_id}_${need.besoin_operation_id}`
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
          ? `${site.id}_${date}_1_bloc_${morningNeed.bloc_operation_id}_${morningNeed.besoin_operation_id}`
          : `${site.id}_${date}_1`;
        const afternoonNeedId = afternoonNeed.type === 'bloc_operatoire' && afternoonNeed.bloc_operation_id && afternoonNeed.besoin_operation_id
          ? `${site.id}_${date}_2_bloc_${afternoonNeed.bloc_operation_id}_${afternoonNeed.besoin_operation_id}`
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
