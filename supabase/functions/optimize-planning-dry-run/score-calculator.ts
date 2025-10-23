import type {
  SiteNeed,
  Secretaire,
  AssignmentSummary,
  PreferencesData,
  DynamicContext
} from './types.ts';
import { ADMIN_SITE_ID } from './types.ts';

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

// Calculate score for a combo (morning + afternoon)
// SCORING: +100 for all preferences, -20 per half-day change from current state
export function calculateComboScore(
  secretaire_id: string,
  needMatin: SiteNeed | null,
  needAM: SiteNeed | null,
  currentAssignments: AssignmentSummary[],
  preferences: PreferencesData,
  secretaire: Secretaire
): number {
  let score = 0;
  const date = needMatin?.date || needAM?.date;
  if (!date) return score;

  // Get current assignments for comparison
  const currentMatin = getCurrentAssignment(secretaire_id, date, 'matin', currentAssignments);
  const currentAM = getCurrentAssignment(secretaire_id, date, 'apres_midi', currentAssignments);

  // ====================
  // MORNING PERIOD
  // ====================
  if (needMatin) {
    // +100 for preferences (besoin operation, site)
    if (needMatin.type === 'bloc_operatoire' && needMatin.besoin_operation_id) {
      const pref = preferences.besoins.find(
        b => b.secretaire_id === secretaire_id && b.besoin_operation_id === needMatin.besoin_operation_id
      );
      if (pref) {
        score += 100; // Always +100 for any preference level
      }
    }

    if (needMatin.site_id !== ADMIN_SITE_ID) {
      const sitePref = preferences.sites.find(
        s => s.secretaire_id === secretaire_id && s.site_id === needMatin.site_id
      );
      if (sitePref) {
        score += 100; // Always +100 for any site preference
      }
    }

    // -20 if different from current state (EXCEPT if moving from admin to another site)
    if (currentMatin) {
      const isChangingFromAdmin = currentMatin.site_id === ADMIN_SITE_ID && needMatin.site_id !== ADMIN_SITE_ID;
      if (!isChangingFromAdmin && currentMatin.site_id !== needMatin.site_id) {
        score -= 20;
      }
    } else {
      // No current assignment, so creating new one = -20
      score -= 20;
    }
  } else {
    // Null morning = admin
    // -20 if it was not admin before
    if (currentMatin && currentMatin.site_id !== ADMIN_SITE_ID) {
      score -= 20;
    }
  }

  // ====================
  // AFTERNOON PERIOD
  // ====================
  if (needAM) {
    // +100 for preferences (besoin operation, site)
    if (needAM.type === 'bloc_operatoire' && needAM.besoin_operation_id) {
      const pref = preferences.besoins.find(
        b => b.secretaire_id === secretaire_id && b.besoin_operation_id === needAM.besoin_operation_id
      );
      if (pref) {
        score += 100; // Always +100 for any preference level
      }
    }

    if (needAM.site_id !== ADMIN_SITE_ID) {
      const sitePref = preferences.sites.find(
        s => s.secretaire_id === secretaire_id && s.site_id === needAM.site_id
      );
      if (sitePref) {
        score += 100; // Always +100 for any site preference
      }
    }

    // -20 if different from current state (EXCEPT if moving from admin to another site)
    if (currentAM) {
      const isChangingFromAdmin = currentAM.site_id === ADMIN_SITE_ID && needAM.site_id !== ADMIN_SITE_ID;
      if (!isChangingFromAdmin && currentAM.site_id !== needAM.site_id) {
        score -= 20;
      }
    } else {
      // No current assignment, so creating new one = -20
      score -= 20;
    }
  } else {
    // Null afternoon = admin
    // -20 if it was not admin before
    if (currentAM && currentAM.site_id !== ADMIN_SITE_ID) {
      score -= 20;
    }
  }

  return score;
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
