import type {
  SiteNeed,
  DynamicContext,
  PreferencesData,
  Secretaire,
  TodayAssignment,
  AssignmentSummary
} from './types.ts';
import { SCORE_WEIGHTS, PENALTIES, ADMIN_SITE_ID, FORBIDDEN_SITES, HIGH_PENALTY_SITES, GASTRO_TYPE_INTERVENTION_ID, VIEILLE_VILLE_SITE_ID, SAME_SITE_BONUS, ESPLANADE_OPHTALMOLOGIE_SITE_ID, SALLE_GASTRO_ID } from './types.ts';
import { logger } from './index.ts';

function countTodayAdminAssignments(
  secretaire_id: string,
  current_periode: 'matin' | 'apres_midi',
  today_assignments: Map<string, TodayAssignment>
): number {
  const assignment = today_assignments.get(secretaire_id);
  if (!assignment) return 0;
  
  let count = 0;
  
  // Only count periods BEFORE the current one
  if (current_periode === 'apres_midi' && assignment.matin) {
    if (assignment.matin.site_id === ADMIN_SITE_ID) {
      count++;
    }
  }
  
  return count;
}

function countTodaySiteAssignments(
  secretaire_id: string,
  site_id: string,
  current_periode: 'matin' | 'apres_midi',
  today_assignments: Map<string, TodayAssignment>
): number {
  const assignment = today_assignments.get(secretaire_id);
  if (!assignment) return 0;
  
  let count = 0;
  
  // Only count periods BEFORE the current one
  if (current_periode === 'apres_midi' && assignment.matin) {
    if (assignment.matin.site_id === site_id) {
      count++;
    }
  }
  
  return count;
}

export function calculateDynamicScore(
  secretaire_id: string,
  need: SiteNeed,
  context: DynamicContext,
  preferences: PreferencesData,
  secretaire: Secretaire
): number {
  let score = 0;
  
  // ============================================================
  // 1. SCORES POSITIFS (Prendre le MAX)
  // ============================================================
  const positiveScores: number[] = [];
  
  // 1a. Score BESOIN OPÉRATOIRE
  if (need.type === 'bloc_operatoire' && need.besoin_operation_id) {
    const besoinMatch = preferences.besoins.find(
      sb => sb.secretaire_id === secretaire_id && 
            sb.besoin_operation_id === need.besoin_operation_id
    );
    if (besoinMatch) {
      const besoinScore = besoinMatch.preference === 1 ? SCORE_WEIGHTS.BESOIN_OP_PREF_1 :
                          besoinMatch.preference === 2 ? SCORE_WEIGHTS.BESOIN_OP_PREF_2 :
                          SCORE_WEIGHTS.BESOIN_OP_PREF_3;
      positiveScores.push(besoinScore);
    }
  }
  
  // 1b. Score MÉDECIN
  for (const medecin_id of need.medecins_ids) {
    const medecinMatch = preferences.medecins.find(
      sm => sm.secretaire_id === secretaire_id && sm.medecin_id === medecin_id
    );
    if (medecinMatch) {
      const medecinScore = medecinMatch.priorite === '1' ? 
        SCORE_WEIGHTS.MEDECIN_PREF_1 : SCORE_WEIGHTS.MEDECIN_PREF_2;
      positiveScores.push(medecinScore);
    }
  }
  
  // 1c. Score SITE
  const siteMatch = preferences.sites.find(
    ss => ss.secretaire_id === secretaire_id && ss.site_id === need.site_id
  );
  if (siteMatch) {
    const siteScore = siteMatch.priorite === '1' ? SCORE_WEIGHTS.SITE_PREF_1 :
                      siteMatch.priorite === '2' ? SCORE_WEIGHTS.SITE_PREF_2 :
                      siteMatch.priorite === '3' ? SCORE_WEIGHTS.SITE_PREF_3 :
                      SCORE_WEIGHTS.SITE_PREF_4;
    positiveScores.push(siteScore);
  }
  
  // Prendre le MAX des scores positifs
  const base_score = positiveScores.length > 0 ? Math.max(...positiveScores) : 0;
  if (base_score > 0) {
    score += base_score;
  }
  
  // ============================================================
  // 2. BONUS ADMIN PROGRESSIF (DYNAMIQUE)
  // ============================================================
  const isAdminSite = need.site_id === ADMIN_SITE_ID;
  
  if (isAdminSite) {
    // ✨ Read from in-memory counter
    const weekAdminCount = context.admin_counters.get(secretaire_id) || 0;
    
    const todayAdminCount = countTodayAdminAssignments(
      secretaire_id, 
      need.periode, 
      context.today_assignments
    );
    
    const totalAdminCount = weekAdminCount + todayAdminCount;
    
    // Vérifier si le secrétaire a un objectif de demi-journées admin défini
    if (secretaire.nombre_demi_journees_admin && secretaire.nombre_demi_journees_admin > 0) {
      // Tant qu'on est sous l'objectif : bonus de 100 points
      if (totalAdminCount < secretaire.nombre_demi_journees_admin) {
        const adminBonus = 100;
        score += adminBonus;
      } else {
        // Au-delà de l'objectif : bonus minimal de 1 point
        const adminBonus = 1;
        score += adminBonus;
      }
    } else {
      // Comportement standard pour les secrétaires sans objectif admin spécifique
      const adminBonus = Math.max(0, PENALTIES.ADMIN_FIRST - totalAdminCount);
      score += adminBonus;
    }
  }
  
  // ============================================================
  // 3. PÉNALITÉ CHANGEMENT DE SITE (DÉSACTIVÉE - géré par MILP)
  // ============================================================
  // Cette pénalité est maintenant gérée par les variables auxiliaires
  // dans milp-builder.ts avec des contraintes Big-M
  
  // ============================================================
  // 4. PÉNALITÉ SUR-ASSIGNATION SITE PREF 2/3/4 (DYNAMIQUE)
  // ============================================================
  // ✨ Compter les JOURS uniques, uniquement pour Esplanade Ophtalmologie
  if (siteMatch && 
      (siteMatch.priorite === '2' || siteMatch.priorite === '3' || siteMatch.priorite === '4') &&
      need.site_id === ESPLANADE_OPHTALMOLOGIE_SITE_ID) {
    
    // Nombre de jours uniques déjà assignés cette semaine
    const weekDaysSet = context.p2p3_counters.get(secretaire_id)?.get(need.site_id);
    const weekDaysCount = weekDaysSet ? weekDaysSet.size : 0;
    
    // Vérifier si déjà assigné aujourd'hui (matin ou après-midi)
    const todayAssignment = context.today_assignments.get(secretaire_id);
    const alreadyAssignedToday = 
      (todayAssignment?.matin?.site_id === need.site_id) ||
      (todayAssignment?.apres_midi?.site_id === need.site_id);
    
    // Calcul du nombre de jours total (inclus aujourd'hui si pas encore compté)
    const totalDays = alreadyAssignedToday ? weekDaysCount : weekDaysCount + 1;
    
    // Pénalité dès le 2ème jour
    if (totalDays >= 2) {
      // 🆕 Récupérer le multiplicateur historique S-2 + S-1
      const multiplier = context.penalty_multipliers_esplanade?.get(secretaire_id) || 1.0;
      const penalty = (totalDays - 1) * PENALTIES.SITE_PREF_234_OVERLOAD * multiplier;
      score += penalty;
    }
  }
  
  // ============================================================
  // 5. PÉNALITÉ BLOC -> SITES INTERDITS (DÉSACTIVÉE - géré par MILP)
  // ============================================================
  // Cette pénalité est maintenant gérée par les variables auxiliaires
  // dans milp-builder.ts avec des contraintes Big-M
  
  return score;
}

// ============================================================
// COMBO SCORE CALCULATION
// ============================================================
export function calculateComboScore(
  secretaire_id: string,
  needMatin: SiteNeed | null,
  needAM: SiteNeed | null,
  context: DynamicContext,
  preferences: PreferencesData,
  secretaire: Secretaire
): number {
  const isFocused = logger.isFocused(secretaire_id, needMatin?.date || needAM?.date);
  
  let totalScore = 0;
  
  // ✨ Read counters from context
  let currentAdminCount = context.admin_counters.get(secretaire_id) || 0;
  
  // Map pour tracker les sites visités AUJOURD'HUI uniquement (pour éviter double comptage matin/AM)
  const siteDaysCount = new Map<string, number>(); // site_id -> totalDays après visite
  
  // ============================================================
  // 1. MATIN: Scores positifs
  // ============================================================
  if (needMatin) {
    const positiveScores: number[] = [];
    
    // 1a. Besoin opératoire
    if (needMatin.type === 'bloc_operatoire' && needMatin.besoin_operation_id) {
      const besoinMatch = preferences.besoins.find(
        sb => sb.secretaire_id === secretaire_id && 
              sb.besoin_operation_id === needMatin.besoin_operation_id
      );
      if (besoinMatch) {
        const besoinScore = besoinMatch.preference === 1 ? SCORE_WEIGHTS.BESOIN_OP_PREF_1 :
                            besoinMatch.preference === 2 ? SCORE_WEIGHTS.BESOIN_OP_PREF_2 :
                            SCORE_WEIGHTS.BESOIN_OP_PREF_3;
        positiveScores.push(besoinScore);
      }
    }
    
    // 1b. Médecin
    for (const medecin_id of needMatin.medecins_ids) {
      const medecinMatch = preferences.medecins.find(
        sm => sm.secretaire_id === secretaire_id && sm.medecin_id === medecin_id
      );
      if (medecinMatch) {
        const medecinScore = medecinMatch.priorite === '1' ? 
          SCORE_WEIGHTS.MEDECIN_PREF_1 : SCORE_WEIGHTS.MEDECIN_PREF_2;
        positiveScores.push(medecinScore);
      }
    }
    
    // 1c. Site
    const siteMatchMatin = preferences.sites.find(
      ss => ss.secretaire_id === secretaire_id && ss.site_id === needMatin.site_id
    );
    if (siteMatchMatin) {
      const siteScore = siteMatchMatin.priorite === '1' ? SCORE_WEIGHTS.SITE_PREF_1 :
                        siteMatchMatin.priorite === '2' ? SCORE_WEIGHTS.SITE_PREF_2 :
                        siteMatchMatin.priorite === '3' ? SCORE_WEIGHTS.SITE_PREF_3 :
                        SCORE_WEIGHTS.SITE_PREF_4;
      positiveScores.push(siteScore);
      if (isFocused) logger.info(`  ✅ MATIN SITE_PREF_${siteMatchMatin.priorite}: ${siteScore}`);
    }
    
    const matinBaseScore = positiveScores.length > 0 ? Math.max(...positiveScores) : 0;
    totalScore += matinBaseScore;
    if (isFocused) logger.info(`  🌅 Score MATIN BASE: ${matinBaseScore}`);
    
    // 1d. Bonus admin progressif (MATIN)
    if (needMatin.site_id === ADMIN_SITE_ID) {
      if (secretaire.nombre_demi_journees_admin && secretaire.nombre_demi_journees_admin > 0) {
        if (currentAdminCount < secretaire.nombre_demi_journees_admin) {
          totalScore += 100;
          if (isFocused) logger.info(`  💼 MATIN Admin (${currentAdminCount}/${secretaire.nombre_demi_journees_admin}): +100`);
        } else {
          totalScore += 1;
          if (isFocused) logger.info(`  💼 MATIN Admin (${currentAdminCount} ≥ ${secretaire.nombre_demi_journees_admin}): +1 (dépassement)`);
        }
      } else {
        const adminBonus = Math.max(0, PENALTIES.ADMIN_FIRST - currentAdminCount);
        totalScore += adminBonus;
        if (isFocused) logger.info(`  💼 MATIN Admin standard (${currentAdminCount}): +${adminBonus}`);
      }
      currentAdminCount++; // Incrémenter pour l'après-midi
    }
    
    // 1e. Pénalité sur-assignation site P2/P3/P4 (MATIN) - uniquement Esplanade Ophtalmologie
    if (siteMatchMatin && 
        (siteMatchMatin.priorite === '2' || siteMatchMatin.priorite === '3' || siteMatchMatin.priorite === '4') &&
        needMatin.site_id === ESPLANADE_OPHTALMOLOGIE_SITE_ID) {
      
      // Obtenir le nombre de jours CETTE SEMAINE depuis le contexte
      const weekDaysSet = context.p2p3_counters.get(secretaire_id)?.get(needMatin.site_id);
      const weekDaysCount = weekDaysSet ? weekDaysSet.size : 0;
      
      // Compter aujourd'hui comme un nouveau jour
      const totalDays = weekDaysCount + 1;
      
      if (totalDays >= 2) {
        const multiplier = context.penalty_multipliers_esplanade?.get(secretaire_id) || 1.0;
        const penalty = (totalDays - 1) * PENALTIES.SITE_PREF_234_OVERLOAD * multiplier;
        totalScore += penalty;
        if (isFocused) logger.info(`  ⚠️ MATIN Site P${siteMatchMatin.priorite} (Esplanade) sur-assigné (${totalDays} jours × ${multiplier.toFixed(2)}): ${penalty}`);
      }
      
      // ✅ Marquer que ce site a été visité AUJOURD'HUI (pour éviter double comptage avec AM)
      siteDaysCount.set(needMatin.site_id, totalDays);
    }
  }
  
  // ============================================================
  // 2. APRÈS-MIDI: Scores positifs
  // ============================================================
  if (needAM) {
    const positiveScores: number[] = [];
    
    // 2a. Besoin opératoire
    if (needAM.type === 'bloc_operatoire' && needAM.besoin_operation_id) {
      const besoinMatch = preferences.besoins.find(
        sb => sb.secretaire_id === secretaire_id && 
              sb.besoin_operation_id === needAM.besoin_operation_id
      );
      if (besoinMatch) {
        const besoinScore = besoinMatch.preference === 1 ? SCORE_WEIGHTS.BESOIN_OP_PREF_1 :
                            besoinMatch.preference === 2 ? SCORE_WEIGHTS.BESOIN_OP_PREF_2 :
                            SCORE_WEIGHTS.BESOIN_OP_PREF_3;
        positiveScores.push(besoinScore);
      }
    }
    
    // 2b. Médecin
    for (const medecin_id of needAM.medecins_ids) {
      const medecinMatch = preferences.medecins.find(
        sm => sm.secretaire_id === secretaire_id && sm.medecin_id === medecin_id
      );
      if (medecinMatch) {
        const medecinScore = medecinMatch.priorite === '1' ? 
          SCORE_WEIGHTS.MEDECIN_PREF_1 : SCORE_WEIGHTS.MEDECIN_PREF_2;
        positiveScores.push(medecinScore);
      }
    }
    
    // 2c. Site
    const siteMatchAM = preferences.sites.find(
      ss => ss.secretaire_id === secretaire_id && ss.site_id === needAM.site_id
    );
    if (siteMatchAM) {
      const siteScore = siteMatchAM.priorite === '1' ? SCORE_WEIGHTS.SITE_PREF_1 :
                        siteMatchAM.priorite === '2' ? SCORE_WEIGHTS.SITE_PREF_2 :
                        siteMatchAM.priorite === '3' ? SCORE_WEIGHTS.SITE_PREF_3 :
                        SCORE_WEIGHTS.SITE_PREF_4;
      positiveScores.push(siteScore);
    }
    
    const amBaseScore = positiveScores.length > 0 ? Math.max(...positiveScores) : 0;
    totalScore += amBaseScore;
    if (isFocused) logger.info(`  🌇 Score AM BASE: ${amBaseScore}`);
    
    // 2d. Bonus admin progressif (AM)
    if (needAM.site_id === ADMIN_SITE_ID) {
      if (secretaire.nombre_demi_journees_admin && secretaire.nombre_demi_journees_admin > 0) {
        if (currentAdminCount < secretaire.nombre_demi_journees_admin) {
          totalScore += 100;
          if (isFocused) logger.info(`  💼 AM Admin (${currentAdminCount}/${secretaire.nombre_demi_journees_admin}): +100`);
        } else {
          totalScore += 1;
          if (isFocused) logger.info(`  💼 AM Admin (${currentAdminCount} ≥ ${secretaire.nombre_demi_journees_admin}): +1 (dépassement)`);
        }
      } else {
        const adminBonus = Math.max(0, PENALTIES.ADMIN_FIRST - currentAdminCount);
        totalScore += adminBonus;
        if (isFocused) logger.info(`  💼 AM Admin standard (${currentAdminCount}): +${adminBonus}`);
      }
    }
    
    // 2e. Pénalité sur-assignation site P2/P3/P4 (AM) - uniquement Esplanade Ophtalmologie
    if (siteMatchAM && 
        (siteMatchAM.priorite === '2' || siteMatchAM.priorite === '3' || siteMatchAM.priorite === '4') &&
        needAM.site_id === ESPLANADE_OPHTALMOLOGIE_SITE_ID) {
      
      // Obtenir le nombre de jours CETTE SEMAINE depuis le contexte
      const weekDaysSet = context.p2p3_counters.get(secretaire_id)?.get(needAM.site_id);
      const weekDaysCount = weekDaysSet ? weekDaysSet.size : 0;
      
      // ✅ Vérifier si DÉJÀ ASSIGNÉE CE MATIN au même site Esplanade
      const alreadyCountedToday = siteDaysCount.has(needAM.site_id);
      
      // Si pas encore comptée aujourd'hui → +1 jour
      // Si déjà comptée ce matin → utiliser le compte du matin (pas de nouveau jour)
      const totalDays = alreadyCountedToday ? siteDaysCount.get(needAM.site_id)! : weekDaysCount + 1;
      
      if (totalDays >= 2) {
        // ✅ Si déjà pénalisé ce matin, ne pas re-pénaliser
        if (!alreadyCountedToday) {
          const multiplier = context.penalty_multipliers_esplanade?.get(secretaire_id) || 1.0;
          const penalty = (totalDays - 1) * PENALTIES.SITE_PREF_234_OVERLOAD * multiplier;
          totalScore += penalty;
          if (isFocused) logger.info(`  ⚠️ AM Site P${siteMatchAM.priorite} (Esplanade) sur-assigné (${totalDays} jours × ${multiplier.toFixed(2)}): ${penalty}`);
        }
      }
    }
  }
  
  // ============================================================
  // 3. BONUS MÊME SITE + PÉNALITÉ CHANGEMENT DE SITE
  // ============================================================
  if (needMatin && needAM) {
    if (needMatin.site_id === needAM.site_id && needMatin.site_id !== ADMIN_SITE_ID) {
      totalScore += SAME_SITE_BONUS;
      if (isFocused) logger.info(`  🎁 Bonus même site: +${SAME_SITE_BONUS}`);
    }
    
    // PÉNALITÉ: Changement de site
    if (needMatin.site_id !== needAM.site_id) {
      // Exclure les changements impliquant ADMIN (déjà OK, pas de pénalité)
      if (needMatin.site_id !== ADMIN_SITE_ID && needAM.site_id !== ADMIN_SITE_ID) {
        
        // ============================================================
        // RÈGLES GASTRO-ENTÉROLOGIE (basées sur salle_assignee)
        // ============================================================
        const isSalleGastroMatin = needMatin.salle_assignee === SALLE_GASTRO_ID;
        const isSalleGastroAM = needAM.salle_assignee === SALLE_GASTRO_ID;
        
        const isVieilleVilleMatin = needMatin.site_id === VIEILLE_VILLE_SITE_ID;
        const isVieilleVilleAM = needAM.site_id === VIEILLE_VILLE_SITE_ID;
        
        // ✅ CAS 1: Gastro Matin + Gastro Après-midi = Pas de pénalité
        const isBothGastro = isSalleGastroMatin && isSalleGastroAM;
        
        // ✅ CAS 2: Gastro ↔ Vieille Ville Gastro = Pas de pénalité
        const isGastroVieilleVilleChange = 
          (isSalleGastroMatin && isVieilleVilleAM) || 
          (isVieilleVilleMatin && isSalleGastroAM);
        
        // Vérifier si on doit appliquer une pénalité
        const noGastroPenalty = isBothGastro || isGastroVieilleVilleChange;
        
        if (!noGastroPenalty) {
          // Pénalité normale de changement de site
          const isHighPenalty = 
            HIGH_PENALTY_SITES.includes(needMatin.site_id) || 
            HIGH_PENALTY_SITES.includes(needAM.site_id);
          
          const changePenalty = isHighPenalty ? 
            PENALTIES.CHANGEMENT_SITE_HIGH_PENALTY : 
            PENALTIES.CHANGEMENT_SITE;
          
          totalScore += changePenalty;
          if (isFocused) logger.info(`  🔄 Changement de site: ${changePenalty} (high=${isHighPenalty})`);
        }
      }
    }
  }
  
  if (isFocused) logger.info(`  🎯 SCORE COMBO TOTAL: ${totalScore}`);
  
  return totalScore;
}
