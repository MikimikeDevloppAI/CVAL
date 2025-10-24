import type {
  SiteNeed,
  CapaciteEffective,
  WeekData,
  AssignmentSummary,
  CurrentState
} from './types.ts';
import { ADMIN_SITE_ID, FORBIDDEN_SITES } from './types.ts';
import { calculateComboScore } from './score-calculator.ts';

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
  week_assignments: AssignmentSummary[],
  currentState: Map<string, CurrentState>
) {
  console.log(`\n🔧 Construction du modèle COMBO-BASED MILP pour ${date}...`);
  
  // Merge ADMIN needs
  const adminNeedsForDate = week_data.admin_needs.filter((n: SiteNeed) => n.date === date);
  const allNeeds = [...needs, ...adminNeedsForDate];
  
  console.log(`🧮 Totaux besoins pour ${date}:`);
  console.log(`  Sites: ${needs.filter(n => n.type === 'site').length}`);
  console.log(`  Bloc: ${needs.filter(n => n.type === 'bloc_operatoire').length}`);
  console.log(`  Admin: ${adminNeedsForDate.length}`);
  
  const todayCapacites = capacites.filter(c => c.date === date && c.actif);
  const activeSecretaires = new Set(
    todayCapacites.filter(c => c.secretaire_id).map(c => c.secretaire_id!)
  );
  
  // Separate needs by period
  const needsMatin = allNeeds.filter(n => n.periode === 'matin');
  const needsAM = allNeeds.filter(n => n.periode === 'apres_midi');
  
  const model: any = {
    optimize: 'score_total',
    opType: 'max',
    constraints: {},
    variables: {},
    binaries: {}
  };
  
  const combos: Combo[] = [];
  
  // ==================================================================
  // GENERATE ALL COMBOS
  // ==================================================================
  for (const secretaire_id of activeSecretaires) {
    const secretaire = week_data.secretaires.find(s => s.id === secretaire_id);
    if (!secretaire) continue;
    
    // Check capacity for morning and afternoon
    const hasMatinCap = todayCapacites.some(
      c => c.secretaire_id === secretaire_id && c.date === date && c.demi_journee === 'matin'
    );
    const hasAMCap = todayCapacites.some(
      c => c.secretaire_id === secretaire_id && c.date === date && c.demi_journee === 'apres_midi'
    );
    
    // Get eligible morning needs
    const eligibleMatin: (SiteNeed | null)[] = [];
    
    if (hasMatinCap) {
      // Has morning capacity → add ADMIN + eligible sites
      eligibleMatin.push(null); // ADMIN
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
    } else if (hasAMCap) {
      // NO morning capacity but HAS afternoon → force ADMIN for morning
      eligibleMatin.push(null);
    }
    // else: no capacity at all → eligibleMatin stays []
    
    // Get eligible afternoon needs
    const eligibleAM: (SiteNeed | null)[] = [];
    
    if (hasAMCap) {
      // Has afternoon capacity → add ADMIN + eligible sites
      eligibleAM.push(null); // ADMIN
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
    } else if (hasMatinCap) {
      // NO afternoon capacity but HAS morning → force ADMIN for afternoon
      eligibleAM.push(null);
    }
    // else: no capacity at all → eligibleAM stays []
    
    // Generate all combos (matin × AM)
    for (const needM of eligibleMatin) {
      for (const needA of eligibleAM) {
        // EXCLUSION: Bloc + Forbidden site (and vice versa)
        const isBlocMatin = needM?.type === 'bloc_operatoire';
        const isBlocAM = needA?.type === 'bloc_operatoire';
        const isForbiddenMatin = needM && FORBIDDEN_SITES.includes(needM.site_id);
        const isForbiddenAM = needA && FORBIDDEN_SITES.includes(needA.site_id);
        
        if ((isBlocMatin && isForbiddenAM) || (isForbiddenMatin && isBlocAM)) {
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
        
        // Calculate combo score with current state bonus
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
          secretaire,
          currentState  // ← Pass currentState for +30 bonus
        );
        
        combos.push({
          secretaire_id,
          needMatin: needM,
          needAM: needA,
          score,
          varName
        });
        
        model.variables[varName] = { score_total: score };
        model.binaries[varName] = 1;
      }
    }
  }
  
  console.log(`  ✅ Combos générés: ${combos.length}`);
  
  // ==================================================================
  // CONSTRAINT: One combo per secretary per day
  // ==================================================================
  for (const secretaire_id of activeSecretaires) {
    const secretaireCombos = combos.filter(c => c.secretaire_id === secretaire_id);
    
    if (secretaireCombos.length === 0) continue;
    
    const constraintName = `one_combo_${secretaire_id}`;
    model.constraints[constraintName] = { equal: 1 };
    
    for (const combo of secretaireCombos) {
      model.variables[combo.varName][constraintName] = 1;
    }
  }
  
  // ==================================================================
  // CONSTRAINT: Maximum capacity per SITE and HALF-DAY
  // ==================================================================
  // Separate site needs from bloc needs
  const needsMatinSite = needsMatin.filter(n => n.type !== 'bloc_operatoire');
  const needsMatinBloc = needsMatin.filter(n => n.type === 'bloc_operatoire');
  const needsAMSite = needsAM.filter(n => n.type !== 'bloc_operatoire');
  const needsAMBloc = needsAM.filter(n => n.type === 'bloc_operatoire');
  
  // Aggregate morning site needs by site_id
  const morningTotals = new Map<string, number>();
  for (const need of needsMatinSite) {
    const current = morningTotals.get(need.site_id) || 0;
    morningTotals.set(need.site_id, current + need.nombre_max);
  }

  // Aggregate afternoon site needs by site_id
  const afternoonTotals = new Map<string, number>();
  for (const need of needsAMSite) {
    const current = afternoonTotals.get(need.site_id) || 0;
    afternoonTotals.set(need.site_id, current + need.nombre_max);
  }
  
  // Create constraints for morning site totals (aggregated by site)
  for (const [site_id, total_max] of morningTotals) {
    const constraintName = `site_cap_${site_id}_${date}_1`;
    model.constraints[constraintName] = { max: total_max };
    
    for (const combo of combos) {
      if (combo.needMatin?.site_id === site_id && combo.needMatin?.type !== 'bloc_operatoire') {
        model.variables[combo.varName][constraintName] = 1;
      }
    }
  }
  
  // Create constraints for afternoon site totals (aggregated by site)
  for (const [site_id, total_max] of afternoonTotals) {
    const constraintName = `site_cap_${site_id}_${date}_2`;
    model.constraints[constraintName] = { max: total_max };
    
    for (const combo of combos) {
      if (combo.needAM?.site_id === site_id && combo.needAM?.type !== 'bloc_operatoire') {
        model.variables[combo.varName][constraintName] = 1;
      }
    }
  }
  
  // Create specific constraints for BLOC needs (by besoin_operation_id)
  for (const need of needsMatinBloc) {
    const needId = `${need.site_id}_${date}_1_${need.bloc_operation_id}_${need.besoin_operation_id}`;
    const constraintName = `max_cap_${needId}`;
    model.constraints[constraintName] = { max: need.nombre_max };
    
    for (const combo of combos) {
      if (combo.needMatin?.type === 'bloc_operatoire' &&
          combo.needMatin?.bloc_operation_id === need.bloc_operation_id &&
          combo.needMatin?.besoin_operation_id === need.besoin_operation_id) {
        model.variables[combo.varName][constraintName] = 1;
      }
    }
  }
  
  for (const need of needsAMBloc) {
    const needId = `${need.site_id}_${date}_2_${need.bloc_operation_id}_${need.besoin_operation_id}`;
    const constraintName = `max_cap_${needId}`;
    model.constraints[constraintName] = { max: need.nombre_max };
    
    for (const combo of combos) {
      if (combo.needAM?.type === 'bloc_operatoire' &&
          combo.needAM?.bloc_operation_id === need.bloc_operation_id &&
          combo.needAM?.besoin_operation_id === need.besoin_operation_id) {
        model.variables[combo.varName][constraintName] = 1;
      }
    }
  }
  
  // ==================================================================
  // CONSTRAINT: Closure sites (at least 2 full-day assignments)
  // ==================================================================
  const closureSites = week_data.sites.filter(s => s.fermeture);
  
  console.log(`\n🔒 Contraintes de fermeture:`);
  
  for (const site of closureSites) {
    const morningNeed = needsMatinSite.find(n => n.site_id === site.id);
    const afternoonNeed = needsAMSite.find(n => n.site_id === site.id);
    
    // Only enforce if both periods have needs
    if (morningNeed && afternoonNeed && 
        morningNeed.nombre_max > 0 && afternoonNeed.nombre_max > 0) {
      
      const fullDayComboVars: string[] = [];
      
      // Find all combos that cover BOTH periods for this site (not admin)
      for (const combo of combos) {
        if (combo.needMatin?.site_id === site.id && 
            combo.needMatin?.type === 'site' &&
            combo.needAM?.site_id === site.id &&
            combo.needAM?.type === 'site') {
          fullDayComboVars.push(combo.varName);
        }
      }
      
      console.log(`  ${site.nom}: ${fullDayComboVars.length} combos journée complète disponibles`);
      
      // Always require 2 full-day assignments (no residual calculation)
      if (fullDayComboVars.length >= 2) {
        const closureConstraint = `closure_${site.id}_${date}`;
        model.constraints[closureConstraint] = { min: 2 };
        
        for (const comboVar of fullDayComboVars) {
          model.variables[comboVar][closureConstraint] = 1;
        }
        
        console.log(`    ✅ Contrainte ajoutée: min 2 journées complètes`);
      } else {
        console.log(`    ⚠️ Pas assez de combos (${fullDayComboVars.length}) pour satisfaire min 2`);
      }
    }
  }
  
  console.log(`📊 Modèle: ${Object.keys(model.variables).length} variables, ${Object.keys(model.constraints).length} contraintes`);
  
  return { model, combos };
}
