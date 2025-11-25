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
    binaries: {}
  };
  
  const allCombos: Combo[] = [];
  let totalExcluded = 0;
  
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
      morningTotals.set(need.site_id, current + need.nombre_max);
    }
    
    for (const need of needsAM.filter(n => n.type !== 'bloc_operatoire')) {
      const current = afternoonTotals.get(need.site_id) || 0;
      afternoonTotals.set(need.site_id, current + need.nombre_max);
    }
    
    // Contraintes agrégées sites
    for (const [site_id, total_max] of morningTotals) {
      const constraintName = `site_cap_${site_id}_${date}_1`;
      model.constraints[constraintName] = { max: total_max };
      
      for (const combo of allCombos.filter(c => c.date === date)) {
        if (combo.needMatin?.site_id === site_id && combo.needMatin?.type !== 'bloc_operatoire') {
          model.variables[combo.varName][constraintName] = 1;
        }
      }
    }
    
    for (const [site_id, total_max] of afternoonTotals) {
      const constraintName = `site_cap_${site_id}_${date}_2`;
      model.constraints[constraintName] = { max: total_max };
      
      for (const combo of allCombos.filter(c => c.date === date)) {
        if (combo.needAM?.site_id === site_id && combo.needAM?.type !== 'bloc_operatoire') {
          model.variables[combo.varName][constraintName] = 1;
        }
      }
    }
    
    // Contraintes spécifiques blocs
    for (const need of needsMatin.filter(n => n.type === 'bloc_operatoire')) {
      const needId = `${need.site_id}_${date}_1_${need.bloc_operation_id}_${need.besoin_operation_id}`;
      const constraintName = `max_cap_${needId}`;
      model.constraints[constraintName] = { max: need.nombre_max };
      
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
      model.constraints[constraintName] = { max: need.nombre_max };
      
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
  // 4. PÉNALITÉ COMBINÉE CLOSING + PORRENTRUY
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
    
    // Variables pour compter les jours 1R, 2F/3F, et Porrentruy
    // Note: Pour V4 complet, ces variables devraient être liées aux combos
    // Pour l'instant, on crée des variables indicatrices simples
    
    // Compter combien de jours avec closing et Porrentruy dans les combos
    const secCombos = allCombos.filter(c => c.secretaire_id === sec.id);
    
    // Pour chaque secrétaire, créer variables de comptage
    const closingDaysVar = `closing_days_${sec.id}`;
    const porrentruyDaysVar = `porrentruy_days_${sec.id}`;
    const comboActivatedVar = `combo_penalty_${sec.id}`;
    
    model.variables[closingDaysVar] = { score_total: 0 };
    model.variables[porrentruyDaysVar] = { score_total: 0 };
    model.variables[comboActivatedVar] = { score_total: -500 }; // Pénalité si activé
    model.binaries[comboActivatedVar] = 1;
    
    // Note: Pour une implémentation complète, il faudrait:
    // 1. Lier closingDaysVar aux combos assignés avec closing roles
    // 2. Lier porrentruyDaysVar aux combos assignés à Porrentruy
    // 3. Utiliser Big-M pour activer comboActivatedVar si les deux conditions sont remplies
    
    // Pour V3, on simplifie: on compte après l'optimisation et on applique la pénalité en post-traitement
    logger.info(`    ✅ Variables de pénalité combo créées`);
  }
  
  logger.info(`  ✅ Pénalités combinées configurées (application en post-traitement)`);
  
  // ============================================================
  // 5. CONTRAINTES SECRÉTAIRES FLEXIBLES
  // ============================================================
  // (Pour V4 - après validation V3 de base)
  // TODO: Implémenter contraintes flexibles globales
  
  // ============================================================
  // 5. PÉNALITÉS CLOSING V3 (PAR JOUR)
  // ============================================================
  // (Pour V4 - nécessite refonte majeure avec variables closing par jour)
  // TODO: Implémenter pénalités closing V3
  
  // ============================================================
  // 6. PÉNALITÉS PORRENTRUY V3 (PAR JOUR)
  // ============================================================
  // (Pour V4)
  // TODO: Implémenter pénalités Porrentruy V3
  
  // ============================================================
  // 7. CONTRAINTES FERMETURE (identiques à V2 pour l'instant)
  // ============================================================
  // Garder logique V2 pour les contraintes de fermeture
  // TODO: À porter depuis milp-builder.ts
  
  return model;
}
