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
  
  const updates: any[] = [];
  let blocCount = 0;
  let siteCount = 0;
  
  // Parse combo variables
  for (const [varName, value] of Object.entries(solution)) {
    if (!varName.startsWith('combo_')) continue;
    if (Number(value) <= 0.5) continue;
    
    // Format: combo_secretaire_id_needMatinId_needAMId
    // We need to extract the parts carefully because needIds contain underscores
    
    const withoutPrefix = varName.slice(6); // Remove "combo_"
    const parts = withoutPrefix.split('_');
    
    // First part is secretaire_id (UUID)
    const secretaire_id = parts[0];
    
    // Find the start of needAMId by looking for the last occurrence of the secretaire_id pattern
    // The structure is: secretaire_id_...needMatinId..._...needAMId...
    
    // Reconstruct needMatinId and needAMId
    // We know the structure: parts[0] is secretaire_id
    // Then comes needMatinId which can be:
    //   - "null"
    //   - site_id_date_periodCode (3 parts)
    //   - site_id_date_periodCode_bloc_op_id_besoin_op_id (5 parts)
    // Then comes needAMId with same format
    
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
  
  console.log(`  📊 Assignations: ${updates.length} total (${blocCount} bloc, ${siteCount} sites)`);
  
  if (updates.length === 0) {
    console.warn(`  ⚠️ Aucune assignation à écrire!`);
    return;
  }
  
  // Batch update
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
  
  console.log(`  ✅ ${updates.length} assignations écrites avec succès`);
}
