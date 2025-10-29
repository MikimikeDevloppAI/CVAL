import type {
  SiteNeed,
  Secretaire,
  AssignmentSummary,
  PreferencesData,
  DynamicContext
} from './types.ts';
import { ADMIN_SITE_ID, SCORE_WEIGHTS, PENALTIES, HIGH_PENALTY_SITES } from './types.ts';

// Helper to find current assignment for a secretaire on the target date
function getCurrentAssignment(
  secretaire_id: string,
  date: string,
  periode: 'matin' | 'apres_midi',
  currentAssignments: AssignmentSummary[]
): AssignmentSummary | null {
  return currentAssignments.find(
    a => a.secretaire_id === secretaire_id && a.date === date && a.periode === periode
  ) || null;
}

// Helper to count admin assignments in week (not including current day)
function countWeekAdminAssignments(
  secretaire_id: string,
  week_assignments: AssignmentSummary[]
): number {
  return week_assignments.filter(
    a => a.secretaire_id === secretaire_id && a.is_admin
  ).length;
}

// Helper to count site assignments in week for P2/P3/P4 sites
function countWeekSiteAssignments(
  secretaire_id: string,
  site_id: string,
  week_assignments: AssignmentSummary[]
): number {
  return week_assignments.filter(
    a => a.secretaire_id === secretaire_id && 
         a.site_id === site_id &&
         a.site_priorite && 
         (a.site_priorite === 2 || a.site_priorite === 3 || a.site_priorite === 4)
  ).length;
}

// Calculate score for a combo (morning + afternoon)
// SCORING: Same as assign-v2 but with optional +100 bonus for current state match
export function calculateComboScore(
  secretaire_id: string,
  needMatin: SiteNeed | null,
  needAM: SiteNeed | null,
  currentAssignments: AssignmentSummary[],
  preferences: PreferencesData,
  secretaire: Secretaire,
  currentState?: Map<string, import('./types.ts').CurrentState>
): number {
  let totalScore = 0;
  
  // Compteurs pour bonus/pénalités progressifs
  let currentAdminCount = countWeekAdminAssignments(secretaire_id, currentAssignments);
  
  const sitesCount = new Map<string, number>();
  for (const assignment of currentAssignments) {
    if (assignment.secretaire_id === secretaire_id && 
        assignment.site_priorite && 
        (assignment.site_priorite === 2 || assignment.site_priorite === 3 || assignment.site_priorite === 4)) {
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
    }
    
    // Prendre le MAX (identique à v2, sans bonus +100)
    const matinBaseScore = positiveScores.length > 0 ? Math.max(...positiveScores) : 0;
    if (matinBaseScore > 0) {
      totalScore += matinBaseScore;
    }
    
    // 1d. Bonus admin progressif (MATIN)
    if (needMatin.site_id === ADMIN_SITE_ID) {
      if (secretaire.nombre_demi_journees_admin && secretaire.nombre_demi_journees_admin > 0) {
        if (currentAdminCount < secretaire.nombre_demi_journees_admin) {
          totalScore += 90;
        } else {
          // +0 au-delà de l'objectif
        }
      } else {
        const adminBonus = Math.max(0, PENALTIES.ADMIN_FIRST - currentAdminCount);
        totalScore += adminBonus;
      }
      currentAdminCount++; // Incrémenter pour l'après-midi
    }
    
    // 1e. Pénalité sur-assignation site P2/P3/P4 (MATIN)
    if (siteMatchMatin && (siteMatchMatin.priorite === '2' || siteMatchMatin.priorite === '3' || siteMatchMatin.priorite === '4')) {
      const currentSiteCount = sitesCount.get(needMatin.site_id) || 0;
      if (currentSiteCount >= 2) {
        const overload = currentSiteCount - 2;
        const penalty = overload * PENALTIES.SITE_PREF_234_OVERLOAD;
        totalScore += penalty;
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
    
    // Prendre le MAX (identique à v2, sans bonus +100)
    const amBaseScore = positiveScores.length > 0 ? Math.max(...positiveScores) : 0;
    if (amBaseScore > 0) {
      totalScore += amBaseScore;
    }
    
    // 2d. Bonus admin progressif (AM)
    if (needAM.site_id === ADMIN_SITE_ID) {
      if (secretaire.nombre_demi_journees_admin && secretaire.nombre_demi_journees_admin > 0) {
        if (currentAdminCount < secretaire.nombre_demi_journees_admin) {
          totalScore += 90;
        } else {
          // +0 au-delà de l'objectif
        }
      } else {
        const adminBonus = Math.max(0, PENALTIES.ADMIN_FIRST - currentAdminCount);
        totalScore += adminBonus;
      }
    }
    
    // 2e. Pénalité sur-assignation site P2/P3/P4 (AM)
    if (siteMatchAM && (siteMatchAM.priorite === '2' || siteMatchAM.priorite === '3' || siteMatchAM.priorite === '4')) {
      const currentSiteCount = sitesCount.get(needAM.site_id) || 0;
      if (currentSiteCount >= 2) {
        const overload = currentSiteCount - 2;
        const penalty = overload * PENALTIES.SITE_PREF_234_OVERLOAD;
        totalScore += penalty;
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
    }
  }
  
  // ============================================================
  // 4. BONUS +100 PAR DEMI-JOURNÉE SI COMBO CORRESPOND À L'ÉTAT ACTUEL (Y COMPRIS ADMIN)
  // ============================================================
  if (currentState) {
    const state = currentState.get(secretaire_id);
    if (state) {
      console.log(`  📋 État actuel: Matin=${state.matin_site_id?.slice(0,8)} (besoin=${state.matin_besoin_op_id?.slice(0,8)}, bloc=${state.matin_bloc_op_id?.slice(0,8)}), AM=${state.am_site_id?.slice(0,8)} (besoin=${state.am_besoin_op_id?.slice(0,8)}, bloc=${state.am_bloc_op_id?.slice(0,8)})`);
      console.log(`  🔍 Combo proposé: Matin=${needMatin?.site_id?.slice(0,8)} (type=${needMatin?.type}${needMatin?.type === 'bloc_operatoire' ? `, bloc=${needMatin.bloc_operation_id?.slice(0,8)}, besoin=${needMatin.besoin_operation_id?.slice(0,8)}` : ''}), AM=${needAM?.site_id?.slice(0,8)} (type=${needAM?.type}${needAM?.type === 'bloc_operatoire' ? `, bloc=${needAM.bloc_operation_id?.slice(0,8)}, besoin=${needAM.besoin_operation_id?.slice(0,8)}` : ''})`);
      
      // Détection ADMIN: null OU explicite (site_id === ADMIN_SITE_ID)
      const isAdminComboMatin = (needMatin === null) || (needMatin?.type === 'site' && needMatin.site_id === ADMIN_SITE_ID);
      const isAdminComboAM = (needAM === null) || (needAM?.type === 'site' && needAM.site_id === ADMIN_SITE_ID);
      
      const matchesMatin = (
        (isAdminComboMatin && state.matin_site_id === ADMIN_SITE_ID) ||
        (needMatin && needMatin.type === 'site' && needMatin.site_id === state.matin_site_id) ||
        (needMatin && needMatin.type === 'bloc_operatoire' && 
         needMatin.bloc_operation_id === state.matin_bloc_op_id &&
         needMatin.besoin_operation_id === state.matin_besoin_op_id)
      );
      
      const matchesAM = (
        (isAdminComboAM && state.am_site_id === ADMIN_SITE_ID) ||
        (needAM && needAM.type === 'site' && needAM.site_id === state.am_site_id) ||
        (needAM && needAM.type === 'bloc_operatoire' && 
         needAM.bloc_operation_id === state.am_bloc_op_id &&
         needAM.besoin_operation_id === state.am_besoin_op_id)
      );
      
      console.log(`  🔍 Match matin: ${matchesMatin}, Match AM: ${matchesAM}`);
      
      // Bonus: +200 par demi-journée qui conserve l'état actuel (Y COMPRIS ADMIN)
      let bonus = 0;
      
      if (matchesMatin) {
        bonus += 200;
        if (isAdminComboMatin) {
          console.log(`  🎯 BONUS +200 matin: état ADMIN conservé (${needMatin === null ? 'null' : 'explicite'}) ✅`);
        } else if (needMatin?.type === 'bloc_operatoire') {
          console.log(`  🎯 BONUS +200 matin: session BLOC + besoin conservés ✅`);
        } else {
          console.log(`  🎯 BONUS +200 matin: site conservé ✅`);
        }
      }
      
      if (matchesAM) {
        bonus += 200;
        if (isAdminComboAM) {
          console.log(`  🎯 BONUS +200 AM: état ADMIN conservé (${needAM === null ? 'null' : 'explicite'}) ✅`);
        } else if (needAM?.type === 'bloc_operatoire') {
          console.log(`  🎯 BONUS +200 AM: session BLOC + besoin conservés ✅`);
        } else {
          console.log(`  🎯 BONUS +200 AM: site conservé ✅`);
        }
      }
      
      if (bonus === 0) {
        console.log(`  ❌ Pas de bonus (aucun match avec état actuel)`);
      }
      
      totalScore += bonus;
    } else {
      console.log(`  ℹ️ Pas d'état actuel trouvé pour cette secrétaire`);
    }
  }
  
  return totalScore;
}

// Stub function for compatibility with existing milp-builder
// This is not used in the new combo-based approach
export function calculateDynamicScore(
  _secretaire_id: string,
  _need: SiteNeed,
  _context: DynamicContext,
  _preferences: PreferencesData,
  _secretaire: Secretaire
): number {
  return 0; // Not used in dry-run
}
