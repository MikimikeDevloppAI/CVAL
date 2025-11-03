import type {
  SiteNeed,
  CapaciteEffective,
  WeekData,
  DynamicContext
} from './types.ts';
import { 
  ADMIN_SITE_ID, 
  FORBIDDEN_SITES, 
  GASTRO_TYPE_INTERVENTION_ID, 
  VIEILLE_VILLE_SITE_ID,
  ESPLANADE_OPHTALMOLOGIE_SITE_ID,
  SALLE_ROUGE_ID,
  SALLE_VERTE_ID,
  SALLE_JAUNE_ID,
  SALLE_GASTRO_ID,
  SALLES_STANDARD
} from './types.ts';
import { calculateComboScore } from './score-calculator.ts';
import { logger } from './index.ts';

const DEBUG_VERBOSE = false;
const LUCIE_PRATILLO_ID = '5d3af9e3-674b-48d6-b54f-bd84c9eee670';

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
  context: DynamicContext
) {
  logger.info(`\n🔧 Construction du modèle MILP pour ${date}`);
  
  const adminNeedsForDate = week_data.admin_needs.filter((n: SiteNeed) => n.date === date);
  const allNeeds = [...needs, ...adminNeedsForDate];
  
  logger.debug(`  📊 Besoins sites/bloc: ${needs.length}, Besoins ADMIN: ${adminNeedsForDate.length}`);
  
  const todayCapacites = capacites.filter(c => c.date === date);
  const activeSecretaires = new Set(
    todayCapacites.filter(c => c.secretaire_id).map(c => c.secretaire_id!)
  );
  
  logger.info(`  👥 Secrétaires: ${activeSecretaires.size}, Besoins: ${allNeeds.length}`);
  
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
  let comboCount = 0;
  let excludedComboCount = 0;
  
  // ============================================================
  // GENERATE ALL COMBOS
  // ============================================================
  
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
    
    if (logger.isFocused(secretaire_id, date)) {
      const status = hasMatinCap && hasAMCap ? 'FULL' : 
                     hasMatinCap ? 'MATIN_ONLY' : 
                     hasAMCap ? 'AM_ONLY' : 'NONE';
      logger.info(`  👤 ${secretaire.name} [${status}]: ${eligibleMatin.length} matin × ${eligibleAM.length} AM combos`);
    }
    
    // Generate all combos (matin × AM)
    for (const needM of eligibleMatin) {
      for (const needA of eligibleAM) {
        // ============================================================
        // EXCLUSION: Règles basées sur les SALLES
        // ============================================================
        const isBlocMatin = needM?.type === 'bloc_operatoire';
        const isBlocAM = needA?.type === 'bloc_operatoire';
        const isForbiddenMatin = needM && FORBIDDEN_SITES.includes(needM.site_id);
        const isForbiddenAM = needA && FORBIDDEN_SITES.includes(needA.site_id);
        
        // Déterminer le type de salle
        const salleMatin = needM?.salle_assignee;
        const salleAM = needA?.salle_assignee;
        
        const isSalleStandardMatin = salleMatin && SALLES_STANDARD.includes(salleMatin);
        const isSalleStandardAM = salleAM && SALLES_STANDARD.includes(salleAM);
        // Détection robuste avec fallback sur type_intervention_id si salle non assignée
        const isSalleGastroMatin = salleMatin ? (salleMatin === SALLE_GASTRO_ID) : (needM?.type === 'bloc_operatoire' && needM?.type_intervention_id === GASTRO_TYPE_INTERVENTION_ID);
        const isSalleGastroAM = salleAM ? (salleAM === SALLE_GASTRO_ID) : (needA?.type === 'bloc_operatoire' && needA?.type_intervention_id === GASTRO_TYPE_INTERVENTION_ID);
        
        // ============================================================
        // RÈGLE 1: Salles standard (Rouge, Verte, Jaune)
        // → Exclusion avec Centre Esplanade ET Vieille Ville
        // ============================================================
        if (isSalleStandardMatin && isForbiddenAM) {
          excludedComboCount++;
          continue;
        }
        if (isForbiddenMatin && isSalleStandardAM) {
          excludedComboCount++;
          continue;
        }
        
        // ============================================================
        // RÈGLE 2: Salle Gastro
        // → Exclusion UNIQUEMENT avec Centre Esplanade
        // → Autorisé avec Vieille Ville, Admin, et autre Gastro
        // ============================================================
        const isEsplanadeMatin = needM?.site_id === ESPLANADE_OPHTALMOLOGIE_SITE_ID;
        const isEsplanadeAM = needA?.site_id === ESPLANADE_OPHTALMOLOGIE_SITE_ID;
        
        if (isSalleGastroMatin && isEsplanadeAM) {
          excludedComboCount++;
          continue;
        }
        if (isEsplanadeMatin && isSalleGastroAM) {
          excludedComboCount++;
          continue;
        }
        
        // ============================================================
        // RÈGLE 3: Gastro + Gastro = toujours autorisé
        // ============================================================
        // (Pas besoin d'exclusion, déjà géré par les règles ci-dessus)
        
        // ============================================================
        // RÈGLE 4: Gastro + autre type d'opération (autre salle) = interdit
        // ============================================================
        if (isSalleGastroMatin && needA?.type === 'bloc_operatoire' && !isSalleGastroAM) {
          excludedComboCount++;
          continue;
        }
        if (isSalleGastroAM && needM?.type === 'bloc_operatoire' && !isSalleGastroMatin) {
          excludedComboCount++;
          continue;
        }
        
        // ============================================================
        // RÈGLE 5: Gastro + autre site (hors Admin et Vieille Ville) = interdit
        // ============================================================
        const isVieilleVilleMatin = needM?.site_id === VIEILLE_VILLE_SITE_ID;
        const isVieilleVilleAM = needA?.site_id === VIEILLE_VILLE_SITE_ID;
        
        // Ne pas exclure Gastro + Gastro (même si sites différents)
        if (isSalleGastroMatin && needA && needA.site_id !== ADMIN_SITE_ID && !isVieilleVilleAM && !isSalleGastroAM) {
          console.log(`[RÈGLE 5] Exclusion: Gastro matin + autre site PM pour ${secretaire.id}, site AM: ${needA.site_id}, salle AM: ${salleAM || 'non assignée'}`);
          excludedComboCount++;
          continue;
        }
        if (isSalleGastroAM && needM && needM.site_id !== ADMIN_SITE_ID && !isVieilleVilleMatin && !isSalleGastroMatin) {
          console.log(`[RÈGLE 5] Exclusion: Gastro après-midi + autre site matin pour ${secretaire.id}, site matin: ${needM.site_id}, salle matin: ${salleMatin || 'non assignée'}`);
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
          context,
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
        
        // Log combos for focused secretaries
        if (logger.isFocused(secretaire_id, date)) {
          const mName = needM ? week_data.sites.find(s => s.id === needM.site_id)?.nom : 'ADMIN';
          const aName = needA ? week_data.sites.find(s => s.id === needA.site_id)?.nom : 'ADMIN';
          logger.info(`    💎 Combo ${secretaire.name}: ${mName} + ${aName} = ${score.toFixed(1)}`);
        }
      }
    }
  }
  
  logger.info(`  ✅ Combos: ${comboCount} (exclus: ${excludedComboCount})`);
  
  // ============================================================
  // CONSTRAINT: One combo per secretary per day
  // ============================================================
  
  for (const secretaire_id of activeSecretaires) {
    const secretaireCombos = combos.filter(c => c.secretaire_id === secretaire_id);
    
    if (secretaireCombos.length === 0) {
      logger.debug(`  ⚠️ Aucun combo valide pour ${secretaire_id.slice(0, 8)}`);
      continue;
    }
    
    const constraintName = `one_combo_${secretaire_id}`;
    model.constraints[constraintName] = { equal: 1 };
    
    for (const combo of secretaireCombos) {
      model.variables[combo.varName][constraintName] = 1;
    }
  }
  
  // ============================================================
  // CONSTRAINT: Maximum capacity per SITE and HALF-DAY (aggregated for sites, specific for bloc)
  // ============================================================
  
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
    logger.debug(`  🌅 ${siteName} matin: max ${total_max} (${coveringCount} combos)`);
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
    logger.debug(`  🌇 ${siteName} AM: max ${total_max} (${coveringCount} combos)`);
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
    logger.debug(`  🏥 Bloc ${besoinOp?.nom || 'unknown'} matin: max ${need.nombre_max} (${coveringCount} combos)`);
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
    logger.debug(`  🏥 Bloc ${besoinOp?.nom || 'unknown'} AM: max ${need.nombre_max} (${coveringCount} combos)`);
  }
  
  // ============================================================
  // CONSTRAINT: Closure sites WITH 1R/2F/3F ROLES
  // ============================================================
  const closureSites = week_data.sites.filter((s: any) => s.fermeture);
  
  for (const site of closureSites) {
    const morningNeed = needsMatin.find(n => n.site_id === site.id);
    const afternoonNeed = needsAM.find(n => n.site_id === site.id);
    
    const hasMorning = morningNeed && morningNeed.medecins_ids.length > 0;
    const hasAfternoon = afternoonNeed && afternoonNeed.medecins_ids.length > 0;
    
    // CAS C: Journée complète (both morning AND afternoon needs) - logique actuelle conservée
    if (hasMorning && hasAfternoon) {
      const fullDayVars: string[] = [];
      const roleVars = {
        is_1r: [] as Array<{ secId: string, varName: string, comboVar: string }>,
        is_2f3f: [] as Array<{ secId: string, varName: string, comboVar: string, needs3F: boolean }>
      };
      
      // Detect if this site needs 3F
      const needs3F = context.sites_needing_3f.get(date)?.has(site.id) || false;
      
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
            
            // Create role variables for 1R and 2F/3F
            const var1R = `role_1r_${combo.secretaire_id}_${site.id}_${date}`;
            const var2F3F = `role_2f3f_${combo.secretaire_id}_${site.id}_${date}`;
            
            model.binaries[var1R] = 1;
            model.binaries[var2F3F] = 1;
            
            // Calculate penalty for this role based on current counters
            const count1R = context.closing_1r_counters.get(combo.secretaire_id) || 0;
            const count2F3F = context.closing_2f3f_counters.get(combo.secretaire_id) || 0;
            const totalClosing = count1R + count2F3F;
            
            let penalty1R = 0;
            let penalty2F3F = 0;
            
            // Pénalité 2F/3F: dès la 2e fois dans la semaine
            if (count2F3F >= 1) {
              penalty2F3F -= 250;
            }
            
            // Pénalité totale: dès le 3e rôle de fermeture (1R+2F/3F)
            if (totalClosing >= 2) {
              penalty1R -= 250;
              penalty2F3F -= 250;
            }
            
            // Escalade: pénalité supplémentaire à partir du 4e rôle
            if (totalClosing >= 3) {
              penalty1R -= 200;
              penalty2F3F -= 200;
            }
            
            // Escalade: pénalité encore plus forte à partir du 5e rôle
            if (totalClosing >= 4) {
              penalty1R -= 200;
              penalty2F3F -= 200;
            }
            
            // Règle Florence Bron mardi
            const d = new Date(date);
            const isTuesday = d.getDay() === 2;
            const FLORENCE_BRON_ID = '1e5339aa-5e82-4295-b918-e15a580b3396';
            if (isTuesday && combo.secretaire_id === FLORENCE_BRON_ID) {
              penalty2F3F -= 500; // Très forte pénalité
            }
            
            // EXCLUSION: Lucie Pratillo ne peut JAMAIS être 2F/3F
            if (combo.secretaire_id === LUCIE_PRATILLO_ID) {
              penalty2F3F -= 10000; // Pénalité extrême pour rendre la solution infaisable
            }
            
            // Debug logs pour secrétaires ciblées
            const sec = week_data.secretaires.find((s: any) => s.id === combo.secretaire_id);
            const secName = sec?.name || combo.secretaire_id.substring(0, 8);
            const focusNames = ['Christine Ribeaud', 'Mirlanda Hasani', 'Loïs'];
            if (focusNames.some(fn => secName.includes(fn.split(' ')[0]))) {
              logger.info(`  🎯 ${secName} | Site: ${site.nom} | 1R=${count1R} | 2F/3F=${count2F3F} | Total=${totalClosing} | Penalty1R=${penalty1R} | Penalty2F3F=${penalty2F3F} | ComboScore=${combo.score}`);
            }
            
            model.variables[var1R] = { score_total: penalty1R };
            model.variables[var2F3F] = { score_total: penalty2F3F };
            
            roleVars.is_1r.push({ secId: combo.secretaire_id, varName: var1R, comboVar: combo.varName });
            roleVars.is_2f3f.push({ secId: combo.secretaire_id, varName: var2F3F, comboVar: combo.varName, needs3F });
          }
        }
      }
      
      if (fullDayVars.length >= 2) {
        const closureConstraint = `closure_${site.id}_${date}`;
        model.constraints[closureConstraint] = { min: 2 };
        
        for (const fdVar of fullDayVars) {
          model.variables[fdVar][closureConstraint] = 1;
        }
        
        // Contrainte: Exactement 1 personne en 1R
        const constraint1R = `closure_1r_${site.id}_${date}`;
        model.constraints[constraint1R] = { equal: 1 };
        for (const { varName } of roleVars.is_1r) {
          model.variables[varName][constraint1R] = 1;
        }
        
        // Contrainte: Exactement 1 personne en 2F/3F
        const constraint2F3F = `closure_2f3f_${site.id}_${date}`;
        model.constraints[constraint2F3F] = { equal: 1 };
        for (const { varName } of roleVars.is_2f3f) {
          model.variables[varName][constraint2F3F] = 1;
        }
        
        // Contrainte: Une personne ne peut pas avoir les deux rôles
        for (const { secId, varName: var1R } of roleVars.is_1r) {
          const var2F3F = `role_2f3f_${secId}_${site.id}_${date}`;
          const exclusiveConstraint = `exclusive_role_${secId}_${site.id}_${date}`;
          model.constraints[exclusiveConstraint] = { max: 1 };
          model.variables[var1R][exclusiveConstraint] = 1;
          model.variables[var2F3F][exclusiveConstraint] = 1;
        }
        
        // Lier les rôles aux combos full-day (un rôle ne peut être actif QUE si le combo est sélectionné)
        for (const { varName: var1R, comboVar } of roleVars.is_1r) {
          const linkConstraint = `link_1r_${var1R}`;
          model.constraints[linkConstraint] = { max: 0 };
          model.variables[var1R][linkConstraint] = 1;
          model.variables[comboVar][linkConstraint] = -1;
        }
        
        for (const { varName: var2F3F, comboVar } of roleVars.is_2f3f) {
          const linkConstraint = `link_2f3f_${var2F3F}`;
          model.constraints[linkConstraint] = { max: 0 };
          model.variables[var2F3F][linkConstraint] = 1;
          model.variables[comboVar][linkConstraint] = -1;
        }
        
        const roleType = needs3F ? '3F' : '2F';
        logger.info(`  🔐 Site fermeture ${site.nom}: ${fullDayVars.length} journées complètes (min: 2) | Rôles: 1R + ${roleType}`);
      } else {
        logger.info(`  ⚠️ Site fermeture ${site.nom}: Seulement ${fullDayVars.length} journées complètes possibles!`);
      }
    } 
    // CAS A: Besoin UNIQUEMENT LE MATIN
    else if (hasMorning && !hasAfternoon) {
      const morningCandidates = new Map<string, string[]>(); // secId -> comboVars[]
      const roleVars = {
        is_1r: [] as Array<{ secId: string, varName: string, comboVar: string }>,
        is_2f3f: [] as Array<{ secId: string, varName: string, comboVar: string, needs3F: boolean }>
      };
      
      const needs3F = context.sites_needing_3f.get(date)?.has(site.id) || false;
      
      // Find all combos where morning = this site (afternoon can be anything)
      for (const combo of combos) {
        if (combo.needMatin?.site_id === site.id) {
          if (!morningCandidates.has(combo.secretaire_id)) {
            morningCandidates.set(combo.secretaire_id, []);
          }
          morningCandidates.get(combo.secretaire_id)!.push(combo.varName);
        }
      }
      
      if (morningCandidates.size >= 2) {
        // Create role variables with _matin suffix
        for (const [secId, comboVars] of morningCandidates.entries()) {
          const var1R = `role_1r_${secId}_${site.id}_${date}_matin`;
          const var2F3F = `role_2f3f_${secId}_${site.id}_${date}_matin`;
          
          model.binaries[var1R] = 1;
          model.binaries[var2F3F] = 1;
          
          const count1R = context.closing_1r_counters.get(secId) || 0;
          const count2F3F = context.closing_2f3f_counters.get(secId) || 0;
          const totalClosing = count1R + count2F3F;
          
          let penalty1R = 0;
          let penalty2F3F = 0;
          
          if (count2F3F >= 1) penalty2F3F -= 250;
          if (totalClosing >= 2) {
            penalty1R -= 250;
            penalty2F3F -= 250;
          }
          if (totalClosing >= 3) {
            penalty1R -= 200;
            penalty2F3F -= 200;
          }
          if (totalClosing >= 4) {
            penalty1R -= 200;
            penalty2F3F -= 200;
          }
          
          // EXCLUSION: Lucie Pratillo ne peut JAMAIS être 2F/3F
          if (secId === LUCIE_PRATILLO_ID) {
            penalty2F3F -= 10000;
          }
          
          // 🎯 BONUS: Profil "Matin sur site + Après-midi Admin" pour 2F
          // Vérifier si cette secrétaire a un combo qui correspond à ce profil
          const hasTargetProfile = comboVars.some(comboVar => {
            const combo = combos.find(c => c.varName === comboVar);
            return combo && 
                   combo.needMatin?.site_id === site.id && 
                   combo.needAM?.site_id === ADMIN_SITE_ID;
          });
          
          if (hasTargetProfile) {
            penalty2F3F += 200; // Bonus pour profil idéal
            console.log(`  🎯 Bonus profil "Matin ${site.nom} + AM Admin" pour 2F: +200`);
          }
          
          model.variables[var1R] = { score_total: penalty1R };
          model.variables[var2F3F] = { score_total: penalty2F3F };
          
          roleVars.is_1r.push({ secId, varName: var1R, comboVar: comboVars[0] });
          roleVars.is_2f3f.push({ secId, varName: var2F3F, comboVar: comboVars[0], needs3F });
          
          // ✅ CORRECTION: Lien agrégé rôle ↔ combos (une seule contrainte par rôle)
          // Un rôle peut être actif si AU MOINS UN des combos de cette secrétaire sur ce site est actif
          const linkConstraint1R = `link_1r_${var1R}`;
          model.constraints[linkConstraint1R] = { max: 0 };
          model.variables[var1R][linkConstraint1R] = 1;  // +1 * var1R
          
          for (const comboVar of comboVars) {
            model.variables[comboVar][linkConstraint1R] = -1;  // -1 * comboVar
          }
          
          const linkConstraint2F = `link_2f3f_${var2F3F}`;
          model.constraints[linkConstraint2F] = { max: 0 };
          model.variables[var2F3F][linkConstraint2F] = 1;  // +1 * var2F3F
          
          for (const comboVar of comboVars) {
            model.variables[comboVar][linkConstraint2F] = -1;  // -1 * comboVar
          }
        }
        
        // ✅ NOUVELLE CONTRAINTE: Minimum 2 secrétaires le matin sur ce site de fermeture
        const morningMinConstraint = `closure_min_${site.id}_${date}_matin`;
        model.constraints[morningMinConstraint] = { min: 2 };
        
        // Ajouter TOUS les combos qui couvrent ce site le matin
        for (const [secId, comboVars] of morningCandidates.entries()) {
          for (const comboVar of comboVars) {
            model.variables[comboVar][morningMinConstraint] = 1;
          }
        }
        
        logger.info(`  ✅ Contrainte minimum 2 secrétaires appliquée: ${morningCandidates.size} candidates avec ${Array.from(morningCandidates.values()).reduce((sum, cvs) => sum + cvs.length, 0)} combos possibles`);
        
        // Exactly 1 person in 1R for morning
        const constraint1R = `closure_1r_${site.id}_${date}_matin`;
        model.constraints[constraint1R] = { equal: 1 };
        for (const { varName } of roleVars.is_1r) {
          model.variables[varName][constraint1R] = 1;
        }
        
        // Exactly 1 person in 2F/3F for morning
        const constraint2F3F = `closure_2f3f_${site.id}_${date}_matin`;
        model.constraints[constraint2F3F] = { equal: 1 };
        for (const { varName } of roleVars.is_2f3f) {
          model.variables[varName][constraint2F3F] = 1;
        }
        
        // Exclusivity: one person cannot have both roles
        for (const { secId, varName: var1R } of roleVars.is_1r) {
          const var2F3F = `role_2f3f_${secId}_${site.id}_${date}_matin`;
          const exclusiveConstraint = `exclusive_role_${secId}_${site.id}_${date}_matin`;
          model.constraints[exclusiveConstraint] = { max: 1 };
          model.variables[var1R][exclusiveConstraint] = 1;
          model.variables[var2F3F][exclusiveConstraint] = 1;
        }
        
        const roleType = needs3F ? '3F' : '2F';
        logger.info(`  🌅 Site fermeture ${site.nom} (MATIN SEULEMENT): ${morningCandidates.size} candidates | Rôles: 1R + ${roleType}`);
      } else {
        logger.info(`  ⚠️ Site fermeture ${site.nom} (MATIN): Seulement ${morningCandidates.size} candidates!`);
      }
    }
    // CAS B: Besoin UNIQUEMENT L'APRÈS-MIDI
    else if (!hasMorning && hasAfternoon) {
      const afternoonCandidates = new Map<string, string[]>(); // secId -> comboVars[]
      const roleVars = {
        is_1r: [] as Array<{ secId: string, varName: string, comboVar: string }>,
        is_2f3f: [] as Array<{ secId: string, varName: string, comboVar: string, needs3F: boolean }>
      };
      
      const needs3F = context.sites_needing_3f.get(date)?.has(site.id) || false;
      
      // Find all combos where afternoon = this site (morning can be anything)
      for (const combo of combos) {
        if (combo.needAM?.site_id === site.id) {
          if (!afternoonCandidates.has(combo.secretaire_id)) {
            afternoonCandidates.set(combo.secretaire_id, []);
          }
          afternoonCandidates.get(combo.secretaire_id)!.push(combo.varName);
        }
      }
      
      if (afternoonCandidates.size >= 2) {
        // Create role variables with _pm suffix
        for (const [secId, comboVars] of afternoonCandidates.entries()) {
          const var1R = `role_1r_${secId}_${site.id}_${date}_pm`;
          const var2F3F = `role_2f3f_${secId}_${site.id}_${date}_pm`;
          
          model.binaries[var1R] = 1;
          model.binaries[var2F3F] = 1;
          
          const count1R = context.closing_1r_counters.get(secId) || 0;
          const count2F3F = context.closing_2f3f_counters.get(secId) || 0;
          const totalClosing = count1R + count2F3F;
          
          let penalty1R = 0;
          let penalty2F3F = 0;
          
          if (count2F3F >= 1) penalty2F3F -= 250;
          if (totalClosing >= 2) {
            penalty1R -= 250;
            penalty2F3F -= 250;
          }
          if (totalClosing >= 3) {
            penalty1R -= 200;
            penalty2F3F -= 200;
          }
          if (totalClosing >= 4) {
            penalty1R -= 200;
            penalty2F3F -= 200;
          }
          
          // EXCLUSION: Lucie Pratillo ne peut JAMAIS être 2F/3F
          if (secId === LUCIE_PRATILLO_ID) {
            penalty2F3F -= 10000;
          }
          
          model.variables[var1R] = { score_total: penalty1R };
          model.variables[var2F3F] = { score_total: penalty2F3F };
          
          roleVars.is_1r.push({ secId, varName: var1R, comboVar: comboVars[0] });
          roleVars.is_2f3f.push({ secId, varName: var2F3F, comboVar: comboVars[0], needs3F });
          
          // ✅ CORRECTION: Lien agrégé rôle ↔ combos (une seule contrainte par rôle)
          // Un rôle peut être actif si AU MOINS UN des combos de cette secrétaire sur ce site est actif
          const linkConstraint1R = `link_1r_${var1R}`;
          model.constraints[linkConstraint1R] = { max: 0 };
          model.variables[var1R][linkConstraint1R] = 1;  // +1 * var1R
          
          for (const comboVar of comboVars) {
            model.variables[comboVar][linkConstraint1R] = -1;  // -1 * comboVar
          }
          
          const linkConstraint2F = `link_2f3f_${var2F3F}`;
          model.constraints[linkConstraint2F] = { max: 0 };
          model.variables[var2F3F][linkConstraint2F] = 1;  // +1 * var2F3F
          
          for (const comboVar of comboVars) {
            model.variables[comboVar][linkConstraint2F] = -1;  // -1 * comboVar
          }
        }
        
        // ✅ NOUVELLE CONTRAINTE: Minimum 2 secrétaires l'après-midi sur ce site de fermeture
        const afternoonMinConstraint = `closure_min_${site.id}_${date}_pm`;
        model.constraints[afternoonMinConstraint] = { min: 2 };
        
        // Ajouter TOUS les combos qui couvrent ce site l'après-midi
        for (const [secId, comboVars] of afternoonCandidates.entries()) {
          for (const comboVar of comboVars) {
            model.variables[comboVar][afternoonMinConstraint] = 1;
          }
        }
        
        logger.info(`  ✅ Contrainte minimum 2 secrétaires appliquée: ${afternoonCandidates.size} candidates avec ${Array.from(afternoonCandidates.values()).reduce((sum, cvs) => sum + cvs.length, 0)} combos possibles`);
        
        // Exactly 1 person in 1R for afternoon
        const constraint1R = `closure_1r_${site.id}_${date}_pm`;
        model.constraints[constraint1R] = { equal: 1 };
        for (const { varName } of roleVars.is_1r) {
          model.variables[varName][constraint1R] = 1;
        }
        
        // Exactly 1 person in 2F/3F for afternoon
        const constraint2F3F = `closure_2f3f_${site.id}_${date}_pm`;
        model.constraints[constraint2F3F] = { equal: 1 };
        for (const { varName } of roleVars.is_2f3f) {
          model.variables[varName][constraint2F3F] = 1;
        }
        
        // Exclusivity: one person cannot have both roles
        for (const { secId, varName: var1R } of roleVars.is_1r) {
          const var2F3F = `role_2f3f_${secId}_${site.id}_${date}_pm`;
          const exclusiveConstraint = `exclusive_role_${secId}_${site.id}_${date}_pm`;
          model.constraints[exclusiveConstraint] = { max: 1 };
          model.variables[var1R][exclusiveConstraint] = 1;
          model.variables[var2F3F][exclusiveConstraint] = 1;
        }
        
        const roleType = needs3F ? '3F' : '2F';
        logger.info(`  🌇 Site fermeture ${site.nom} (APRÈS-MIDI SEULEMENT): ${afternoonCandidates.size} candidates | Rôles: 1R + ${roleType}`);
      } else {
        logger.info(`  ⚠️ Site fermeture ${site.nom} (APRÈS-MIDI): Seulement ${afternoonCandidates.size} candidates!`);
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