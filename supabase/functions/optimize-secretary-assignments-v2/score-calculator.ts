import type {
  SiteNeed,
  DynamicContext,
  PreferencesData,
  Secretaire,
  TodayAssignment
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
    
    // Bonus spécial pour les secrétaires avec prefered_admin
    if (secretaire.prefered_admin) {
      // Objectif : 2 demi-journées admin minimum
      if (totalAdminCount < 2) {
        // Bonus fixe de 90 pour les 2 premières demi-journées
        const adminBonus = 90;
        score += adminBonus;
        console.log(`  💼💼 Admin PRÉFÉRÉ (${totalAdminCount}/2): Bonus ${adminBonus}`);
      } else {
        // À partir de la 3ème demi-journée admin : bonus fixe de 6 points
        const adminBonus = 6;
        score += adminBonus;
        console.log(`  💼 Admin PRÉFÉRÉ (${totalAdminCount} ≥ 2): Bonus ${adminBonus}`);
      }
    } else {
      // Bonus dégressif standard pour les autres (10, 9, 8, 7...)
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
