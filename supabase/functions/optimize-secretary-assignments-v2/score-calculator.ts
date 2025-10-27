import type {
  SiteNeed,
  DynamicContext,
  PreferencesData,
  Secretaire,
  TodayAssignment,
  AssignmentSummary
} from './types.ts';
import { SCORE_WEIGHTS, PENALTIES, ADMIN_SITE_ID, FORBIDDEN_SITES, HIGH_PENALTY_SITES } from './types.ts';

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
  console.log(`\n🎯 Calcul du score pour:`, {
    secretaire_id,
    need: {
      site_id: need.site_id,
      date: need.date,
      periode: need.periode,
      type: need.type
    }
  });
  
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
      console.log(`  ✅ Score BESOIN_OP_PREF_${besoinMatch.preference}: ${besoinScore}`);
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
      console.log(`  ✅ Score MEDECIN_PREF_${medecinMatch.priorite}: ${medecinScore}`);
    }
  }
  
  // 1c. Score SITE
  const siteMatch = preferences.sites.find(
    ss => ss.secretaire_id === secretaire_id && ss.site_id === need.site_id
  );
  if (siteMatch) {
    const siteScore = siteMatch.priorite === '1' ? SCORE_WEIGHTS.SITE_PREF_1 :
                      siteMatch.priorite === '2' ? SCORE_WEIGHTS.SITE_PREF_2 :
                      SCORE_WEIGHTS.SITE_PREF_3;
    positiveScores.push(siteScore);
    console.log(`  ✅ Score SITE_PREF_${siteMatch.priorite}: ${siteScore}`);
  }
  
  console.log(`  📊 Scores positifs trouvés: [${positiveScores.join(', ')}]`);
  
  // Prendre le MAX des scores positifs
  const base_score = positiveScores.length > 0 ? Math.max(...positiveScores) : 0;
  if (base_score > 0) {
    score += base_score;
    console.log(`  🏆 Score BASE (MAX): ${base_score}`);
  }
  
  // ============================================================
  // 2. BONUS ADMIN PROGRESSIF (DYNAMIQUE)
  // ============================================================
  const isAdminSite = need.site_id === ADMIN_SITE_ID;
  
  if (isAdminSite) {
    // Count admin assignments already made (week + today)
    const weekAdminCount = context.week_assignments.filter(
      a => a.secretaire_id === secretaire_id && a.is_admin
    ).length;
    
    const todayAdminCount = countTodayAdminAssignments(
      secretaire_id, 
      need.periode, 
      context.today_assignments
    );
    
    const totalAdminCount = weekAdminCount + todayAdminCount;
    
    // Vérifier si le secrétaire a un objectif de demi-journées admin défini
    if (secretaire.nombre_demi_journees_admin && secretaire.nombre_demi_journees_admin > 0) {
      // Tant qu'on est sous l'objectif : bonus de 90 points
      if (totalAdminCount < secretaire.nombre_demi_journees_admin) {
        const adminBonus = 90;
        score += adminBonus;
        console.log(`  💼💼 Admin (${totalAdminCount}/${secretaire.nombre_demi_journees_admin}): Bonus ${adminBonus}`);
      } else {
        // Au-delà de l'objectif : aucun bonus
        console.log(`  💼 Admin (${totalAdminCount} ≥ ${secretaire.nombre_demi_journees_admin}): Bonus 0`);
      }
    } else {
      // Comportement standard pour les secrétaires sans objectif admin spécifique
      const adminBonus = Math.max(0, PENALTIES.ADMIN_FIRST - totalAdminCount);
      score += adminBonus;
      console.log(`  💼 Admin standard: ${totalAdminCount} assignations → Bonus: ${adminBonus}`);
    }
  }
  
  // ============================================================
  // 3. PÉNALITÉ CHANGEMENT DE SITE (DÉSACTIVÉE - géré par MILP)
  // ============================================================
  // Cette pénalité est maintenant gérée par les variables auxiliaires
  // dans milp-builder.ts avec des contraintes Big-M
  
  // ============================================================
  // 4. PÉNALITÉ SUR-ASSIGNATION SITE PREF 2/3 (DYNAMIQUE)
  // ============================================================
  if (siteMatch && (siteMatch.priorite === '2' || siteMatch.priorite === '3')) {
    // Count assignments to this site (week + today)
    const weekSiteCount = context.week_assignments.filter(
      a => a.secretaire_id === secretaire_id && 
           a.site_id === need.site_id &&
           (a.site_priorite === 2 || a.site_priorite === 3)
    ).length;
    
    const todaySiteCount = countTodaySiteAssignments(
      secretaire_id,
      need.site_id,
      need.periode,
      context.today_assignments
    );
    
    const totalSiteCount = weekSiteCount + todaySiteCount;
    
    // Penalty: -10 per half-day beyond 2
    if (totalSiteCount >= 2) {
      const overload = totalSiteCount - 2;
      const penalty = overload * PENALTIES.SITE_PREF_23_OVERLOAD;
      score += penalty;
      console.log(`  ⚠️ Site pref 2/3 sur-assigné (${totalSiteCount} > 2): ${penalty}`);
    }
  }
  
  // ============================================================
  // 5. PÉNALITÉ BLOC -> SITES INTERDITS (DÉSACTIVÉE - géré par MILP)
  // ============================================================
  // Cette pénalité est maintenant gérée par les variables auxiliaires
  // dans milp-builder.ts avec des contraintes Big-M
  
  console.log(`  🎯 SCORE TOTAL: ${score}`);
  
  return score;
}

// ============================================================
// COMBO SCORE CALCULATION
// ============================================================
export function calculateComboScore(
  secretaire_id: string,
  needMatin: SiteNeed | null,
  needAM: SiteNeed | null,
  week_assignments: AssignmentSummary[],
  preferences: PreferencesData,
  secretaire: Secretaire
): number {
  console.log(`\n🎯 Calcul du score COMBO pour:`, {
    secretaire_id: secretaire_id.slice(0, 8),
    matin: needMatin ? `${needMatin.site_id.slice(0, 8)}...` : 'null',
    am: needAM ? `${needAM.site_id.slice(0, 8)}...` : 'null'
  });
  
  let totalScore = 0;
  
  // Compteurs pour bonus/pénalités progressifs
  let currentAdminCount = week_assignments.filter(
    a => a.secretaire_id === secretaire_id && a.is_admin
  ).length;
  
  const sitesCount = new Map<string, number>();
  for (const assignment of week_assignments) {
    if (assignment.secretaire_id === secretaire_id && 
        assignment.site_priorite && 
        (assignment.site_priorite === 2 || assignment.site_priorite === 3)) {
      const count = sitesCount.get(assignment.site_id) || 0;
      sitesCount.set(assignment.site_id, count + 1);
    }
  }
  
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
        console.log(`  ✅ MATIN BESOIN_OP_PREF_${besoinMatch.preference}: ${besoinScore}`);
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
        console.log(`  ✅ MATIN MEDECIN_PREF_${medecinMatch.priorite}: ${medecinScore}`);
      }
    }
    
    // 1c. Site
    const siteMatchMatin = preferences.sites.find(
      ss => ss.secretaire_id === secretaire_id && ss.site_id === needMatin.site_id
    );
    if (siteMatchMatin) {
      const siteScore = siteMatchMatin.priorite === '1' ? SCORE_WEIGHTS.SITE_PREF_1 :
                        siteMatchMatin.priorite === '2' ? SCORE_WEIGHTS.SITE_PREF_2 :
                        SCORE_WEIGHTS.SITE_PREF_3;
      positiveScores.push(siteScore);
      console.log(`  ✅ MATIN SITE_PREF_${siteMatchMatin.priorite}: ${siteScore}`);
    }
    
    // Prendre le MAX
    const matinBaseScore = positiveScores.length > 0 ? Math.max(...positiveScores) : 0;
    totalScore += matinBaseScore;
    console.log(`  🌅 Score MATIN BASE: ${matinBaseScore}`);
    
    // 1d. Bonus admin progressif (MATIN)
    if (needMatin.site_id === ADMIN_SITE_ID) {
      if (secretaire.nombre_demi_journees_admin && secretaire.nombre_demi_journees_admin > 0) {
        if (currentAdminCount < secretaire.nombre_demi_journees_admin) {
          totalScore += 90;
          console.log(`  💼💼 MATIN Admin (${currentAdminCount}/${secretaire.nombre_demi_journees_admin}): +90`);
        } else {
          console.log(`  💼 MATIN Admin (${currentAdminCount} ≥ ${secretaire.nombre_demi_journees_admin}): +0`);
        }
      } else {
        const adminBonus = Math.max(0, PENALTIES.ADMIN_FIRST - currentAdminCount);
        totalScore += adminBonus;
        console.log(`  💼 MATIN Admin standard (${currentAdminCount}): +${adminBonus}`);
      }
      currentAdminCount++; // Incrémenter pour l'après-midi
    }
    
    // 1e. Pénalité sur-assignation site P2/P3 (MATIN)
    if (siteMatchMatin && (siteMatchMatin.priorite === '2' || siteMatchMatin.priorite === '3')) {
      const currentSiteCount = sitesCount.get(needMatin.site_id) || 0;
      if (currentSiteCount >= 2) {
        const overload = currentSiteCount - 2;
        const penalty = overload * PENALTIES.SITE_PREF_23_OVERLOAD;
        totalScore += penalty;
        console.log(`  ⚠️ MATIN Site P${siteMatchMatin.priorite} sur-assigné (${currentSiteCount} > 2): ${penalty}`);
      }
      // Incrémenter pour l'après-midi
      sitesCount.set(needMatin.site_id, currentSiteCount + 1);
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
        console.log(`  ✅ AM BESOIN_OP_PREF_${besoinMatch.preference}: ${besoinScore}`);
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
        console.log(`  ✅ AM MEDECIN_PREF_${medecinMatch.priorite}: ${medecinScore}`);
      }
    }
    
    // 2c. Site
    const siteMatchAM = preferences.sites.find(
      ss => ss.secretaire_id === secretaire_id && ss.site_id === needAM.site_id
    );
    if (siteMatchAM) {
      const siteScore = siteMatchAM.priorite === '1' ? SCORE_WEIGHTS.SITE_PREF_1 :
                        siteMatchAM.priorite === '2' ? SCORE_WEIGHTS.SITE_PREF_2 :
                        SCORE_WEIGHTS.SITE_PREF_3;
      positiveScores.push(siteScore);
      console.log(`  ✅ AM SITE_PREF_${siteMatchAM.priorite}: ${siteScore}`);
    }
    
    // Prendre le MAX
    const amBaseScore = positiveScores.length > 0 ? Math.max(...positiveScores) : 0;
    totalScore += amBaseScore;
    console.log(`  🌇 Score AM BASE: ${amBaseScore}`);
    
    // 2d. Bonus admin progressif (AM)
    if (needAM.site_id === ADMIN_SITE_ID) {
      if (secretaire.nombre_demi_journees_admin && secretaire.nombre_demi_journees_admin > 0) {
        if (currentAdminCount < secretaire.nombre_demi_journees_admin) {
          totalScore += 90;
          console.log(`  💼💼 AM Admin (${currentAdminCount}/${secretaire.nombre_demi_journees_admin}): +90`);
        } else {
          console.log(`  💼 AM Admin (${currentAdminCount} ≥ ${secretaire.nombre_demi_journees_admin}): +0`);
        }
      } else {
        const adminBonus = Math.max(0, PENALTIES.ADMIN_FIRST - currentAdminCount);
        totalScore += adminBonus;
        console.log(`  💼 AM Admin standard (${currentAdminCount}): +${adminBonus}`);
      }
    }
    
    // 2e. Pénalité sur-assignation site P2/P3 (AM)
    if (siteMatchAM && (siteMatchAM.priorite === '2' || siteMatchAM.priorite === '3')) {
      const currentSiteCount = sitesCount.get(needAM.site_id) || 0;
      if (currentSiteCount >= 2) {
        const overload = currentSiteCount - 2;
        const penalty = overload * PENALTIES.SITE_PREF_23_OVERLOAD;
        totalScore += penalty;
        console.log(`  ⚠️ AM Site P${siteMatchAM.priorite} sur-assigné (${currentSiteCount} > 2): ${penalty}`);
      }
    }
  }
  
  // ============================================================
  // 3. PÉNALITÉ CHANGEMENT DE SITE
  // ============================================================
  if (needMatin && needAM && needMatin.site_id !== needAM.site_id) {
    // Exclure les changements impliquant ADMIN
    if (needMatin.site_id !== ADMIN_SITE_ID && needAM.site_id !== ADMIN_SITE_ID) {
      const isHighPenalty = 
        HIGH_PENALTY_SITES.includes(needMatin.site_id) || 
        HIGH_PENALTY_SITES.includes(needAM.site_id);
      
      const changePenalty = isHighPenalty ? 
        PENALTIES.CHANGEMENT_SITE_HIGH_PENALTY : 
        PENALTIES.CHANGEMENT_SITE;
      
      totalScore += changePenalty;
      console.log(`  🔄 Changement de site: ${changePenalty} (high=${isHighPenalty})`);
    }
  }
  
  console.log(`  🎯 SCORE COMBO TOTAL: ${totalScore}`);
  
  return totalScore;
}
