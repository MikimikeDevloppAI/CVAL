import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { SiteNeed, CapaciteEffective } from './types.ts';

export async function writeAssignments(
  solution: any,
  date: string,
  needs: SiteNeed[],
  capacites: CapaciteEffective[],
  supabase: SupabaseClient
) {
  console.log('\n📝 Écriture des résultats...');
  console.log(`  📊 Solution trouvée: ${Object.keys(solution).length} variables`);
  
  const updates: any[] = [];
  let assignedCount = 0;
  
  // Parse solution
  for (const [varName, value] of Object.entries(solution)) {
    if (!varName.startsWith('assign_') || value !== 1) continue;
    
    assignedCount++;
    
    // Format: assign_{secretaire_id}_{site_id}_{date}_{periode}
    const parts = varName.replace('assign_', '').split('_');
    const secretaire_id = parts[0];
    const site_id = parts[1];
    const periode = parts[parts.length - 1];
    
    // Find corresponding capacite
    const capacite = capacites.find(
      c => c.secretaire_id === secretaire_id && 
           c.date === date && 
           c.demi_journee === periode
    );
    
    if (!capacite) {
      console.warn(`⚠️ Capacité non trouvée pour ${varName}`);
      continue;
    }
    
    // Find corresponding need
    const need = needs.find(
      n => n.site_id === site_id && n.date === date && n.periode === periode
    );
    
    if (!need) {
      console.warn(`⚠️ Besoin non trouvé pour ${varName}`);
      continue;
    }
    
    // Prepare update
    const update: any = {
      id: capacite.id,
      site_id: site_id,
      planning_genere_bloc_operatoire_id: null,
      besoin_operation_id: null
    };
    
    // If it's a bloc need, assign the IDs
    if (need.type === 'bloc_operatoire') {
      if (need.bloc_operation_id) {
        update.planning_genere_bloc_operatoire_id = need.bloc_operation_id;
      }
      if (need.besoin_operation_id) {
        update.besoin_operation_id = need.besoin_operation_id;
      }
    }
    
    console.log(`\n  ✅ Assignation ${assignedCount}:`, {
      secretaire_id,
      site_id,
      date,
      periode,
      capacite_id: capacite.id,
      need_type: need?.type,
      bloc_operation_id: need?.bloc_operation_id
    });
    
    updates.push(update);
  }
  
  console.log(`\n📝 Écriture de ${updates.length} assignations dans capacite_effective`);
  
  // Batch update
  let successCount = 0;
  for (const update of updates) {
    const { error } = await supabase
      .from('capacite_effective')
      .update(update)
      .eq('id', update.id);
    
    if (error) {
      console.error(`❌ Erreur lors de l'update de ${update.id}:`, error);
    } else {
      successCount++;
    }
  }
  
  console.log(`\n✅ ${successCount}/${updates.length} assignations écrites avec succès`);
}
