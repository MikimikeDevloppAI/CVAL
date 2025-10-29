import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { SiteNeed, CapaciteEffective } from './types.ts';

// Helper function to validate UUID format
function isUuid(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

// Helper to parse needId from combo variable
function parseNeedId(needId: string, date: string): {
  site_id: string;
  periode: 'matin' | 'apres_midi';
  type: 'site' | 'bloc_operatoire';
  bloc_operation_id?: string;
  besoin_operation_id?: string;
} | null {
  if (needId === 'null') return null;
  
  const parts = needId.split('_');
  
  // Format 1: site_id_date_periodCode (regular site)
  // Format 2: site_id_date_periodCode_bloc_op_id_besoin_op_id (bloc)
  
  if (parts.length < 3) return null;
  
  const site_id = parts[0];
  const needDate = parts[1];
  const periodCode = parts[2];
  
  if (needDate !== date) return null;
  
  const periode = periodCode === '1' ? 'matin' : 'apres_midi';
  
  if (parts.length >= 5 && isUuid(parts[3]) && isUuid(parts[4])) {
    // Bloc format
    return {
      site_id,
      periode,
      type: 'bloc_operatoire',
      bloc_operation_id: parts[3],
      besoin_operation_id: parts[4]
    };
  } else {
    // Regular site format
    return {
      site_id,
      periode,
      type: 'site'
    };
  }
}

export async function writeAssignments(
  solution: any,
  date: string,
  needs: SiteNeed[],
  capacites: CapaciteEffective[],
  supabase: SupabaseClient
) {
  console.log(`\n📝 Écriture des assignations pour ${date}...`);
  
  // Get bloc site ID
  const { data: blocSiteData } = await supabase
    .from('sites')
    .select('id')
    .ilike('nom', '%bloc%opératoire%')
    .single();
  
  const BLOC_SITE_ID = blocSiteData?.id || '86f1047f-c4ff-441f-a064-42ee2f8ef37a';
  
  // Build capIdMap: secretaire_id|date|periode -> capacite_effective.id
  const capIdMap = new Map<string, string>();
  for (const cap of capacites) {
    if (cap.actif && cap.secretaire_id) {
      const key = `${cap.secretaire_id}|${cap.date}|${cap.demi_journee}`;
      capIdMap.set(key, cap.id);
    }
  }
  console.log(`  🗺️ capIdMap construit: ${capIdMap.size} entrées actives`);
  
  const updates: any[] = [];
  const roleUpdates: Map<string, { is_1r?: boolean, is_2f?: boolean, is_3f?: boolean }> = new Map();
  const roleSiteEnforcements: Array<{ secId: string; siteId: string }> = [];
  const roleSiteKeys = new Set<string>();
  let blocCount = 0;
  let siteCount = 0;
  
  // PHASE 1: Parse combo variables for site assignments
  for (const [varName, value] of Object.entries(solution)) {
    if (!varName.startsWith('combo_')) continue;
    if (Number(value) <= 0.5) continue;
    
    // Format: combo_secretaire_id_needMatinId_needAMId
    const withoutPrefix = varName.slice(6); // Remove "combo_"
    const parts = withoutPrefix.split('_');
    
    // First part is secretaire_id (UUID)
    const secretaire_id = parts[0];
    
    let needMatinId = '';
    let needAMId = '';
    let idx = 1; // Start after secretaire_id
    
    // Parse needMatinId
    if (parts[idx] === 'null') {
      needMatinId = 'null';
      idx++;
    } else {
      // Check if it's a bloc need (5 parts) or regular (3 parts)
      if (idx + 4 < parts.length && isUuid(parts[idx + 3]) && isUuid(parts[idx + 4])) {
        // Bloc need: site_id_date_periodCode_bloc_op_id_besoin_op_id
        needMatinId = parts.slice(idx, idx + 5).join('_');
        idx += 5;
      } else {
        // Regular need: site_id_date_periodCode
        needMatinId = parts.slice(idx, idx + 3).join('_');
        idx += 3;
      }
    }
    
    // Parse needAMId (remaining parts)
    if (parts[idx] === 'null') {
      needAMId = 'null';
    } else {
      needAMId = parts.slice(idx).join('_');
    }
    
    console.log(`  🔍 Combo: ${secretaire_id.slice(0, 8)}... | Matin: ${needMatinId} | AM: ${needAMId}`);
    
    // Parse and update MATIN
    const parsedMatin = parseNeedId(needMatinId, date);
    if (parsedMatin) {
      const capacite = capacites.find(c => 
        c.secretaire_id === secretaire_id &&
        c.date === date &&
        c.demi_journee === 'matin'
      );
      
      if (capacite) {
        const update: any = {
          id: capacite.id,
          site_id: parsedMatin.type === 'bloc_operatoire' ? BLOC_SITE_ID : parsedMatin.site_id,
          planning_genere_bloc_operatoire_id: parsedMatin.bloc_operation_id || null,
          besoin_operation_id: parsedMatin.besoin_operation_id || null
        };
        
        updates.push(update);
        
        if (parsedMatin.type === 'bloc_operatoire') {
          blocCount++;
        } else {
          siteCount++;
        }
      }
    }
    
    // Parse and update AM
    const parsedAM = parseNeedId(needAMId, date);
    if (parsedAM) {
      const capacite = capacites.find(c => 
        c.secretaire_id === secretaire_id &&
        c.date === date &&
        c.demi_journee === 'apres_midi'
      );
      
      if (capacite) {
        const update: any = {
          id: capacite.id,
          site_id: parsedAM.type === 'bloc_operatoire' ? BLOC_SITE_ID : parsedAM.site_id,
          planning_genere_bloc_operatoire_id: parsedAM.bloc_operation_id || null,
          besoin_operation_id: parsedAM.besoin_operation_id || null
        };
        
        updates.push(update);
        
        if (parsedAM.type === 'bloc_operatoire') {
          blocCount++;
        } else {
          siteCount++;
        }
      }
    }
  }
  
  // PHASE 2: Parse role variables for 1R/2F/3F
  for (const [varName, value] of Object.entries(solution)) {
    if (Number(value) <= 0.5) continue;
    
    if (varName.startsWith('role_1r_')) {
      // Format: role_1r_secretaire_id_site_id_date
      const parts = varName.split('_');
      const secId = parts[2];
      const siteId = parts[3];

      // Enforce site for both periods when a closing role is assigned
      const key = `${secId}|${siteId}`;
      if (!roleSiteKeys.has(key)) {
        roleSiteEnforcements.push({ secId, siteId });
        roleSiteKeys.add(key);
      }
      
      // Update both morning and afternoon capacites
      for (const periode of ['matin', 'apres_midi']) {
        const capKey = `${secId}_${siteId}_${date}_${periode}`;
        if (!roleUpdates.has(capKey)) {
          roleUpdates.set(capKey, {});
        }
        roleUpdates.get(capKey)!.is_1r = true;
      }
      
      console.log(`  🔒 1R assigné: ${secId.slice(0,8)}... sur ${siteId.slice(0,8)}... (${date})`);
    }
    
    if (varName.startsWith('role_2f3f_')) {
      // Format: role_2f3f_secretaire_id_site_id_date
      const parts = varName.split('_');
      const secId = parts[2];
      const siteId = parts[3];

      // Enforce site for both periods when a closing role is assigned
      const key = `${secId}|${siteId}`;
      if (!roleSiteKeys.has(key)) {
        roleSiteEnforcements.push({ secId, siteId });
        roleSiteKeys.add(key);
      }
      
      // Determine if it's 2F or 3F based on need
      const need = needs.find(n => n.site_id === siteId && n.date === date);
      const is3F = need?.needs_3f || false;
      
      // Update both morning and afternoon capacites
      for (const periode of ['matin', 'apres_midi']) {
        const capKey = `${secId}_${siteId}_${date}_${periode}`;
        if (!roleUpdates.has(capKey)) {
          roleUpdates.set(capKey, {});
        }
        if (is3F) {
          roleUpdates.get(capKey)!.is_3f = true;
        } else {
          roleUpdates.get(capKey)!.is_2f = true;
        }
      }
      
      console.log(`  🔒 ${is3F ? '3F' : '2F'} assigné: ${secId.slice(0,8)}... sur ${siteId.slice(0,8)}... (${date})`);
    }
  }
  
  console.log(`  📊 Assignations: ${updates.length} total (${blocCount} bloc, ${siteCount} sites)`);
  console.log(`  📊 Rôles: ${roleUpdates.size} (1R/2F/3F)`);
  
  if (updates.length === 0) {
    console.warn(`  ⚠️ Aucune assignation à écrire!`);
  }
  
  // PHASE 3: Batch update for site assignments
  for (const update of updates) {
    const { error } = await supabase
      .from('capacite_effective')
      .update({
        site_id: update.site_id,
        planning_genere_bloc_operatoire_id: update.planning_genere_bloc_operatoire_id,
        besoin_operation_id: update.besoin_operation_id
      })
      .eq('id', update.id);
    
    if (error) {
      console.error(`  ❌ Erreur update capacite ${update.id.slice(0,8)}...:`, error);
    }
  }
  
  // PHASE 3.5: Enforce site for roles on both periods (by ID)
  for (const pair of roleSiteEnforcements) {
    const { secId, siteId } = pair;
    for (const periode of ['matin', 'apres_midi']) {
      const capKey = `${secId}|${date}|${periode}`;
      const capId = capIdMap.get(capKey);
      
      if (!capId) {
        console.warn(`  ⚠️ ID capacite introuvable pour enforcement: ${secId.slice(0,8)} ${periode}`);
        continue;
      }
      
      const { error } = await supabase
        .from('capacite_effective')
        .update({
          site_id: siteId,
          planning_genere_bloc_operatoire_id: null,
          besoin_operation_id: null
        })
        .eq('id', capId);
        
      if (error) {
        console.error(`  ❌ Erreur enforcement site pour ${secId.slice(0,8)} ${periode}:`, error);
      }
    }
  }
  
  // PHASE 4: Update roles (1R/2F/3F) by ID
  for (const [capKey, roles] of roleUpdates.entries()) {
    const [secId, siteId, keyDate, periode] = capKey.split('_');
    
    const mapKey = `${secId}|${keyDate}|${periode}`;
    const capId = capIdMap.get(mapKey);
    
    if (!capId) {
      console.warn(`  ⚠️ ID capacite introuvable pour rôle: ${capKey}`);
      continue;
    }
    
    const { error } = await supabase
      .from('capacite_effective')
      .update(roles)
      .eq('id', capId);
    
    if (error) {
      console.error(`  ❌ Erreur update rôle ${capKey}:`, error);
    }
  }
  
  console.log(`  ✅ ${updates.length} assignations écrites avec succès`);
  console.log(`  ✅ ${roleUpdates.size} rôles écrits avec succès`);
  
  // DIAGNOSTIC: Vérifier que les rôles sont bien écrits sur matin ET après-midi
  if (roleUpdates.size > 0) {
    const { data: checkData } = await supabase
      .from('capacite_effective')
      .select('secretaire_id, date, demi_journee, is_1r, is_2f, is_3f')
      .eq('date', date)
      .eq('actif', true)
      .or('is_1r.eq.true,is_2f.eq.true,is_3f.eq.true');
    
    if (checkData) {
      const bySecretaire = new Map<string, Array<{ periode: string, is_1r: boolean, is_2f: boolean, is_3f: boolean }>>();
      
      for (const row of checkData) {
        if (!bySecretaire.has(row.secretaire_id)) {
          bySecretaire.set(row.secretaire_id, []);
        }
        bySecretaire.get(row.secretaire_id)!.push({
          periode: row.demi_journee,
          is_1r: row.is_1r,
          is_2f: row.is_2f,
          is_3f: row.is_3f
        });
      }
      
      for (const [secId, periodes] of bySecretaire) {
        const matinRole = periodes.find(p => p.periode === 'matin');
        const amRole = periodes.find(p => p.periode === 'apres_midi');
        
        if (matinRole && amRole) {
          const matinHasRole = matinRole.is_1r || matinRole.is_2f || matinRole.is_3f;
          const amHasRole = amRole.is_1r || amRole.is_2f || amRole.is_3f;
          
          if (matinHasRole && !amHasRole) {
            console.warn(`  ⚠️ Rôle manquant sur AM pour ${secId.slice(0,8)}... (matin: 1R=${matinRole.is_1r} 2F=${matinRole.is_2f} 3F=${matinRole.is_3f})`);
          } else if (!matinHasRole && amHasRole) {
            console.warn(`  ⚠️ Rôle manquant sur matin pour ${secId.slice(0,8)}... (AM: 1R=${amRole.is_1r} 2F=${amRole.is_2f} 3F=${amRole.is_3f})`);
          }
        } else if (matinRole && !amRole) {
          console.warn(`  ⚠️ Rôle écrit seulement sur matin pour ${secId.slice(0,8)}...`);
        } else if (!matinRole && amRole) {
          console.warn(`  ⚠️ Rôle écrit seulement sur AM pour ${secId.slice(0,8)}...`);
        }
      }
    }
  }
  
  return updates.length;
}
