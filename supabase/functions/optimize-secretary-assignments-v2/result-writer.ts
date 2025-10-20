import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { SiteNeed, CapaciteEffective } from './types.ts';

// Helper function to validate UUID format
function isUuid(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

// Helper function to detect BLOC variables
function isBlocVariable(varName: string): boolean {
  const parts = varName.split('_');
  if (parts.length < 7) return false;
  const prev = parts[parts.length - 2];
  const last = parts[parts.length - 1];
  return isUuid(prev) && isUuid(last);
}

export async function writeAssignments(
  solution: any,
  date: string,
  needs: SiteNeed[],
  capacites: CapaciteEffective[],
  supabase: SupabaseClient
) {
  // Get bloc site ID
  const { data: blocSiteData } = await supabase
    .from('sites')
    .select('id')
    .ilike('nom', '%bloc%opératoire%')
    .single();
  
  const BLOC_SITE_ID = blocSiteData?.id || '86f1047f-c4ff-441f-a064-42ee2f8ef37a';
  
  const updates: any[] = [];
  let blocCount = 0;
  let sampleBlocUpdate: any = null;

  for (const [varName, value] of Object.entries(solution)) {
    if (!varName.startsWith('assign_')) continue;
    if (Number(value) <= 0.5) continue;

    const parts = varName.split('_');
    const secretaire_id = parts[1];

    const prev = parts[parts.length - 2];
    const last = parts[parts.length - 1];

    const isBloc = isBlocVariable(varName);
    let bloc_operation_id: string | undefined;
    let besoin_operation_id: string | undefined;
    
    if (isBloc) {
      bloc_operation_id = prev;
      besoin_operation_id = last;
      blocCount++;
    }

    const need = needs.find(n => {
      if (isBloc) {
        return n.type === 'bloc_operatoire' &&
               n.bloc_operation_id === bloc_operation_id &&
               n.besoin_operation_id === besoin_operation_id;
      } else {
        const needParts = varName.split('_').slice(2);
        const site_id = needParts[0];
        const needDate = needParts[1];
        const periodCode = needParts[2];
        const periode = periodCode === '1' ? 'matin' : 'apres_midi';
        
        return n.site_id === site_id && 
               n.date === needDate && 
               n.periode === periode &&
               n.type === 'site';
      }
    });
    
    if (!need) continue;

    const capacite = capacites.find(c => 
      c.secretaire_id === secretaire_id &&
      c.date === need.date &&
      c.demi_journee === need.periode
    );
    
    if (!capacite) continue;

    const update: any = {
      id: capacite.id,
      site_id: isBloc ? BLOC_SITE_ID : need.site_id,
      planning_genere_bloc_operatoire_id: bloc_operation_id,
      besoin_operation_id: besoin_operation_id
    };
    
    // Capture first BLOC sample for logging
    if (isBloc && !sampleBlocUpdate) {
      sampleBlocUpdate = update;
    }
    
    updates.push(update);
  }

  console.log(`📝 write: total=${updates.length}, bloc=${blocCount}`);
  
  if (updates.length === 0) return;

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
      console.error(`❌ Erreur update capacite ${update.id.slice(0,8)}...:`, error);
    }
  }
  
  // Verify sample BLOC write
  if (sampleBlocUpdate) {
    const { data: verifyData } = await supabase
      .from('capacite_effective')
      .select('id, site_id, planning_genere_bloc_operatoire_id, besoin_operation_id')
      .eq('id', sampleBlocUpdate.id)
      .single();
    
    if (verifyData) {
      console.log(`✅ post-write: site_id=${verifyData.site_id?.slice(0,8)}..., bloc_op=${verifyData.planning_genere_bloc_operatoire_id?.slice(0,8)}..., besoin_op=${verifyData.besoin_operation_id?.slice(0,8)}...`);
    }
  }
}
