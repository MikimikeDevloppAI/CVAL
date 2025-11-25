import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { WeekContext, WeekData } from './types.ts';
import { logger } from './index.ts';
import { ADMIN_SITE_ID } from './types.ts';

// Helper to validate UUID
function isUuid(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

// Helper to parse combo variable name
function parseComboVar(varName: string): {
  secretaire_id: string;
  date: string;
  needMatin: { site_id: string; bloc_id?: string; besoin_id?: string } | null;
  needAM: { site_id: string; bloc_id?: string; besoin_id?: string } | null;
} | null {
  if (!varName.startsWith('combo_')) return null;
  
  const withoutPrefix = varName.slice(6); // Remove "combo_"
  const parts = withoutPrefix.split('_');
  
  if (parts.length < 3) return null;
  
  const secretaire_id = parts[0];
  const date = parts[1];
  
  // Reconstruct needMatin and needAM
  // Format: combo_secId_date_needMatinId_needAMId
  // needId can be: null OR site_date_period OR site_date_period_blocId_besoinId
  
  let currentIdx = 2;
  
  // Parse needMatin
  let needMatin: { site_id: string; bloc_id?: string; besoin_id?: string } | null = null;
  if (parts[currentIdx] === 'null') {
    currentIdx++;
  } else {
    const site_id = parts[currentIdx];
    currentIdx++;
    
    // Skip date (already have it)
    if (parts[currentIdx] === date) currentIdx++;
    
    // Skip period code (1 or 2)
    currentIdx++;
    
    // Check if bloc format (next 2 are UUIDs)
    if (currentIdx + 1 < parts.length && isUuid(parts[currentIdx]) && isUuid(parts[currentIdx + 1])) {
      needMatin = {
        site_id,
        bloc_id: parts[currentIdx],
        besoin_id: parts[currentIdx + 1]
      };
      currentIdx += 2;
    } else {
      needMatin = { site_id };
    }
  }
  
  // Parse needAM
  let needAM: { site_id: string; bloc_id?: string; besoin_id?: string } | null = null;
  if (currentIdx < parts.length && parts[currentIdx] === 'null') {
    // null
  } else if (currentIdx < parts.length) {
    const site_id = parts[currentIdx];
    currentIdx++;
    
    // Skip date
    if (currentIdx < parts.length && parts[currentIdx] === date) currentIdx++;
    
    // Skip period code
    if (currentIdx < parts.length) currentIdx++;
    
    // Check if bloc format
    if (currentIdx + 1 < parts.length && isUuid(parts[currentIdx]) && isUuid(parts[currentIdx + 1])) {
      needAM = {
        site_id,
        bloc_id: parts[currentIdx],
        besoin_id: parts[currentIdx + 1]
      };
    } else {
      needAM = { site_id };
    }
  }
  
  return { secretaire_id, date, needMatin, needAM };
}

/**
 * Écrire les résultats de l'optimisation hebdomadaire globale
 */
export async function writeWeeklyAssignments(
  solution: any,
  weekContext: WeekContext,
  weekData: WeekData,
  supabase: SupabaseClient
): Promise<number> {
  logger.info(`\n📝 Écriture des assignations hebdomadaires globales...`);
  
  // Get bloc site ID
  const { data: blocSiteData } = await supabase
    .from('sites')
    .select('id')
    .ilike('nom', '%bloc%opératoire%')
    .single();
  
  const BLOC_SITE_ID = blocSiteData?.id || '86f1047f-c4ff-441f-a064-42ee2f8ef37a';
  
  // Build capIdMap: secretaire_id|date|periode -> capacite_effective.id
  const capIdMap = new Map<string, string>();
  for (const date of weekContext.dates) {
    const capacites = weekContext.capacities_by_date.get(date) || [];
    for (const cap of capacites) {
      if (cap.actif && cap.secretaire_id) {
        const key = `${cap.secretaire_id}|${cap.date}|${cap.demi_journee}`;
        capIdMap.set(key, cap.id);
      }
    }
  }
  
  logger.info(`  🗺️ capIdMap: ${capIdMap.size} entrées`);
  
  const updates: any[] = [];
  const roleUpdates = new Map<string, { is_1r?: boolean; is_2f?: boolean; is_3f?: boolean }>();
  let assignmentCount = 0;
  
  // ============================================================
  // PHASE 1: Parser tous les combos activés
  // ============================================================
  for (const [varName, value] of Object.entries(solution)) {
    if (!varName.startsWith('combo_')) continue;
    if (Number(value) <= 0.5) continue;
    
    const parsed = parseComboVar(varName);
    if (!parsed) {
      logger.error(`  ❌ Impossible de parser: ${varName}`);
      continue;
    }
    
    const { secretaire_id, date, needMatin, needAM } = parsed;
    
    // Traiter matin
    if (needMatin && needMatin.site_id !== ADMIN_SITE_ID) {
      const key = `${secretaire_id}|${date}|matin`;
      const capId = capIdMap.get(key);
      
      if (!capId) {
        logger.error(`  ❌ Capacité introuvable: ${key}`);
        continue;
      }
      
      // Déterminer si c'est un bloc
      if (needMatin.bloc_id && needMatin.besoin_id) {
        updates.push({
          id: capId,
          site_id: BLOC_SITE_ID,
          planning_genere_bloc_operatoire_id: needMatin.bloc_id,
          besoin_operation_id: needMatin.besoin_id
        });
      } else {
        updates.push({
          id: capId,
          site_id: needMatin.site_id
        });
      }
      
      assignmentCount++;
      
      // Déterminer rôles closing
      const site = weekData.sites.find(s => s.id === needMatin.site_id);
      if (site?.fermeture) {
        const needs3F = weekContext.sites_needing_3f.get(date)?.has(needMatin.site_id);
        
        if (!roleUpdates.has(capId)) {
          roleUpdates.set(capId, {});
        }
        
        const roles = roleUpdates.get(capId)!;
        if (needs3F) {
          roles.is_1r = true;
        } else {
          roles.is_2f = true;
        }
      }
    }
    
    // Traiter après-midi
    if (needAM && needAM.site_id !== ADMIN_SITE_ID) {
      const key = `${secretaire_id}|${date}|apres_midi`;
      const capId = capIdMap.get(key);
      
      if (!capId) {
        logger.error(`  ❌ Capacité introuvable: ${key}`);
        continue;
      }
      
      // Déterminer si c'est un bloc
      if (needAM.bloc_id && needAM.besoin_id) {
        updates.push({
          id: capId,
          site_id: BLOC_SITE_ID,
          planning_genere_bloc_operatoire_id: needAM.bloc_id,
          besoin_operation_id: needAM.besoin_id
        });
      } else {
        updates.push({
          id: capId,
          site_id: needAM.site_id
        });
      }
      
      assignmentCount++;
      
      // Déterminer rôles closing
      const site = weekData.sites.find(s => s.id === needAM.site_id);
      if (site?.fermeture) {
        const needs3F = weekContext.sites_needing_3f.get(date)?.has(needAM.site_id);
        
        if (!roleUpdates.has(capId)) {
          roleUpdates.set(capId, {});
        }
        
        const roles = roleUpdates.get(capId)!;
        if (needs3F) {
          roles.is_1r = true;
        } else {
          roles.is_2f = true;
        }
      }
    }
  }
  
  logger.info(`  ✅ ${updates.length} assignations à écrire`);
  logger.info(`  ✅ ${roleUpdates.size} rôles closing à écrire`);
  
  // ============================================================
  // PHASE 2: Batch updates pour sites/blocs
  // ============================================================
  if (updates.length > 0) {
    const batchSize = 100;
    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize);
      
      for (const update of batch) {
        const { error } = await supabase
          .from('capacite_effective')
          .update({
            site_id: update.site_id,
            planning_genere_bloc_operatoire_id: update.planning_genere_bloc_operatoire_id || null,
            besoin_operation_id: update.besoin_operation_id || null
          })
          .eq('id', update.id);
        
        if (error) {
          logger.error(`  ❌ Erreur update ${update.id}: ${error.message}`);
        }
      }
      
      logger.info(`    ✅ Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(updates.length / batchSize)}`);
    }
  }
  
  // ============================================================
  // PHASE 3: Updates des rôles closing
  // ============================================================
  if (roleUpdates.size > 0) {
    const batchSize = 100;
    const roleUpdateArray = Array.from(roleUpdates.entries());
    
    for (let i = 0; i < roleUpdateArray.length; i += batchSize) {
      const batch = roleUpdateArray.slice(i, i + batchSize);
      
      for (const [capId, roles] of batch) {
        const { error } = await supabase
          .from('capacite_effective')
          .update({
            is_1r: roles.is_1r || false,
            is_2f: roles.is_2f || false,
            is_3f: roles.is_3f || false
          })
          .eq('id', capId);
        
        if (error) {
          logger.error(`  ❌ Erreur update roles ${capId}: ${error.message}`);
        }
      }
      
      logger.info(`    ✅ Roles batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(roleUpdateArray.length / batchSize)}`);
    }
  }
  
  logger.info(`  ✅ Écriture terminée: ${assignmentCount} assignations`);
  
  return assignmentCount;
}
