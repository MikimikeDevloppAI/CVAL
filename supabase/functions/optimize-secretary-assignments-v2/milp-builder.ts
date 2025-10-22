import type {
  SiteNeed,
  CapaciteEffective,
  WeekData,
  AssignmentSummary
} from './types.ts';
import { ADMIN_SITE_ID, FORBIDDEN_SITES } from './types.ts';
import { calculateComboScore } from './score-calculator.ts';

const DEBUG_VERBOSE = false;

interface Combo {
  secretaire_id: string;
  needMatin: SiteNeed | null;
  needAM: SiteNeed | null;
  score: number;
  varName: string;
}

export function buildMILPModelSoft(
  date: string,
  needs: SiteNeed[],
  capacites: CapaciteEffective[],
  week_data: WeekData,
  week_assignments: AssignmentSummary[]
) {
  console.log(`\n🔧 Construction du modèle COMBO-BASED MILP pour ${date}...`);
  
  // Merge ADMIN needs with regular needs
  const adminNeedsForDate = week_data.admin_needs.filter((n: SiteNeed) => n.date === date);
  const allNeeds = [...needs, ...adminNeedsForDate];
  
  console.log(`  📊 Besoins sites/bloc: ${needs.length}, Besoins ADMIN: ${adminNeedsForDate.length}`);
  
  const todayCapacites = capacites.filter(c => c.date === date);
  const activeSecretaires = new Set(
    todayCapacites.filter(c => c.secretaire_id).map(c => c.secretaire_id!)
  );
  
  console.log(`  👥 Secrétaires actifs: ${activeSecretaires.size}`);
  
  // Separate needs by period
  const needsMatin = allNeeds.filter(n => n.periode === 'matin');
  const needsAM = allNeeds.filter(n => n.periode === 'apres_midi');
  
  console.log(`  🌅 Besoins matin: ${needsMatin.length}, 🌇 Besoins AM: ${needsAM.length}`);
  
  const model: any = {
    optimize: 'score_total',
    opType: 'max',
    constraints: {},
    variables: {},
    binaries: {}
  };
  
  const combos: Combo[] = [];
  let comboCount = 0;
  let excludedComboCount = 0;
  
  // ============================================================
  // GENERATE ALL COMBOS
  // ============================================================
  console.log(`\n📦 Génération des combos...`);
  
  for (const secretaire_id of activeSecretaires) {
    const secretaire = week_data.secretaires.find(s => s.id === secretaire_id);
    if (!secretaire) continue;
    
    // Get eligible morning needs
    const eligibleMatin: (SiteNeed | null)[] = [null]; // Always allow null (no assignment)
    for (const need of needsMatin) {
      if (need.site_id === ADMIN_SITE_ID) {
        eligibleMatin.push(need);
        continue;
      }
      
      // Check eligibility
      if (need.type === 'bloc_operatoire' && need.besoin_operation_id) {
        const hasCompetence = week_data.secretaires_besoins.some(
          sb => sb.secretaire_id === secretaire_id && 
                sb.besoin_operation_id === need.besoin_operation_id
        );
        if (hasCompetence) eligibleMatin.push(need);
      } else {
        const isEligible = week_data.secretaires_sites.some(
          ss => ss.secretaire_id === secretaire_id && ss.site_id === need.site_id
        );
        if (isEligible) eligibleMatin.push(need);
      }
    }
    
    // Get eligible afternoon needs
    const eligibleAM: (SiteNeed | null)[] = [null]; // Always allow null (no assignment)
    for (const need of needsAM) {
      if (need.site_id === ADMIN_SITE_ID) {
        eligibleAM.push(need);
        continue;
      }
      
      // Check eligibility
      if (need.type === 'bloc_operatoire' && need.besoin_operation_id) {
        const hasCompetence = week_data.secretaires_besoins.some(
          sb => sb.secretaire_id === secretaire_id && 
                sb.besoin_operation_id === need.besoin_operation_id
        );
        if (hasCompetence) eligibleAM.push(need);
      } else {
        const isEligible = week_data.secretaires_sites.some(
          ss => ss.secretaire_id === secretaire_id && ss.site_id === need.site_id
        );
        if (isEligible) eligibleAM.push(need);
      }
    }
    
    if (DEBUG_VERBOSE) {
      console.log(`  👤 ${secretaire.name}: ${eligibleMatin.length} matin × ${eligibleAM.length} AM = ${eligibleMatin.length * eligibleAM.length} combos`);
    }
    
    // Generate all combos (matin × AM)
    for (const needM of eligibleMatin) {
      for (const needA of eligibleAM) {
        // EXCLUSION: Bloc + Forbidden site (and vice versa)
        const isBlocMatin = needM?.type === 'bloc_operatoire';
        const isBlocAM = needA?.type === 'bloc_operatoire';
        const isForbiddenMatin = needM && FORBIDDEN_SITES.includes(needM.site_id);
        const isForbiddenAM = needA && FORBIDDEN_SITES.includes(needA.site_id);
        
        if ((isBlocMatin && isForbiddenAM) || (isForbiddenMatin && isBlocAM)) {
          excludedComboCount++;
          continue;
        }
        
        // Create need IDs
        const needMatinId = needM ? (
          needM.type === 'bloc_operatoire' && needM.bloc_operation_id && needM.besoin_operation_id
            ? `${needM.site_id}_${date}_1_${needM.bloc_operation_id}_${needM.besoin_operation_id}`
            : `${needM.site_id}_${date}_1`
        ) : 'null';
        
        const needAMId = needA ? (
          needA.type === 'bloc_operatoire' && needA.bloc_operation_id && needA.besoin_operation_id
            ? `${needA.site_id}_${date}_2_${needA.bloc_operation_id}_${needA.besoin_operation_id}`
            : `${needA.site_id}_${date}_2`
        ) : 'null';
        
        const varName = `combo_${secretaire_id}_${needMatinId}_${needAMId}`;
        
        // Calculate combo score
        const score = calculateComboScore(
          secretaire_id,
          needM,
          needA,
          week_assignments,
          {
            besoins: week_data.secretaires_besoins,
            medecins: week_data.secretaires_medecins,
            sites: week_data.secretaires_sites
          },
          secretaire
        );
        
        // Only add combo if score > 0
        if (score > 0) {
          combos.push({
            secretaire_id,
            needMatin: needM,
            needAM: needA,
            score,
            varName
          });
          
          model.variables[varName] = { score_total: score };
          model.binaries[varName] = 1;
          comboCount++;
        }
      }
    }
  }
  
  console.log(`  ✅ Combos générés: ${comboCount} (exclus: ${excludedComboCount})`);
  
  // ============================================================
  // CONSTRAINT: One combo per secretary per day
  // ============================================================
  console.log(`\n📋 Ajout des contraintes...`);
  
  for (const secretaire_id of activeSecretaires) {
    const secretaireCombos = combos.filter(c => c.secretaire_id === secretaire_id);
    
    if (secretaireCombos.length === 0) {
      console.warn(`  ⚠️ Aucun combo valide pour ${secretaire_id.slice(0, 8)}`);
      continue;
    }
    
    const constraintName = `one_combo_${secretaire_id}`;
    model.constraints[constraintName] = { equal: 1 };
    
    for (const combo of secretaireCombos) {
      model.variables[combo.varName][constraintName] = 1;
    }
    
    if (DEBUG_VERBOSE) {
      console.log(`  ✅ ${secretaire_id.slice(0, 8)}: 1 combo parmi ${secretaireCombos.length}`);
    }
  }
  
  // ============================================================
  // CONSTRAINT: Maximum capacity per need (no over-assignment)
  // ============================================================
  console.log(`\n🎯 Ajout des contraintes de capacité maximale...`);
  
  // For morning needs
  for (const need of needsMatin) {
    const needId = need.type === 'bloc_operatoire' && need.bloc_operation_id && need.besoin_operation_id
      ? `${need.site_id}_${date}_1_${need.bloc_operation_id}_${need.besoin_operation_id}`
      : `${need.site_id}_${date}_1`;
    
    const constraintName = `max_cap_${needId}`;
    model.constraints[constraintName] = { max: need.nombre_max };
    
    // Find all combos that cover this morning need
    for (const combo of combos) {
      if (combo.needMatin) {
        const comboNeedId = combo.needMatin.type === 'bloc_operatoire' && 
                            combo.needMatin.bloc_operation_id && 
                            combo.needMatin.besoin_operation_id
          ? `${combo.needMatin.site_id}_${date}_1_${combo.needMatin.bloc_operation_id}_${combo.needMatin.besoin_operation_id}`
          : `${combo.needMatin.site_id}_${date}_1`;
        
        if (comboNeedId === needId) {
          model.variables[combo.varName][constraintName] = 1;
        }
      }
    }
    
    if (DEBUG_VERBOSE) {
      const site = week_data.sites.find(s => s.id === need.site_id);
      const siteName = site?.nom || need.site_id.slice(0, 8);
      const coveringCombos = combos.filter(c => {
        if (!c.needMatin) return false;
        const comboNeedId = c.needMatin.type === 'bloc_operatoire' && 
                            c.needMatin.bloc_operation_id && 
                            c.needMatin.besoin_operation_id
          ? `${c.needMatin.site_id}_${date}_1_${c.needMatin.bloc_operation_id}_${c.needMatin.besoin_operation_id}`
          : `${c.needMatin.site_id}_${date}_1`;
        return comboNeedId === needId;
      });
      console.log(`  🌅 ${siteName} matin: max ${need.nombre_max} (${coveringCombos.length} combos possibles)`);
    }
  }
  
  // For afternoon needs
  for (const need of needsAM) {
    const needId = need.type === 'bloc_operatoire' && need.bloc_operation_id && need.besoin_operation_id
      ? `${need.site_id}_${date}_2_${need.bloc_operation_id}_${need.besoin_operation_id}`
      : `${need.site_id}_${date}_2`;
    
    const constraintName = `max_cap_${needId}`;
    model.constraints[constraintName] = { max: need.nombre_max };
    
    // Find all combos that cover this afternoon need
    for (const combo of combos) {
      if (combo.needAM) {
        const comboNeedId = combo.needAM.type === 'bloc_operatoire' && 
                            combo.needAM.bloc_operation_id && 
                            combo.needAM.besoin_operation_id
          ? `${combo.needAM.site_id}_${date}_2_${combo.needAM.bloc_operation_id}_${combo.needAM.besoin_operation_id}`
          : `${combo.needAM.site_id}_${date}_2`;
        
        if (comboNeedId === needId) {
          model.variables[combo.varName][constraintName] = 1;
        }
      }
    }
    
    if (DEBUG_VERBOSE) {
      const site = week_data.sites.find(s => s.id === need.site_id);
      const siteName = site?.nom || need.site_id.slice(0, 8);
      const coveringCombos = combos.filter(c => {
        if (!c.needAM) return false;
        const comboNeedId = c.needAM.type === 'bloc_operatoire' && 
                            c.needAM.bloc_operation_id && 
                            c.needAM.besoin_operation_id
          ? `${c.needAM.site_id}_${date}_2_${c.needAM.bloc_operation_id}_${c.needAM.besoin_operation_id}`
          : `${c.needAM.site_id}_${date}_2`;
        return comboNeedId === needId;
      });
      console.log(`  🌇 ${siteName} AM: max ${need.nombre_max} (${coveringCombos.length} combos possibles)`);
    }
  }
  
  // ============================================================
  // CONSTRAINT: Closure sites (at least 2 full-day assignments)
  // ============================================================
  const closureSites = week_data.sites.filter(s => s.fermeture);
  
  for (const site of closureSites) {
    const morningNeed = needsMatin.find(n => n.site_id === site.id);
    const afternoonNeed = needsAM.find(n => n.site_id === site.id);
    
    // Only enforce if both periods have medical needs
    if (morningNeed && afternoonNeed && 
        morningNeed.medecins_ids.length > 0 && 
        afternoonNeed.medecins_ids.length > 0) {
      
      const fullDayVars: string[] = [];
      
      // Find all combos that cover both periods for this site
      for (const combo of combos) {
        if (combo.needMatin?.site_id === site.id && 
            combo.needAM?.site_id === site.id) {
          const fullDayVar = `fullday_${combo.secretaire_id}_${site.id}_${date}`;
          
          if (!model.variables[fullDayVar]) {
            model.binaries[fullDayVar] = 1;
            model.variables[fullDayVar] = { score_total: 0 };
            
            // fullDayVar = 1 if this combo is selected
            const linkConstraint = `link_${fullDayVar}`;
            model.constraints[linkConstraint] = { equal: 0 };
            model.variables[fullDayVar][linkConstraint] = 1;
            model.variables[combo.varName][linkConstraint] = -1;
            
            fullDayVars.push(fullDayVar);
          }
        }
      }
      
      if (fullDayVars.length >= 2) {
        const closureConstraint = `closure_${site.id}_${date}`;
        model.constraints[closureConstraint] = { min: 2 };
        
        for (const fdVar of fullDayVars) {
          model.variables[fdVar][closureConstraint] = 1;
        }
        
        console.log(`  🔐 Site fermeture ${site.nom}: ${fullDayVars.length} journées complètes possibles (min: 2)`);
      } else {
        console.warn(`  ⚠️ Site fermeture ${site.nom}: Seulement ${fullDayVars.length} journées complètes possibles!`);
      }
    }
  }
  
  // ============================================================
  // STATS
  // ============================================================
  const constraintCount = Object.keys(model.constraints).length;
  const variableCount = Object.keys(model.variables).length;
  
  console.log(`\n📊 Modèle MILP:`);
  console.log(`  Variables: ${variableCount}`);
  console.log(`  Contraintes: ${constraintCount}`);
  console.log(`  - Une combo par secrétaire: ${activeSecretaires.size}`);
  console.log(`  - Capacité max par besoin: ${needsMatin.length + needsAM.length}`);
  console.log(`  - Sites de fermeture: ${closureSites.length}`);
  console.log(`  Combos: ${comboCount}`);
  
  return model;
}