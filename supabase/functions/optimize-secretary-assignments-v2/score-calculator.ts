import type {
  SiteNeed,
  DynamicContext,
  PreferencesData,
  Secretaire,
  TodayAssignment
} from './types.ts';
import { SCORE_WEIGHTS, PENALTIES, ADMIN_SITE_ID, FORBIDDEN_SITES } from './types.ts';

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
                      SCORE_WEIGHTS.SITE_PREF_3;
    positiveScores.push(siteScore);
  }
  
  // Prendre le MAX des scores positifs
  if (positiveScores.length > 0) {
    score += Math.max(...positiveScores);
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
    
    // Bonus dégressif : 10, 9, 8, ..., 0
    const adminBonus = Math.max(0, PENALTIES.ADMIN_FIRST - totalAdminCount);
    score += adminBonus;
  }
  
  // ============================================================
  // 3. PÉNALITÉ CHANGEMENT DE SITE (DYNAMIQUE)
  // ============================================================
  if (need.periode === 'apres_midi') {
    // Check morning assignment (today or existing)
    const todayAssignment = context.today_assignments.get(secretaire_id);
    const morningAssignment = todayAssignment?.matin || 
      context.week_assignments.find(
        a => a.secretaire_id === secretaire_id && 
             a.date === need.date && 
             a.periode === 'matin'
      );
    
    if (morningAssignment) {
      const morning_site_id = morningAssignment.site_id;
      
      // Site change detected
      if (morning_site_id !== need.site_id) {
        // Don't penalize if admin is involved
        const isAdminInvolved = 
          morning_site_id === ADMIN_SITE_ID ||
          need.site_id === ADMIN_SITE_ID;
        
        if (!isAdminInvolved) {
          score += PENALTIES.CHANGEMENT_SITE;
        }
      }
    }
  }
  
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
      score += overload * PENALTIES.SITE_PREF_23_OVERLOAD;
    }
  }
  
  // ============================================================
  // 5. PÉNALITÉ BLOC -> SITES INTERDITS (DYNAMIQUE)
  // ============================================================
  
  // If this assignment is to a forbidden site
  if (FORBIDDEN_SITES.includes(need.site_id)) {
    // Check if assigned to bloc on the OTHER half-day
    const otherPeriode = need.periode === 'matin' ? 'apres_midi' : 'matin';
    
    const todayAssignment = context.today_assignments.get(secretaire_id);
    const otherAssignment = todayAssignment?.[otherPeriode] ||
      context.week_assignments.find(
        a => a.secretaire_id === secretaire_id && 
             a.date === need.date && 
             a.periode === otherPeriode
      );
    
    if (otherAssignment && otherAssignment.is_bloc) {
      score += PENALTIES.BLOC_EXCLUSION;
    }
  }
  
  // If this assignment is to BLOC
  if (need.type === 'bloc_operatoire') {
    // Check if assigned to forbidden site on the OTHER half-day
    const otherPeriode = need.periode === 'matin' ? 'apres_midi' : 'matin';
    
    const todayAssignment = context.today_assignments.get(secretaire_id);
    const otherAssignment = todayAssignment?.[otherPeriode] ||
      context.week_assignments.find(
        a => a.secretaire_id === secretaire_id && 
             a.date === need.date && 
             a.periode === otherPeriode
      );
    
    if (otherAssignment && FORBIDDEN_SITES.includes(otherAssignment.site_id)) {
      score += PENALTIES.BLOC_EXCLUSION;
    }
  }
  
  return score;
}
