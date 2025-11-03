import type {
  SiteNeed,
  Secretaire,
  AssignmentSummary,
  PreferencesData,
  DynamicContext
} from './types.ts';
import { 
  ADMIN_SITE_ID, 
  SCORE_WEIGHTS, 
  PENALTIES, 
  HIGH_PENALTY_SITES,
  SAME_SITE_BONUS,
  ESPLANADE_OPHTALMOLOGIE_SITE_ID,
  VIEILLE_VILLE_SITE_ID,
  SALLE_GASTRO_ID
} from './types.ts';

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

// Helper to count UNIQUE DAYS for P2/P3/P4 sites (Esplanade only)
function countWeekSiteDays(
  secretaire_id: string,
  site_id: string,
  week_assignments: AssignmentSummary[]
): Set<string> {
  const dates = new Set<string>();
  week_assignments
    .filter(
      a => a.secretaire_id === secretaire_id && 
           a.site_id === site_id &&
           a.site_priorite && 
           (a.site_priorite === 2 || a.site_priorite === 3 || a.site_priorite === 4)
    )
    .forEach(a => dates.add(a.date));
  return dates;
}

// Calculate score for a combo (morning + afternoon)
// SCORING: Same as assign-v2 but with +200 bonus per half-day for current state conservation
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
  
  // Map pour tracker les JOURS uniques visités (uniquement Esplanade)
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
    }
    
    // Prendre le MAX (identique à v2, sans bonus +100)
    const matinBaseScore = positiveScores.length > 0 ? Math.max(...positiveScores) : 0;
    if (matinBaseScore > 0) {
      totalScore += matinBaseScore;
    }
    
    // 1d. Bonus de conservation pour le MATIN (+200)
    if (currentState) {
      const state = currentState.get(secretaire_id);
      if (state) {
        let isMatinConserved = false;
        
        if (needMatin.site_id === ADMIN_SITE_ID) {
          // Pour ADMIN : juste vérifier le site_id
          isMatinConserved = state.matin_site_id === ADMIN_SITE_ID;
        } else if (needMatin.type === 'bloc_operatoire') {
          // Pour BLOC : vérifier site_id + besoin_operation_id + bloc_operation_id
          isMatinConserved = 
            state.matin_site_id === needMatin.site_id &&
            state.matin_besoin_op_id === needMatin.besoin_operation_id &&
            state.matin_bloc_op_id === needMatin.bloc_operation_id;
        } else {
          // Pour sites normaux : juste vérifier le site_id
          isMatinConserved = state.matin_site_id === needMatin.site_id;
        }
        
        if (isMatinConserved) {
          console.log(`  ✅ BONUS CONSERVATION MATIN: +200 pour ${secretaire.first_name} ${secretaire.name}`);
          totalScore += 200;
        }
      }
    }
    
    // 1e. Bonus admin progressif (MATIN)
    if (needMatin.site_id === ADMIN_SITE_ID) {
      if (secretaire.nombre_demi_journees_admin && secretaire.nombre_demi_journees_admin > 0) {
        if (currentAdminCount < secretaire.nombre_demi_journees_admin) {
          totalScore += 200;
        } else {
          totalScore += 1;
        }
      } else {
        const adminBonus = Math.max(0, PENALTIES.ADMIN_FIRST - currentAdminCount);
        totalScore += adminBonus;
      }
      currentAdminCount++; // Incrémenter pour l'après-midi
    }
    
    // 1f. Pénalité sur-assignation site P2/P3/P4 (MATIN) - uniquement Esplanade Ophtalmologie
    if (siteMatchMatin && 
        (siteMatchMatin.priorite === '2' || siteMatchMatin.priorite === '3' || siteMatchMatin.priorite === '4') &&
        needMatin.site_id === ESPLANADE_OPHTALMOLOGIE_SITE_ID) {
      
      // Obtenir le nombre de JOURS CETTE SEMAINE
      const weekDaysSet = countWeekSiteDays(secretaire_id, needMatin.site_id, currentAssignments);
      const weekDaysCount = weekDaysSet.size;
      
      // Compter aujourd'hui comme un nouveau jour
      const totalDays = weekDaysCount + 1;
      
      // Pénalité dès le 2ème jour
      if (totalDays >= 2) {
        const penalty = (totalDays - 1) * PENALTIES.SITE_PREF_234_OVERLOAD;
        totalScore += penalty;
      }
      
      // Marquer que ce site a été visité AUJOURD'HUI
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
    
    // Prendre le MAX (identique à v2, sans bonus +100)
    const amBaseScore = positiveScores.length > 0 ? Math.max(...positiveScores) : 0;
    if (amBaseScore > 0) {
      totalScore += amBaseScore;
    }
    
    // 2d. Bonus de conservation pour l'APRÈS-MIDI (+200)
    if (currentState) {
      const state = currentState.get(secretaire_id);
      if (state) {
        let isAMConserved = false;
        
        if (needAM.site_id === ADMIN_SITE_ID) {
          // Pour ADMIN : juste vérifier le site_id
          isAMConserved = state.am_site_id === ADMIN_SITE_ID;
        } else if (needAM.type === 'bloc_operatoire') {
          // Pour BLOC : vérifier site_id + besoin_operation_id + bloc_operation_id
          isAMConserved = 
            state.am_site_id === needAM.site_id &&
            state.am_besoin_op_id === needAM.besoin_operation_id &&
            state.am_bloc_op_id === needAM.bloc_operation_id;
        } else {
          // Pour sites normaux : juste vérifier le site_id
          isAMConserved = state.am_site_id === needAM.site_id;
        }
        
        if (isAMConserved) {
          console.log(`  ✅ BONUS CONSERVATION AM: +200 pour ${secretaire.first_name} ${secretaire.name}`);
          totalScore += 200;
        }
      }
    }
    
    // 2e. Bonus admin progressif (AM)
    if (needAM.site_id === ADMIN_SITE_ID) {
      if (secretaire.nombre_demi_journees_admin && secretaire.nombre_demi_journees_admin > 0) {
        if (currentAdminCount < secretaire.nombre_demi_journees_admin) {
          totalScore += 200;
        } else {
          totalScore += 1;
        }
      } else {
        const adminBonus = Math.max(0, PENALTIES.ADMIN_FIRST - currentAdminCount);
        totalScore += adminBonus;
      }
    }
    
    // 2f. Pénalité sur-assignation site P2/P3/P4 (AM) - uniquement Esplanade Ophtalmologie
    if (siteMatchAM && 
        (siteMatchAM.priorite === '2' || siteMatchAM.priorite === '3' || siteMatchAM.priorite === '4') &&
        needAM.site_id === ESPLANADE_OPHTALMOLOGIE_SITE_ID) {
      
      // Obtenir le nombre de JOURS CETTE SEMAINE
      const weekDaysSet = countWeekSiteDays(secretaire_id, needAM.site_id, currentAssignments);
      const weekDaysCount = weekDaysSet.size;
      
      // Vérifier si DÉJÀ ASSIGNÉE CE MATIN au même site Esplanade
      const alreadyCountedToday = siteDaysCount.has(needAM.site_id);
      
      // Si pas encore comptée aujourd'hui → +1 jour
      // Si déjà comptée ce matin → utiliser le compte du matin (pas de nouveau jour)
      const totalDays = alreadyCountedToday ? siteDaysCount.get(needAM.site_id)! : weekDaysCount + 1;
      
      // Pénalité dès le 2ème jour
      if (totalDays >= 2) {
        // Si déjà pénalisé ce matin, ne pas re-pénaliser
        if (!alreadyCountedToday) {
          const penalty = (totalDays - 1) * PENALTIES.SITE_PREF_234_OVERLOAD;
          totalScore += penalty;
        }
      }
    }
  }
  
  // ============================================================
  // 3. BONUS MÊME SITE + PÉNALITÉ CHANGEMENT DE SITE
  // ============================================================
  if (needMatin && needAM) {
    // Bonus pour même site matin + après-midi (hors ADMIN)
    if (needMatin.site_id === needAM.site_id && needMatin.site_id !== ADMIN_SITE_ID) {
      totalScore += SAME_SITE_BONUS;
    }
    
    // Pénalité pour changement de site
    if (needMatin.site_id !== needAM.site_id) {
      // Exclure les changements impliquant ADMIN
      if (needMatin.site_id !== ADMIN_SITE_ID && needAM.site_id !== ADMIN_SITE_ID) {
        
        // ============================================================
        // RÈGLES GASTRO-ENTÉROLOGIE (basées sur salle_assignee)
        // ============================================================
        const isSalleGastroMatin = needMatin.salle_assignee === SALLE_GASTRO_ID;
        const isSalleGastroAM = needAM.salle_assignee === SALLE_GASTRO_ID;
        
        const isVieilleVilleMatin = needMatin.site_id === VIEILLE_VILLE_SITE_ID;
        const isVieilleVilleAM = needAM.site_id === VIEILLE_VILLE_SITE_ID;
        
        // CAS 1: Gastro Matin + Gastro Après-midi = Pas de pénalité
        const isBothGastro = isSalleGastroMatin && isSalleGastroAM;
        
        // CAS 2: Gastro ↔ Vieille Ville Gastro = Pas de pénalité
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
        }
      }
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
