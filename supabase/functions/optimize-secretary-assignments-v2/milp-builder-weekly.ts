/**
 * MILP Builder pour optimisation GLOBALE HEBDOMADAIRE
 * 
 * Construit un SEUL modèle MILP pour toute la semaine au lieu de jour par jour
 * - Contraintes flexibles: nombre de jours travaillés + minimum jours admin-only
 * - Pénalités closing V3: par JOUR avec paliers remplaçants
 * - Pénalités Porrentruy V3: progressives par JOUR
 */

import type {
  SiteNeed,
  CapaciteEffective,
  WeekData,
  WeekContext
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
  SALLES_STANDARD,
  PORRENTRUY_SITES,
  CLOSING_PENALTIES_V3,
  SITE_OVERLOAD_PENALTIES_V3,
  FLORENCE_BRON_ID,
  DR_FDA323F4_ID,
  SARA_BORTOLON_ID,
  MIRLINDA_HASANI_ID,
  SPECIAL_DOCTOR_SECRETARY_BONUS
} from './types.ts';
import { calculateComboScore } from './score-calculator.ts';
import { logger } from './index.ts';

const LUCIE_PRATILLO_ID = '5d3af9e3-674b-48d6-b54f-bd84c9eee670';

interface Combo {
  secretaire_id: string;
  date: string;
  needMatin: SiteNeed | null;
  needAM: SiteNeed | null;
  score: number;
  varName: string;
}

/**
 * Construction du modèle MILP global pour toute la semaine
 */
export function buildWeeklyMILPModel(
  weekContext: WeekContext,
  weekData: WeekData,
  historique: {
    closing1R2F: Map<string, number>,
    esplanade: Map<string, number>
  }
): any {
  logger.info(`\n🔧 Construction du modèle MILP GLOBAL pour la semaine`);
  logger.info(`  📅 Dates: ${weekContext.dates.join(', ')}`);
  
  const model: any = {
    optimize: 'score_total',
    opType: 'max',
    constraints: {},
    variables: {},
    binaries: {},
    ints: {}
  };
  
  const allCombos: Combo[] = [];
  let totalExcluded = 0;
  
  // ============================================================
  // PRÉ-CALCUL: Identifier les sites de fermeture avec journée complète
  // ============================================================
  const closingFullDaySites = new Map<string, Set<string>>(); // date -> Set<site_id>
  
  for (const date of weekContext.dates) {
    const needs = weekContext.needs_by_date.get(date) || [];
    const closingSites = weekContext.closing_sites_by_date.get(date) || new Set();
    
    closingFullDaySites.set(date, new Set());
    
    for (const siteId of closingSites) {
      const siteNeeds = needs.filter(n => n.site_id === siteId && n.type === 'site');
      const besoinsM = siteNeeds.filter(n => n.periode === 'matin').reduce((sum, n) => sum + (n.nombre_suggere || 0), 0);
      const besoinsAM = siteNeeds.filter(n => n.periode === 'apres_midi').reduce((sum, n) => sum + (n.nombre_suggere || 0), 0);
      
      if (besoinsM > 0 && besoinsAM > 0) {
        closingFullDaySites.get(date)!.add(siteId);
        logger.info(`  🔐 Site fermeture journée complète: ${siteId} (${date})`);
      }
    }
  }
  
  // ============================================================
  // 1. GÉNÉRER TOUTES LES VARIABLES POUR LA SEMAINE
  // ============================================================
  for (const date of weekContext.dates) {
    const needs = weekContext.needs_by_date.get(date) || [];
    const capacities = weekContext.capacities_by_date.get(date) || [];
    
    const needsMatin = needs.filter(n => n.periode === 'matin');
    const needsAM = needs.filter(n => n.periode === 'apres_midi');
    
    const activeSecretaires = new Set(
      capacities.filter(c => c.secretaire_id).map(c => c.secretaire_id!)
    );
    
    logger.info(`  📆 ${date}: ${activeSecretaires.size} secrétaires, ${needs.length} besoins`);
    
    // Générer combos pour chaque secrétaire pour ce jour
    for (const secretaire_id of activeSecretaires) {
      const secretaire = weekData.secretaires.find(s => s.id === secretaire_id);
      if (!secretaire) continue;
      
      // Check capacity for morning and afternoon
      const hasMatinCap = capacities.some(
        c => c.secretaire_id === secretaire_id && c.demi_journee === 'matin'
      );
      const hasAMCap = capacities.some(
        c => c.secretaire_id === secretaire_id && c.demi_journee === 'apres_midi'
      );
      
      // Get eligible needs
      const eligibleMatin: (SiteNeed | null)[] = [];
      const eligibleAM: (SiteNeed | null)[] = [];
      
      if (hasMatinCap) {
        eligibleMatin.push(null); // ADMIN
        for (const need of needsMatin) {
          if (need.site_id === ADMIN_SITE_ID) {
            eligibleMatin.push(need);
            continue;
          }
          
          if (need.type === 'bloc_operatoire' && need.besoin_operation_id) {
            const hasCompetence = weekData.secretaires_besoins.some(
              sb => sb.secretaire_id === secretaire_id && 
                    sb.besoin_operation_id === need.besoin_operation_id
            );
            if (hasCompetence) eligibleMatin.push(need);
          } else {
            const isEligible = weekData.secretaires_sites.some(
              ss => ss.secretaire_id === secretaire_id && ss.site_id === need.site_id
            );
            if (isEligible) eligibleMatin.push(need);
          }
        }
      } else if (hasAMCap) {
        eligibleMatin.push(null); // Force ADMIN
      }
      
      if (hasAMCap) {
        eligibleAM.push(null); // ADMIN
        for (const need of needsAM) {
          if (need.site_id === ADMIN_SITE_ID) {
            eligibleAM.push(need);
            continue;
          }
          
          if (need.type === 'bloc_operatoire' && need.besoin_operation_id) {
            const hasCompetence = weekData.secretaires_besoins.some(
              sb => sb.secretaire_id === secretaire_id && 
                    sb.besoin_operation_id === need.besoin_operation_id
            );
            if (hasCompetence) eligibleAM.push(need);
          } else {
            const isEligible = weekData.secretaires_sites.some(
              ss => ss.secretaire_id === secretaire_id && ss.site_id === need.site_id
            );
            if (isEligible) eligibleAM.push(need);
          }
        }
      } else if (hasMatinCap) {
        eligibleAM.push(null); // Force ADMIN
      }
      
      // Generate all combos
      for (const needM of eligibleMatin) {
        for (const needA of eligibleAM) {
          // 🔐 EXCLUSION: Sites de fermeture avec journée complète - interdire half-day
          const closingFullDay = closingFullDaySites.get(date);
          
          // Si matin est un site fermeture full-day mais après-midi est différent → EXCLURE
          if (needM && closingFullDay?.has(needM.site_id) && needM.type === 'site') {
            if (!needA || needA.site_id !== needM.site_id) {
              totalExcluded++;
              continue; // Exclure ce combo half-day
            }
          }
          
          // Si après-midi est un site fermeture full-day mais matin est différent → EXCLURE
          if (needA && closingFullDay?.has(needA.site_id) && needA.type === 'site') {
            if (!needM || needM.site_id !== needA.site_id) {
              totalExcluded++;
              continue; // Exclure ce combo half-day
            }
          }
          
          // Règles d'exclusion basées sur salles (comme v2)
          const isBlocMatin = needM?.type === 'bloc_operatoire';
          const isBlocAM = needA?.type === 'bloc_operatoire';
          const isForbiddenMatin = needM && FORBIDDEN_SITES.includes(needM.site_id);
          const isForbiddenAM = needA && FORBIDDEN_SITES.includes(needA.site_id);
          
          const salleMatin = needM?.salle_assignee;
          const salleAM = needA?.salle_assignee;
          
          const isSalleStandardMatin = salleMatin && SALLES_STANDARD.includes(salleMatin);
          const isSalleStandardAM = salleAM && SALLES_STANDARD.includes(salleAM);
          const isSalleGastroMatin = salleMatin ? (salleMatin === SALLE_GASTRO_ID) : (needM?.type_intervention_id === GASTRO_TYPE_INTERVENTION_ID);
          const isSalleGastroAM = salleAM ? (salleAM === SALLE_GASTRO_ID) : (needA?.type_intervention_id === GASTRO_TYPE_INTERVENTION_ID);
          
          // Exclusions
          if (isSalleStandardMatin && isForbiddenAM) {
            totalExcluded++;
            continue;
          }
          if (isForbiddenMatin && isSalleStandardAM) {
            totalExcluded++;
            continue;
          }
          
          const isEsplanadeMatin = needM?.site_id === ESPLANADE_OPHTALMOLOGIE_SITE_ID;
          const isEsplanadeAM = needA?.site_id === ESPLANADE_OPHTALMOLOGIE_SITE_ID;
          
          if (isSalleGastroMatin && isEsplanadeAM) {
            totalExcluded++;
            continue;
          }
          if (isEsplanadeMatin && isSalleGastroAM) {
            totalExcluded++;
            continue;
          }
          
          if (isSalleGastroMatin && needA?.type === 'bloc_operatoire' && !isSalleGastroAM) {
            totalExcluded++;
            continue;
          }
          if (isSalleGastroAM && needM?.type === 'bloc_operatoire' && !isSalleGastroMatin) {
            totalExcluded++;
            continue;
          }
          
          const isVieilleVilleMatin = needM?.site_id === VIEILLE_VILLE_SITE_ID;
          const isVieilleVilleAM = needA?.site_id === VIEILLE_VILLE_SITE_ID;
          
          if (isSalleGastroMatin && needA && needA.site_id !== ADMIN_SITE_ID && !isVieilleVilleAM && !isSalleGastroAM) {
            totalExcluded++;
            continue;
          }
          if (isSalleGastroAM && needM && needM.site_id !== ADMIN_SITE_ID && !isVieilleVilleMatin && !isSalleGastroMatin) {
            totalExcluded++;
            continue;
          }
          
          // Create combo
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
          
          const varName = `combo_${secretaire_id}_${date}_${needMatinId}_${needAMId}`;
          
          // Calculate base score
          let comboScore = calculateComboScore(
            secretaire_id,
            needM ? { ...needM, date } : null,
            needA ? { ...needA, date } : null,
            { // Context vide pour V3
              week_assignments: [],
              today_assignments: new Map(),
              admin_counters: new Map(),
              p2p3_counters: new Map(),
              closing_1r_counters: new Map(),
              closing_2f3f_counters: new Map(),
              sites_needing_3f: weekContext.sites_needing_3f
            },
            {
              besoins: weekData.secretaires_besoins,
              medecins: weekData.secretaires_medecins,
              sites: weekData.secretaires_sites
            },
            secretaire
          );
          
          // 🆕 Ajouter bonus médecin spécifique
          let doctorBonus = 0;
          
          // Vérifier si Dr FDA323F4 travaille sur un des besoins
          const drFDA323F4InMatin = needM?.medecins_ids?.includes(DR_FDA323F4_ID);
          const drFDA323F4InAM = needA?.medecins_ids?.includes(DR_FDA323F4_ID);
          
          if (drFDA323F4InMatin || drFDA323F4InAM) {
            // Vérifier si secrétaire est Sara ou Mirlinda
            if (secretaire_id === SARA_BORTOLON_ID || secretaire_id === MIRLINDA_HASANI_ID) {
              doctorBonus = SPECIAL_DOCTOR_SECRETARY_BONUS;
              logger.info(`  ⭐ Bonus médecin spécial: ${secretaire.first_name} avec Dr FDA323F4 → +${doctorBonus}`);
            }
          }
          
          comboScore += doctorBonus;
          
          allCombos.push({
            secretaire_id,
            date,
            needMatin: needM,
            needAM: needA,
            score: comboScore,
            varName
          });
          
          model.variables[varName] = { score_total: comboScore };
          model.binaries[varName] = 1;
        }
      }
    }
  }
  
  logger.info(`  ✅ Combos générés: ${allCombos.length} (exclus: ${totalExcluded})`);
  
  // ============================================================
  // 2. CONTRAINTES: Un combo par secrétaire par date
  // ============================================================
  for (const date of weekContext.dates) {
    const dateCombos = allCombos.filter(c => c.date === date);
    const secretaires = new Set(dateCombos.map(c => c.secretaire_id));
    
    for (const sec_id of secretaires) {
      const secCombos = dateCombos.filter(c => c.secretaire_id === sec_id);
      
      if (secCombos.length > 0) {
        const constraintName = `one_combo_${sec_id}_${date}`;
        model.constraints[constraintName] = { equal: 1 };
        
        for (const combo of secCombos) {
          model.variables[combo.varName][constraintName] = 1;
        }
      }
    }
  }
  
  // ============================================================
  // 3. CONTRAINTES: Capacité maximale par site/période
  // ============================================================
  // (Similaire à V2, mais pour toute la semaine)
  for (const date of weekContext.dates) {
    const needs = weekContext.needs_by_date.get(date) || [];
    const needsMatin = needs.filter(n => n.periode === 'matin');
    const needsAM = needs.filter(n => n.periode === 'apres_midi');
    
    // Agréger besoins sites par site_id
    const morningTotals = new Map<string, number>();
    const afternoonTotals = new Map<string, number>();
    
    for (const need of needsMatin.filter(n => n.type !== 'bloc_operatoire')) {
      const current = morningTotals.get(need.site_id) || 0;
      morningTotals.set(need.site_id, current + (need.nombre_suggere || 0));
    }
    
    for (const need of needsAM.filter(n => n.type !== 'bloc_operatoire')) {
      const current = afternoonTotals.get(need.site_id) || 0;
      afternoonTotals.set(need.site_id, current + (need.nombre_suggere || 0));
    }
    
    // Arrondir les totaux au supérieur
    for (const [site_id, total] of morningTotals) {
      morningTotals.set(site_id, Math.ceil(total));
    }
    for (const [site_id, total] of afternoonTotals) {
      afternoonTotals.set(site_id, Math.ceil(total));
    }
    
    // Contraintes agrégées sites
    for (const [site_id, total_max] of morningTotals) {
      // Skip ADMIN - pas de limite de capacité pour l'administratif
      if (site_id === ADMIN_SITE_ID) {
        logger.info(`  ⏭️  ${date} matin site ADMIN: skipped (no capacity limit)`);
        continue;
      }
      
      const constraintName = `site_cap_${site_id}_${date}_1`;
      model.constraints[constraintName] = { max: total_max };
      
      let linkedCombos = 0;
      for (const combo of allCombos.filter(c => c.date === date)) {
        if (combo.needMatin?.site_id === site_id && combo.needMatin?.type !== 'bloc_operatoire') {
          model.variables[combo.varName][constraintName] = 1;
          linkedCombos++;
        }
      }
      
      logger.info(`  📊 ${date} matin site ${site_id.slice(0, 8)}: max=${total_max}, combos liés=${linkedCombos}`);
    }
    
    for (const [site_id, total_max] of afternoonTotals) {
      // Skip ADMIN - pas de limite de capacité pour l'administratif
      if (site_id === ADMIN_SITE_ID) {
        logger.info(`  ⏭️  ${date} AM site ADMIN: skipped (no capacity limit)`);
        continue;
      }
      
      const constraintName = `site_cap_${site_id}_${date}_2`;
      model.constraints[constraintName] = { max: total_max };
      
      let linkedCombos = 0;
      for (const combo of allCombos.filter(c => c.date === date)) {
        if (combo.needAM?.site_id === site_id && combo.needAM?.type !== 'bloc_operatoire') {
          model.variables[combo.varName][constraintName] = 1;
          linkedCombos++;
        }
      }
      
      logger.info(`  📊 ${date} AM site ${site_id.slice(0, 8)}: max=${total_max}, combos liés=${linkedCombos}`);
    }
    
    // Contraintes spécifiques blocs
    for (const need of needsMatin.filter(n => n.type === 'bloc_operatoire')) {
      const needId = `${need.site_id}_${date}_1_${need.bloc_operation_id}_${need.besoin_operation_id}`;
      const constraintName = `max_cap_${needId}`;
      model.constraints[constraintName] = { max: Math.ceil(need.nombre_suggere || 0) };
      
      for (const combo of allCombos.filter(c => c.date === date)) {
        if (combo.needMatin?.type === 'bloc_operatoire' &&
            combo.needMatin?.bloc_operation_id === need.bloc_operation_id &&
            combo.needMatin?.besoin_operation_id === need.besoin_operation_id) {
          model.variables[combo.varName][constraintName] = 1;
        }
      }
    }
    
    for (const need of needsAM.filter(n => n.type === 'bloc_operatoire')) {
      const needId = `${need.site_id}_${date}_2_${need.bloc_operation_id}_${need.besoin_operation_id}`;
      const constraintName = `max_cap_${needId}`;
      model.constraints[constraintName] = { max: Math.ceil(need.nombre_suggere || 0) };
      
      for (const combo of allCombos.filter(c => c.date === date)) {
        if (combo.needAM?.type === 'bloc_operatoire' &&
            combo.needAM?.bloc_operation_id === need.bloc_operation_id &&
            combo.needAM?.besoin_operation_id === need.besoin_operation_id) {
          model.variables[combo.varName][constraintName] = 1;
        }
      }
    }
  }
  
  logger.info(`  ✅ Contraintes de capacité créées`);
  
  // ============================================================
  // 4. CONTRAINTES FERMETURE: 1R et 2F journée complète
  // ============================================================
  logger.info(`\n🔐 Création des contraintes fermeture 1R/2F...`);
  
  // Collecter toutes les variables de rôles créées (pour section 6)
  const roleVars1RBySecAndDate = new Map<string, Map<string, string[]>>(); // sec_id -> date -> [role_1r_var_names]
  const roleVars2FBySecAndDate = new Map<string, Map<string, string[]>>(); // sec_id -> date -> [role_2f_var_names]
  
  for (const date of weekContext.dates) {
    // Skip samedi
    const dateObj = new Date(date + 'T00:00:00Z');
    if (dateObj.getUTCDay() === 6) continue;
    
    const needs = weekContext.needs_by_date.get(date) || [];
    const closingSites = weekContext.closing_sites_by_date.get(date) || new Set();
    
    for (const siteId of closingSites) {
      // Calculer besoins secrétaires matin/AM
      const siteNeeds = needs.filter(n => n.site_id === siteId && n.type === 'site');
      const besoinsM = siteNeeds
        .filter(n => n.periode === 'matin')
        .reduce((sum, n) => sum + (n.nombre_suggere || 0), 0);
      const besoinsAM = siteNeeds
        .filter(n => n.periode === 'apres_midi')
        .reduce((sum, n) => sum + (n.nombre_suggere || 0), 0);
      
      const hasMorning = besoinsM > 0;
      const hasAfternoon = besoinsAM > 0;
      
      // CAS: Journée complète - besoin matin ET après-midi
      if (hasMorning && hasAfternoon) {
        // Trouver tous les combos "full day" (matin = site ET AM = site)
        const fullDayCombos = allCombos.filter(c => 
          c.date === date &&
          c.needMatin?.site_id === siteId &&
          c.needAM?.site_id === siteId
        );
        
        if (fullDayCombos.length >= 2) {
          // A. Créer variables full-day
          const fullDayVars: { secId: string, varName: string, comboVar: string }[] = [];
          
          for (const combo of fullDayCombos) {
            const fullDayVar = `fullday_${combo.secretaire_id}_${siteId}_${date}`;
            
            if (!model.variables[fullDayVar]) {
              model.binaries[fullDayVar] = 1;
              model.variables[fullDayVar] = { score_total: 0 };
              
              // Lier fullDayVar au combo
              const linkConstraint = `link_fullday_${fullDayVar}`;
              model.constraints[linkConstraint] = { equal: 0 };
              model.variables[fullDayVar][linkConstraint] = 1;
              model.variables[combo.varName][linkConstraint] = -1;
              
              fullDayVars.push({ secId: combo.secretaire_id, varName: fullDayVar, comboVar: combo.varName });
            }
          }
          
          // B. Contrainte: Minimum 2 personnes full-day sur site fermeture
          const minConstraint = `closure_min_${siteId}_${date}`;
          model.constraints[minConstraint] = { min: 2 };
          for (const { varName } of fullDayVars) {
            model.variables[varName][minConstraint] = 1;
          }
          
          // C. Créer variables de rôles 1R et 2F
          const roleVars1R: { secId: string, varName: string }[] = [];
          const roleVars2F: { secId: string, varName: string }[] = [];
          
          for (const { secId, varName: fullDayVar } of fullDayVars) {
            const var1R = `role_1r_${secId}_${siteId}_${date}`;
            const var2F = `role_2f_${secId}_${siteId}_${date}`;
            
            model.binaries[var1R] = 1;
            model.binaries[var2F] = 1;
            model.variables[var1R] = { score_total: 0 };
            model.variables[var2F] = { score_total: 0 };
            
            // Lier rôle au full-day
            const link1R = `link_role_1r_${var1R}`;
            model.constraints[link1R] = { max: 0 };
            model.variables[var1R][link1R] = 1;
            model.variables[fullDayVar][link1R] = -1;
            
            const link2F = `link_role_2f_${var2F}`;
            model.constraints[link2F] = { max: 0 };
            model.variables[var2F][link2F] = 1;
            model.variables[fullDayVar][link2F] = -1;
            
            roleVars1R.push({ secId, varName: var1R });
            roleVars2F.push({ secId, varName: var2F });
            
            // 🆕 Collecter pour section 6
            if (!roleVars1RBySecAndDate.has(secId)) roleVars1RBySecAndDate.set(secId, new Map());
            if (!roleVars1RBySecAndDate.get(secId)!.has(date)) roleVars1RBySecAndDate.get(secId)!.set(date, []);
            roleVars1RBySecAndDate.get(secId)!.get(date)!.push(var1R);
            
            if (!roleVars2FBySecAndDate.has(secId)) roleVars2FBySecAndDate.set(secId, new Map());
            if (!roleVars2FBySecAndDate.get(secId)!.has(date)) roleVars2FBySecAndDate.get(secId)!.set(date, []);
            roleVars2FBySecAndDate.get(secId)!.get(date)!.push(var2F);
          }
          
          // D. Contrainte: Exactement 1 personne en 1R
          const constraint1R = `closure_1r_${siteId}_${date}`;
          model.constraints[constraint1R] = { equal: 1 };
          for (const { varName } of roleVars1R) {
            model.variables[varName][constraint1R] = 1;
          }
          
          // E. Contrainte: Exactement 1 personne en 2F
          const constraint2F = `closure_2f_${siteId}_${date}`;
          model.constraints[constraint2F] = { equal: 1 };
          for (const { varName } of roleVars2F) {
            model.variables[varName][constraint2F] = 1;
          }
          
          // F. Contrainte: Une personne ne peut pas avoir les deux rôles
          for (const { secId, varName: var1R } of roleVars1R) {
            const var2F = `role_2f_${secId}_${siteId}_${date}`;
            const exclusiveConstraint = `exclusive_role_${secId}_${siteId}_${date}`;
            model.constraints[exclusiveConstraint] = { max: 1 };
            model.variables[var1R][exclusiveConstraint] = 1;
            model.variables[var2F][exclusiveConstraint] = 1;
          }
          
          logger.info(`  🔐 Site ${siteId} (${date}): ${fullDayCombos.length} combos full-day | Contraintes 1R + 2F ajoutées`);
        } else {
          logger.info(`  ⚠️ Site ${siteId} (${date}): Seulement ${fullDayCombos.length} combos full-day disponibles`);
        }
      }
      
      // CAS: Demi-journée uniquement (matin OU après-midi)
      if ((hasMorning && !hasAfternoon) || (!hasMorning && hasAfternoon)) {
        const periode = hasMorning ? 'matin' : 'apres_midi';
        
        // Trouver tous les combos pour cette demi-journée
        const halfDayCombos = allCombos.filter(c => 
          c.date === date &&
          (periode === 'matin' 
            ? c.needMatin?.site_id === siteId && c.needMatin?.type === 'site'
            : c.needAM?.site_id === siteId && c.needAM?.type === 'site')
        );
        
        if (halfDayCombos.length >= 2) {
          // Créer variables 1R et 2F
          const roleVars1R: { secId: string, varName: string }[] = [];
          const roleVars2F: { secId: string, varName: string }[] = [];
          
          for (const combo of halfDayCombos) {
            const var1R = `role_1r_half_${combo.secretaire_id}_${siteId}_${date}_${periode}`;
            const var2F = `role_2f_half_${combo.secretaire_id}_${siteId}_${date}_${periode}`;
            
            model.binaries[var1R] = 1;
            model.binaries[var2F] = 1;
            model.variables[var1R] = { score_total: 0 };
            model.variables[var2F] = { score_total: 0 };
            
            // Lier rôle au combo
            const link1R = `link_1r_${var1R}`;
            model.constraints[link1R] = { max: 0 };
            model.variables[var1R][link1R] = 1;
            model.variables[combo.varName][link1R] = -1;
            
            const link2F = `link_2f_${var2F}`;
            model.constraints[link2F] = { max: 0 };
            model.variables[var2F][link2F] = 1;
            model.variables[combo.varName][link2F] = -1;
            
            roleVars1R.push({ secId: combo.secretaire_id, varName: var1R });
            roleVars2F.push({ secId: combo.secretaire_id, varName: var2F });
            
            // 🆕 Collecter pour section 6
            const secId = combo.secretaire_id;
            if (!roleVars1RBySecAndDate.has(secId)) roleVars1RBySecAndDate.set(secId, new Map());
            if (!roleVars1RBySecAndDate.get(secId)!.has(date)) roleVars1RBySecAndDate.get(secId)!.set(date, []);
            roleVars1RBySecAndDate.get(secId)!.get(date)!.push(var1R);
            
            if (!roleVars2FBySecAndDate.has(secId)) roleVars2FBySecAndDate.set(secId, new Map());
            if (!roleVars2FBySecAndDate.get(secId)!.has(date)) roleVars2FBySecAndDate.get(secId)!.set(date, []);
            roleVars2FBySecAndDate.get(secId)!.get(date)!.push(var2F);
          }
          
          // Exactement 1 personne en 1R
          const constraint1R = `closure_1r_half_${siteId}_${date}_${periode}`;
          model.constraints[constraint1R] = { equal: 1 };
          for (const { varName } of roleVars1R) {
            model.variables[varName][constraint1R] = 1;
          }
          
          // Exactement 1 personne en 2F
          const constraint2F = `closure_2f_half_${siteId}_${date}_${periode}`;
          model.constraints[constraint2F] = { equal: 1 };
          for (const { varName } of roleVars2F) {
            model.variables[varName][constraint2F] = 1;
          }
          
          // 1R ≠ 2F
          for (const { secId, varName: var1R } of roleVars1R) {
            const var2F = `role_2f_half_${secId}_${siteId}_${date}_${periode}`;
            const exclusiveConstraint = `exclusive_half_${secId}_${siteId}_${date}_${periode}`;
            model.constraints[exclusiveConstraint] = { max: 1 };
            model.variables[var1R][exclusiveConstraint] = 1;
            model.variables[var2F][exclusiveConstraint] = 1;
          }
          
          logger.info(`  🔐 Site ${siteId} (${date} ${periode}): ${halfDayCombos.length} combos | Contraintes 1R + 2F demi-journée ajoutées`);
        } else {
          logger.info(`  ⚠️ Site ${siteId} (${date} ${periode}): Seulement ${halfDayCombos.length} combos disponibles`);
        }
      }
    }
  }
  
  logger.info(`  ✅ Contraintes fermeture 1R/2F créées`);
  
  // ============================================================
  // 5. PÉNALITÉ COMBINÉE CLOSING + PORRENTRUY (FULL MILP)
  // ============================================================
  logger.info(`\n🔧 Création des pénalités combinées closing + Porrentruy...`);
  
  const secretaires = weekData.secretaires;
  
  for (const sec of secretaires) {
    // Vérifier si secrétaire a Porrentruy en préférence 2, 3, ou 4
    const hasPorrentruyPref = weekData.secretaires_sites
      .filter(ss => ss.secretaire_id === sec.id)
      .some(ss => 
        PORRENTRUY_SITES.includes(ss.site_id) && 
        ['2', '3', '4'].includes(ss.priorite)
      );
    
    if (!hasPorrentruyPref) continue;
    
    logger.info(`  👤 ${sec.first_name} ${sec.name} - a Porrentruy en pref 2/3/4`);
    
    const secCombos = allCombos.filter(c => c.secretaire_id === sec.id);
    
    // ===== A. VARIABLES DE COMPTAGE JOURS =====
    const days1R_var = `days_1r_${sec.id}`;
    const days2F_var = `days_2f_${sec.id}`;
    const daysPorr_var = `days_porr_${sec.id}`;
    
    model.variables[days1R_var] = { score_total: 0 };
    model.variables[days2F_var] = { score_total: 0 };
    model.variables[daysPorr_var] = { score_total: 0 };
    model.ints[days1R_var] = 1;
    model.ints[days2F_var] = 1;
    model.ints[daysPorr_var] = 1;
    
    // ===== B. VARIABLES BINAIRES PAR JOUR =====
    for (const date of weekContext.dates) {
      const dateCombos = secCombos.filter(c => c.date === date);
      
      // Binaire: ce jour a un combo avec 1R
      const has1R_date = `has_1r_${sec.id}_${date}`;
      model.variables[has1R_date] = { score_total: 0 };
      model.binaries[has1R_date] = 1;
      
      // Binaire: ce jour a un combo avec 2F/3F
      const has2F_date = `has_2f_${sec.id}_${date}`;
      model.variables[has2F_date] = { score_total: 0 };
      model.binaries[has2F_date] = 1;
      
      // Binaire: ce jour a un combo avec Porrentruy
      const hasPorr_date = `has_porr_${sec.id}_${date}`;
      model.variables[hasPorr_date] = { score_total: 0 };
      model.binaries[hasPorr_date] = 1;
      
      // ===== C. LIER BINAIRES AUX COMBOS =====
      // Identifier les combos 1R (une seule période avec closing)
      const combos1R = dateCombos.filter(c => {
        if (c.needMatin?.site_fermeture && weekContext.sites_needing_1r.get(date)?.has(c.needMatin.site_id)) {
          return true;
        }
        if (c.needAM?.site_fermeture && weekContext.sites_needing_1r.get(date)?.has(c.needAM.site_id)) {
          return true;
        }
        return false;
      });
      
      // Identifier les combos 2F (deux périodes, besoin total < 3)
      const combos2F = dateCombos.filter(c => {
        if (c.needMatin?.site_fermeture && weekContext.sites_needing_2f.get(date)?.has(c.needMatin.site_id)) {
          return true;
        }
        if (c.needAM?.site_fermeture && weekContext.sites_needing_2f.get(date)?.has(c.needAM.site_id)) {
          return true;
        }
        return false;
      });
      
      // Identifier les combos 3F (besoin total ≥ 3)
      const combos3F = dateCombos.filter(c => {
        if (c.needMatin?.site_fermeture && weekContext.sites_needing_3f.get(date)?.has(c.needMatin.site_id)) {
          return true;
        }
        if (c.needAM?.site_fermeture && weekContext.sites_needing_3f.get(date)?.has(c.needAM.site_id)) {
          return true;
        }
        return false;
      });
      
      const combosPorr = dateCombos.filter(c => 
        PORRENTRUY_SITES.includes(c.needMatin?.site_id || '') ||
        PORRENTRUY_SITES.includes(c.needAM?.site_id || '')
      );
      
      // Contrainte 1R: has1R_date <= somme(combos 1R)
      if (combos1R.length > 0) {
        const constraint1R_upper = `has1r_upper_${sec.id}_${date}`;
        model.constraints[constraint1R_upper] = { max: 0 };
        model.variables[has1R_date][constraint1R_upper] = 1;
        
        for (const combo of combos1R) {
          model.variables[combo.varName][constraint1R_upper] = -1;
        }
        
        // Contrainte: has1R_date >= (1/M) × somme
        const constraint1R_lower = `has1r_lower_${sec.id}_${date}`;
        model.constraints[constraint1R_lower] = { min: 0 };
        model.variables[has1R_date][constraint1R_lower] = -combos1R.length;
        
        for (const combo of combos1R) {
          model.variables[combo.varName][constraint1R_lower] = 1;
        }
      }
      
      // Contrainte 2F/3F (même logique, on combine 2F et 3F)
      const combos2F3F = [...combos2F, ...combos3F];
      if (combos2F3F.length > 0) {
        const constraint2F_upper = `has2f_upper_${sec.id}_${date}`;
        model.constraints[constraint2F_upper] = { max: 0 };
        model.variables[has2F_date][constraint2F_upper] = 1;
        
        for (const combo of combos2F3F) {
          model.variables[combo.varName][constraint2F_upper] = -1;
        }
        
        const constraint2F_lower = `has2f_lower_${sec.id}_${date}`;
        model.constraints[constraint2F_lower] = { min: 0 };
        model.variables[has2F_date][constraint2F_lower] = -combos2F3F.length;
        
        for (const combo of combos2F3F) {
          model.variables[combo.varName][constraint2F_lower] = 1;
        }
      }
      
      // Contrainte Porrentruy
      if (combosPorr.length > 0) {
        const constraintPorr_upper = `has_porr_upper_${sec.id}_${date}`;
        model.constraints[constraintPorr_upper] = { max: 0 };
        model.variables[hasPorr_date][constraintPorr_upper] = 1;
        
        for (const combo of combosPorr) {
          model.variables[combo.varName][constraintPorr_upper] = -1;
        }
        
        const constraintPorr_lower = `has_porr_lower_${sec.id}_${date}`;
        model.constraints[constraintPorr_lower] = { min: 0 };
        model.variables[hasPorr_date][constraintPorr_lower] = -combosPorr.length;
        
        for (const combo of combosPorr) {
          model.variables[combo.varName][constraintPorr_lower] = 1;
        }
      }
    }
    
    // ===== D. SOMMER LES JOURS =====
    const constraint_sum_1r = `sum_days_1r_${sec.id}`;
    model.constraints[constraint_sum_1r] = { equal: 0 };
    model.variables[days1R_var][constraint_sum_1r] = 1;
    
    for (const date of weekContext.dates) {
      model.variables[`has_1r_${sec.id}_${date}`][constraint_sum_1r] = -1;
    }
    
    const constraint_sum_2f = `sum_days_2f_${sec.id}`;
    model.constraints[constraint_sum_2f] = { equal: 0 };
    model.variables[days2F_var][constraint_sum_2f] = 1;
    
    for (const date of weekContext.dates) {
      model.variables[`has_2f_${sec.id}_${date}`][constraint_sum_2f] = -1;
    }
    
    const constraint_sum_porr = `sum_days_porr_${sec.id}`;
    model.constraints[constraint_sum_porr] = { equal: 0 };
    model.variables[daysPorr_var][constraint_sum_porr] = 1;
    
    for (const date of weekContext.dates) {
      model.variables[`has_porr_${sec.id}_${date}`][constraint_sum_porr] = -1;
    }
    
    // ===== E. CALCULER SCORE CLOSING =====
    const scoreClosing_var = `score_closing_${sec.id}`;
    model.variables[scoreClosing_var] = { score_total: 0 };
    model.ints[scoreClosing_var] = 1;
    
    const constraint_closing = `calc_closing_${sec.id}`;
    model.constraints[constraint_closing] = { equal: 0 };
    model.variables[scoreClosing_var][constraint_closing] = 1;
    model.variables[days1R_var][constraint_closing] = -10;
    model.variables[days2F_var][constraint_closing] = -12;
    
    // ===== F. ACTIVER PÉNALITÉ COMBO avec Big-M =====
    const comboPenalty_var = `combo_penalty_${sec.id}`;
    model.variables[comboPenalty_var] = { score_total: -500 };
    model.binaries[comboPenalty_var] = 1;
    
    // Indicateur 1: scoreClosing > 22
    const ind_closing = `ind_closing_${sec.id}`;
    model.variables[ind_closing] = { score_total: 0 };
    model.binaries[ind_closing] = 1;
    
    const M_closing = 100;
    const constraint_closing_threshold = `closing_threshold_${sec.id}`;
    model.constraints[constraint_closing_threshold] = { min: -22 };
    model.variables[scoreClosing_var][constraint_closing_threshold] = 1;
    model.variables[ind_closing][constraint_closing_threshold] = -M_closing;
    
    // Indicateur 2: daysPorr > 1
    const ind_porr = `ind_porr_${sec.id}`;
    model.variables[ind_porr] = { score_total: 0 };
    model.binaries[ind_porr] = 1;
    
    const M_porr = 10;
    const constraint_porr_threshold = `porr_threshold_${sec.id}`;
    model.constraints[constraint_porr_threshold] = { min: -1 };
    model.variables[daysPorr_var][constraint_porr_threshold] = 1;
    model.variables[ind_porr][constraint_porr_threshold] = -M_porr;
    
    // comboPenalty = AND(ind_closing, ind_porr)
    // comboPenalty <= ind_closing
    const constraint_and_1 = `combo_and_1_${sec.id}`;
    model.constraints[constraint_and_1] = { max: 0 };
    model.variables[comboPenalty_var][constraint_and_1] = 1;
    model.variables[ind_closing][constraint_and_1] = -1;
    
    // comboPenalty <= ind_porr
    const constraint_and_2 = `combo_and_2_${sec.id}`;
    model.constraints[constraint_and_2] = { max: 0 };
    model.variables[comboPenalty_var][constraint_and_2] = 1;
    model.variables[ind_porr][constraint_and_2] = -1;
    
    // comboPenalty >= ind_closing + ind_porr - 1
    const constraint_and_3 = `combo_and_3_${sec.id}`;
    model.constraints[constraint_and_3] = { min: -1 };
    model.variables[comboPenalty_var][constraint_and_3] = -1;
    model.variables[ind_closing][constraint_and_3] = 1;
    model.variables[ind_porr][constraint_and_3] = 1;
    
    logger.info(`    ✅ Pénalité combo complète avec Big-M`);
  }
  
  logger.info(`  ✅ Pénalités combinées configurées avec contraintes MILP complètes`);
  
  // ============================================================
  // 5. CONTRAINTES SECRÉTAIRES FLEXIBLES
  // ============================================================
  // (Pour V4 - après validation V3 de base)
  // TODO: Implémenter contraintes flexibles globales
  
  // ============================================================
  // 6. PÉNALITÉS CLOSING V3 - TOUS LES SECRÉTAIRES
  // ============================================================
  logger.info(`\n🔧 Création des pénalités closing V3 pour tous les secrétaires...`);
  
  for (const sec of secretaires) {
    logger.info(`  👤 ${sec.first_name} ${sec.name} - calcul pénalités closing`);
    
    const secCombos = allCombos.filter(c => c.secretaire_id === sec.id);
    
    // ===== A. VARIABLES DE COMPTAGE JOURS 1R et 2F =====
    const days1R_all_var = `days_1r_all_${sec.id}`;
    const days2F_all_var = `days_2f_all_${sec.id}`;
    
    model.variables[days1R_all_var] = { score_total: 0 };
    model.variables[days2F_all_var] = { score_total: 0 };
    model.ints[days1R_all_var] = 1;
    model.ints[days2F_all_var] = 1;
    
    // ===== B. CRÉER TOUTES LES VARIABLES BINAIRES PAR JOUR =====
    for (const date of weekContext.dates) {
      // Binaire: ce jour a un combo avec 1R
      const has1R_all_date = `has_1r_all_${sec.id}_${date}`;
      if (!model.variables[has1R_all_date]) {
        model.variables[has1R_all_date] = {};
      }
      model.variables[has1R_all_date].score_total = 0;
      model.binaries[has1R_all_date] = 1;
      
      // Binaire: ce jour a un combo avec 2F/3F
      const has2F_all_date = `has_2f_all_${sec.id}_${date}`;
      if (!model.variables[has2F_all_date]) {
        model.variables[has2F_all_date] = {};
      }
      model.variables[has2F_all_date].score_total = 0;
      model.binaries[has2F_all_date] = 1;
    }
    
    // ===== C. LIER BINAIRES AUX VARIABLES DE RÔLES (section 4) =====
    for (const date of weekContext.dates) {
      const has1R_all_date = `has_1r_all_${sec.id}_${date}`;
      const has2F_all_date = `has_2f_all_${sec.id}_${date}`;
      
      // Récupérer les variables de rôles créées dans la section 4
      const roleVars1R = roleVars1RBySecAndDate.get(sec.id)?.get(date) || [];
      const roleVars2F = roleVars2FBySecAndDate.get(sec.id)?.get(date) || [];
      
      // 🆕 CONTRAINTE 1R: has_1r_all_date = 1 si AU MOINS une variable role_1r_* est active
      if (roleVars1R.length > 0) {
        // has_1r_all_date <= sum(roleVars1R)
        const constraint1R_upper = `has1r_all_upper_${sec.id}_${date}`;
        model.constraints[constraint1R_upper] = { max: 0 };
        model.variables[has1R_all_date][constraint1R_upper] = 1;
        
        for (const roleVar of roleVars1R) {
          model.variables[roleVar][constraint1R_upper] = -1;
        }
        
        // has_1r_all_date >= (1/n) * sum(roleVars1R) pour forcer à 1 si au moins un actif
        const constraint1R_lower = `has1r_all_lower_${sec.id}_${date}`;
        model.constraints[constraint1R_lower] = { min: 0 };
        model.variables[has1R_all_date][constraint1R_lower] = roleVars1R.length;
        
        for (const roleVar of roleVars1R) {
          model.variables[roleVar][constraint1R_lower] = -1;
        }
      }
      
      // 🆕 CONTRAINTE 2F: has_2f_all_date = 1 si AU MOINS une variable role_2f_* est active
      if (roleVars2F.length > 0) {
        // has_2f_all_date <= sum(roleVars2F)
        const constraint2F_upper = `has2f_all_upper_${sec.id}_${date}`;
        model.constraints[constraint2F_upper] = { max: 0 };
        model.variables[has2F_all_date][constraint2F_upper] = 1;
        
        for (const roleVar of roleVars2F) {
          model.variables[roleVar][constraint2F_upper] = -1;
        }
        
        // has_2f_all_date >= (1/n) * sum(roleVars2F)
        const constraint2F_lower = `has2f_all_lower_${sec.id}_${date}`;
        model.constraints[constraint2F_lower] = { min: 0 };
        model.variables[has2F_all_date][constraint2F_lower] = roleVars2F.length;
        
        for (const roleVar of roleVars2F) {
          model.variables[roleVar][constraint2F_lower] = -1;
        }
      }
    }
    
    // ===== D. SOMMER LES JOURS =====
    const constraint_sum_1r_all = `sum_days_1r_all_${sec.id}`;
    model.constraints[constraint_sum_1r_all] = { equal: 0 };
    model.variables[days1R_all_var][constraint_sum_1r_all] = 1;
    
    for (const date of weekContext.dates) {
      model.variables[`has_1r_all_${sec.id}_${date}`][constraint_sum_1r_all] = -1;
    }
    
    const constraint_sum_2f_all = `sum_days_2f_all_${sec.id}`;
    model.constraints[constraint_sum_2f_all] = { equal: 0 };
    model.variables[days2F_all_var][constraint_sum_2f_all] = 1;
    
    for (const date of weekContext.dates) {
      model.variables[`has_2f_all_${sec.id}_${date}`][constraint_sum_2f_all] = -1;
    }
    
    // ===== E. CALCULER SCORE CLOSING =====
    const scoreClosing_all_var = `score_closing_all_${sec.id}`;
    model.variables[scoreClosing_all_var] = { score_total: 0 };
    model.ints[scoreClosing_all_var] = 1;
    
    const constraint_closing_all = `calc_closing_all_${sec.id}`;
    model.constraints[constraint_closing_all] = { equal: 0 };
    model.variables[scoreClosing_all_var][constraint_closing_all] = 1;
    model.variables[days1R_all_var][constraint_closing_all] = -10;
    model.variables[days2F_all_var][constraint_closing_all] = -12;
    
    // ===== F. INDICATEURS DE PALIERS (Big-M) =====
    // Tier 1: score > 22
    const ind_tier1 = `ind_tier1_${sec.id}`;
    model.variables[ind_tier1] = { score_total: 0 };
    model.binaries[ind_tier1] = 1;
    
    const M1 = 100;
    const constraint_tier1 = `tier1_threshold_${sec.id}`;
    model.constraints[constraint_tier1] = { max: 22 };
    model.variables[scoreClosing_all_var][constraint_tier1] = 1;
    model.variables[ind_tier1][constraint_tier1] = -M1;
    
    // Tier 2: score > 29
    const ind_tier2 = `ind_tier2_${sec.id}`;
    model.variables[ind_tier2] = { score_total: 0 };
    model.binaries[ind_tier2] = 1;
    
    const constraint_tier2 = `tier2_threshold_${sec.id}`;
    model.constraints[constraint_tier2] = { max: 29 };
    model.variables[scoreClosing_all_var][constraint_tier2] = 1;
    model.variables[ind_tier2][constraint_tier2] = -M1;
    
    // Tier 3: score > 31
    const ind_tier3 = `ind_tier3_${sec.id}`;
    model.variables[ind_tier3] = { score_total: 0 };
    model.binaries[ind_tier3] = 1;
    
    const constraint_tier3 = `tier3_threshold_${sec.id}`;
    model.constraints[constraint_tier3] = { max: 31 };
    model.variables[scoreClosing_all_var][constraint_tier3] = 1;
    model.variables[ind_tier3][constraint_tier3] = -M1;
    
    // Tier 4: score > 35
    const ind_tier4 = `ind_tier4_${sec.id}`;
    model.variables[ind_tier4] = { score_total: 0 };
    model.binaries[ind_tier4] = 1;
    
    const constraint_tier4 = `tier4_threshold_${sec.id}`;
    model.constraints[constraint_tier4] = { max: 35 };
    model.variables[scoreClosing_all_var][constraint_tier4] = 1;
    model.variables[ind_tier4][constraint_tier4] = -M1;
    
    // ===== G. INDICATEURS EXCLUSIFS POUR PÉNALITÉS NON CUMULATIVES =====
    // ind_only_tier1 = tier1 AND NOT tier2 (score ∈ (22, 29])
    const ind_only_tier1 = `ind_only_tier1_${sec.id}`;
    model.variables[ind_only_tier1] = { score_total: -200 }; // Pénalité -200
    model.binaries[ind_only_tier1] = 1;
    
    // ind_only_tier1 <= ind_tier1
    const c_ot1_1 = `ot1_1_${sec.id}`;
    model.constraints[c_ot1_1] = { max: 0 };
    model.variables[ind_only_tier1][c_ot1_1] = 1;
    model.variables[ind_tier1][c_ot1_1] = -1;
    
    // ind_only_tier1 <= 1 - ind_tier2
    const c_ot1_2 = `ot1_2_${sec.id}`;
    model.constraints[c_ot1_2] = { max: 1 };
    model.variables[ind_only_tier1][c_ot1_2] = 1;
    model.variables[ind_tier2][c_ot1_2] = 1;
    
    // ind_only_tier1 >= ind_tier1 - ind_tier2
    const c_ot1_3 = `ot1_3_${sec.id}`;
    model.constraints[c_ot1_3] = { min: 0 };
    model.variables[ind_only_tier1][c_ot1_3] = -1;
    model.variables[ind_tier1][c_ot1_3] = 1;
    model.variables[ind_tier2][c_ot1_3] = -1;
    
    // ind_only_tier2 = tier2 AND NOT tier3 (score ∈ (29, 31])
    const ind_only_tier2 = `ind_only_tier2_${sec.id}`;
    model.variables[ind_only_tier2] = { score_total: -500 }; // Pénalité -500
    model.binaries[ind_only_tier2] = 1;
    
    const c_ot2_1 = `ot2_1_${sec.id}`;
    model.constraints[c_ot2_1] = { max: 0 };
    model.variables[ind_only_tier2][c_ot2_1] = 1;
    model.variables[ind_tier2][c_ot2_1] = -1;
    
    const c_ot2_2 = `ot2_2_${sec.id}`;
    model.constraints[c_ot2_2] = { max: 1 };
    model.variables[ind_only_tier2][c_ot2_2] = 1;
    model.variables[ind_tier3][c_ot2_2] = 1;
    
    const c_ot2_3 = `ot2_3_${sec.id}`;
    model.constraints[c_ot2_3] = { min: 0 };
    model.variables[ind_only_tier2][c_ot2_3] = -1;
    model.variables[ind_tier2][c_ot2_3] = 1;
    model.variables[ind_tier3][c_ot2_3] = -1;
    
    // ind_only_tier3 = tier3 AND NOT tier4 (score ∈ (31, 35])
    const ind_only_tier3 = `ind_only_tier3_${sec.id}`;
    model.variables[ind_only_tier3] = { score_total: -1100 }; // Pénalité -1100
    model.binaries[ind_only_tier3] = 1;
    
    const c_ot3_1 = `ot3_1_${sec.id}`;
    model.constraints[c_ot3_1] = { max: 0 };
    model.variables[ind_only_tier3][c_ot3_1] = 1;
    model.variables[ind_tier3][c_ot3_1] = -1;
    
    const c_ot3_2 = `ot3_2_${sec.id}`;
    model.constraints[c_ot3_2] = { max: 1 };
    model.variables[ind_only_tier3][c_ot3_2] = 1;
    model.variables[ind_tier4][c_ot3_2] = 1;
    
    const c_ot3_3 = `ot3_3_${sec.id}`;
    model.constraints[c_ot3_3] = { min: 0 };
    model.variables[ind_only_tier3][c_ot3_3] = -1;
    model.variables[ind_tier3][c_ot3_3] = 1;
    model.variables[ind_tier4][c_ot3_3] = -1;
    
    // Tier 4: score > 35 (pénalité -10000)
    // Pas besoin d'indicateur exclusif, ind_tier4 suffit
    model.variables[ind_tier4].score_total = -10000;
    
    logger.info(`    ✅ Pénalités closing V3 configurées`);
  }
  
  logger.info(`  ✅ Pénalités closing V3 créées pour tous les secrétaires`);
  
  // ============================================================
  // 7. PÉNALITÉS PORRENTRUY V3 (PAR JOUR)
  // ============================================================
  // (Pour V4 - si nécessaire)
  // TODO: Implémenter pénalités Porrentruy progressives si demandé
  
  // ============================================================
  // CONTRAINTES FERMETURE déjà implémentées (section 4)
  // ============================================================
  // Les contraintes fermeture 1R/2F sont maintenant appliquées dans la section 4
  // (lignes ~400-510) pour chaque site nécessitant une fermeture avec besoins
  // matin ET après-midi.
  
  return model;
}
