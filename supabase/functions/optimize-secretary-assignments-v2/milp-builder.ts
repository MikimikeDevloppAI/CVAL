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
    
    // Check if secretary has REAL capacity (not just ADMIN fictive)
    const hasRealMatinCap = todayCapacites.some(
      c => c.secretaire_id === secretaire_id && 
           c.date === date && 
           c.demi_journee === 'matin' && 
           c.site_id !== ADMIN_SITE_ID
    );
    const hasRealAMCap = todayCapacites.some(
      c => c.secretaire_id === secretaire_id && 
           c.date === date && 
           c.demi_journee === 'apres_midi' && 
           c.site_id !== ADMIN_SITE_ID
    );

    // Check if secretary has ANY capacity (real or fictive)
    const hasAnyMatinCap = todayCapacites.some(
      c => c.secretaire_id === secretaire_id && c.date === date && c.demi_journee === 'matin'
    );
    const hasAnyAMCap = todayCapacites.some(
      c => c.secretaire_id === secretaire_id && c.date === date && c.demi_journee === 'apres_midi'
    );
    
    // Get eligible morning needs
    const eligibleMatin: (SiteNeed | null)[] = [];

    if (hasRealMatinCap) {
      // Has REAL capacity → add ADMIN + preferred sites
      eligibleMatin.push(null); // ADMIN
      for (const need of needsMatin) {
        if (need.site_id === ADMIN_SITE_ID) {
          eligibleMatin.push(need);
          continue;
        }
        
        // Check eligibility for real sites
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
    } else if (hasAnyMatinCap) {
      // Has ONLY fictive ADMIN capacity → add ADMIN only
      eligibleMatin.push(null);
    }
    // else: no capacity at all → eligibleMatin stays empty []
    
    // Get eligible afternoon needs
    const eligibleAM: (SiteNeed | null)[] = [];

    if (hasRealAMCap) {
      // Has REAL capacity → add ADMIN + preferred sites
      eligibleAM.push(null); // ADMIN
      for (const need of needsAM) {
        if (need.site_id === ADMIN_SITE_ID) {
          eligibleAM.push(need);
          continue;
        }
        
        // Check eligibility for real sites
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
    } else if (hasAnyAMCap) {
      // Has ONLY fictive ADMIN capacity → add ADMIN only
      eligibleAM.push(null);
    }
    // else: no capacity at all → eligibleAM stays empty []
    
    // Log for Lucie Vanni or debug mode
    if (DEBUG_VERBOSE || secretaire_id === '96d2c491-903b-40f8-8119-70c1c4a8193b') {
      console.log(`  👤 ${secretaire.name}: Matin=${hasRealMatinCap ? 'REAL' : hasAnyMatinCap ? 'ADMIN' : 'NO'}, AM=${hasRealAMCap ? 'REAL' : hasAnyAMCap ? 'ADMIN' : 'NO'} | ${eligibleMatin.length} matin × ${eligibleAM.length} AM = ${eligibleMatin.length * eligibleAM.length} combos`);
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
        
        // Add all combos (even with negative scores, let MILP decide)
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
        
        // Log top combos for Lucie Vanni
        if (secretaire_id === '96d2c491-903b-40f8-8119-70c1c4a8193b' && score > 50) {
          const mName = needM ? week_data.sites.find(s => s.id === needM.site_id)?.nom : 'null';
          const aName = needA ? week_data.sites.find(s => s.id === needA.site_id)?.nom : 'null';
          console.log(`    💎 Combo Lucie: ${mName} + ${aName} = ${score.toFixed(1)}`);
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
  // CONSTRAINT: Maximum capacity per SITE and HALF-DAY (aggregated for sites, specific for bloc)
  // ============================================================
  console.log(`\n🎯 Ajout des contraintes de capacité...`);
  
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
    
    let coveringCount = 0;
    for (const combo of combos) {
      if (combo.needMatin?.site_id === site_id && combo.needMatin?.type !== 'bloc_operatoire') {
        model.variables[combo.varName][constraintName] = 1;
        coveringCount++;
      }
    }
    
    const site = week_data.sites.find(s => s.id === site_id);
    const siteName = site?.nom || site_id.slice(0, 8);
    console.log(`  🌅 ${siteName} matin: max ${total_max} (${coveringCount} combos)`);
    
    if (siteName.includes('Angiologie')) {
      const lucieCount = combos.filter(c => 
        c.secretaire_id === '96d2c491-903b-40f8-8119-70c1c4a8193b' && 
        c.needMatin?.site_id === site_id && 
        c.needMatin?.type !== 'bloc_operatoire'
      ).length;
      console.log(`    💎 Lucie Vanni: ${lucieCount} combos couvrant Angiologie matin`);
    }
  }
  
  // Create constraints for afternoon site totals (aggregated by site)
  for (const [site_id, total_max] of afternoonTotals) {
    const constraintName = `site_cap_${site_id}_${date}_2`;
    model.constraints[constraintName] = { max: total_max };
    
    let coveringCount = 0;
    for (const combo of combos) {
      if (combo.needAM?.site_id === site_id && combo.needAM?.type !== 'bloc_operatoire') {
        model.variables[combo.varName][constraintName] = 1;
        coveringCount++;
      }
    }
    
    const site = week_data.sites.find(s => s.id === site_id);
    const siteName = site?.nom || site_id.slice(0, 8);
    console.log(`  🌇 ${siteName} AM: max ${total_max} (${coveringCount} combos)`);
  }
  
  // Create specific constraints for BLOC needs (by besoin_operation_id)
  for (const need of needsMatinBloc) {
    const needId = `${need.site_id}_${date}_1_${need.bloc_operation_id}_${need.besoin_operation_id}`;
    const constraintName = `max_cap_${needId}`;
    model.constraints[constraintName] = { max: need.nombre_max };
    
    let coveringCount = 0;
    for (const combo of combos) {
      if (combo.needMatin?.type === 'bloc_operatoire' &&
          combo.needMatin?.bloc_operation_id === need.bloc_operation_id &&
          combo.needMatin?.besoin_operation_id === need.besoin_operation_id) {
        model.variables[combo.varName][constraintName] = 1;
        coveringCount++;
      }
    }
    
    const besoinOp = week_data.besoins_operations.find(b => b.id === need.besoin_operation_id);
    console.log(`  🏥 Bloc ${besoinOp?.nom || 'unknown'} matin: max ${need.nombre_max} (${coveringCount} combos)`);
  }
  
  for (const need of needsAMBloc) {
    const needId = `${need.site_id}_${date}_2_${need.bloc_operation_id}_${need.besoin_operation_id}`;
    const constraintName = `max_cap_${needId}`;
    model.constraints[constraintName] = { max: need.nombre_max };
    
    let coveringCount = 0;
    for (const combo of combos) {
      if (combo.needAM?.type === 'bloc_operatoire' &&
          combo.needAM?.bloc_operation_id === need.bloc_operation_id &&
          combo.needAM?.besoin_operation_id === need.besoin_operation_id) {
        model.variables[combo.varName][constraintName] = 1;
        coveringCount++;
      }
    }
    
    const besoinOp = week_data.besoins_operations.find(b => b.id === need.besoin_operation_id);
    console.log(`  🏥 Bloc ${besoinOp?.nom || 'unknown'} AM: max ${need.nombre_max} (${coveringCount} combos)`);
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
  console.log(`  - Capacité max par site×demi-journée: ${morningTotals.size + afternoonTotals.size}`);
  console.log(`  - Sites de fermeture: ${closureSites.length}`);
  console.log(`  Combos: ${comboCount}`);
  
  return model;
}