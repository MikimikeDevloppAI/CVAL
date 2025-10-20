import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { SiteNeed, CapaciteEffective } from './types.ts';

// Helper function to validate UUID format
function isUuid(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

export async function writeAssignments(
  solution: any,
  date: string,
  needs: SiteNeed[],
  capacites: CapaciteEffective[],
  supabase: SupabaseClient
) {
  console.log('\n📝 Écriture des résultats...');
  console.log(`  📊 Solution trouvée: ${Object.keys(solution).length} variables`);
  
  // ÉTAPE 0 : Reset de toutes les capacités de la date
  console.log(`\n♻️ Réinitialisation des capacités pour ${date}...`);
  
  const { data: resetData, error: resetError } = await supabase
    .from('capacite_effective')
    .update({
      site_id: '00000000-0000-0000-0000-000000000001', // ADMIN_SITE_ID
      planning_genere_bloc_operatoire_id: null,
      besoin_operation_id: null
    })
    .eq('date', date)
    .eq('actif', true)
    .select('id');

  if (resetError) {
    console.error('❌ Erreur lors du reset:', resetError);
    throw resetError;
  }

  console.log(`  ✅ ${resetData?.length || 0} capacités réinitialisées`);
  
  const updates: any[] = [];
  let assignedCount = 0;

  // Lister les variables assignées (>0.5 pour supporter les flottants)
  const assignedVars = Object.entries(solution)
    .filter(([k, v]) => k.startsWith('assign_') && Number(v) > 0.5)
    .map(([k]) => k);
  console.log(`  🔎 Variables assignées (=1): ${assignedVars.length}`);
  
  // 🔍 DIAGNOSTIC 1: Répartition variables BLOC vs SITE
  const blocAssignedVars = assignedVars.filter(v => v.includes('_bloc_'));
  const siteAssignedVars = assignedVars.filter(v => !v.includes('_bloc_'));
  
  console.log(`\n📦 Variables BLOC détectées: ${blocAssignedVars.length}`);
  if (blocAssignedVars.length > 0) {
    console.log(`   Exemples (3 premiers):`, blocAssignedVars.slice(0, 3));
    // Log si apres_midi
    const apresMidiBlocVars = blocAssignedVars.filter(v => v.includes('_apres_midi_bloc_'));
    console.log(`   📋 Variables _apres_midi_bloc_: ${apresMidiBlocVars.length}`);
    if (apresMidiBlocVars.length > 0) {
      console.log(`      Exemples:`, apresMidiBlocVars.slice(0, 2));
    }
  }
  console.log(`\n🏢 Variables SITE détectées: ${siteAssignedVars.length}`);
  if (siteAssignedVars.length > 0) {
    console.log(`   Exemples:`, siteAssignedVars.slice(0, 3));
  }
  
  const processedCapaciteIds = new Set<string>();

  // Parcours des variables assignées
  for (const varName of assignedVars) {
    // Format attendu avec codes numériques:
    // - Site needs: assign_{secretaire_id}_{site_id}_{date}_{periodCode} où periodCode = 1 ou 2
    // - Bloc needs: assign_{secretaire_id}_{site_id}_{date}_{periodCode}_bloc_{bloc_operation_id}_{besoin_operation_id}
    
    // Detect period code and convert to text
    let periode: 'matin' | 'apres_midi' | undefined;
    let periodCode: string | undefined;
    let coreSansPeriode: string = '';
    let bloc_operation_id: string | undefined;
    let besoin_operation_id: string | undefined;
    
    // Check for BLOC variables first (they have _bloc_ in them)
    const isBlocVar = varName.includes('_bloc_');
    
    if (isBlocVar) {
      // Extract period code from _1_bloc_ or _2_bloc_
      const periodMatch = varName.match(/_([12])_bloc_/);
      if (periodMatch) {
        periodCode = periodMatch[1];
        periode = periodCode === '1' ? 'matin' : 'apres_midi';
        console.log(`  🔢 BLOC période détectée: code=${periodCode} → ${periode}`);
        
        // Extract the two UUIDs after _bloc_
        const blocMatch = varName.match(/_bloc_([0-9a-fA-F-]{36})_([0-9a-fA-F-]{36})/);
        if (blocMatch && isUuid(blocMatch[1]) && isUuid(blocMatch[2])) {
          bloc_operation_id = blocMatch[1].toLowerCase();
          besoin_operation_id = blocMatch[2].toLowerCase();
          console.log(`  ✅ BLOC parsé OK: bloc_op=${bloc_operation_id.slice(0,8)}..., besoin_op=${besoin_operation_id.slice(0,8)}...`);
          
          // Extract core without period code and bloc part
          const beforeBloc = varName.split(`_${periodCode}_bloc_`)[0];
          coreSansPeriode = beforeBloc.slice('assign_'.length);
        } else {
          console.error(`  ❌ BLOC: UUIDs invalides dans ${varName.slice(0, 80)}...`);
          continue;
        }
      } else {
        console.error(`  ❌ BLOC: Code période non trouvé dans ${varName.slice(0, 80)}...`);
        continue;
      }
    } else {
      // SITE variable: extract period code from end (_1 or _2)
      const periodMatch = varName.match(/_([12])$/);
      if (periodMatch) {
        periodCode = periodMatch[1];
        periode = periodCode === '1' ? 'matin' : 'apres_midi';
        console.log(`  🔢 SITE période détectée: code=${periodCode} → ${periode}`);
        
        // Remove period code to get core
        const core = varName.slice('assign_'.length);
        coreSansPeriode = core.slice(0, -2); // Remove _1 or _2
      } else {
        console.warn(`⚠️ SITE: Code période non trouvé dans ${varName}`);
        continue;
      }
    }

    if (!periode || !coreSansPeriode) {
      console.warn(`⚠️ Période ou format invalide dans le nom de variable: ${varName}`);
      continue;
    }

    const [secretaire_id, site_id, dateStr] = coreSansPeriode.split('_');

    if (!secretaire_id || !site_id || !dateStr) {
      console.warn(`⚠️ Parsing invalide pour ${varName}`);
      continue;
    }

    const capacite = capacites.find(
      (c) =>
        c.secretaire_id === secretaire_id &&
        c.date === date &&
        c.demi_journee === periode
    );

    if (!capacite) {
      console.warn(`⚠️ Capacité non trouvée pour ${varName}`);
      continue;
    }

    let need;
    if (bloc_operation_id && besoin_operation_id) {
      need = needs.find(
        (n) => n.type === 'bloc_operatoire' && 
               n.bloc_operation_id === bloc_operation_id &&
               n.besoin_operation_id === besoin_operation_id &&
               n.date === date && 
               n.periode === periode
      );
    } else {
      need = needs.find(
        (n) => n.site_id === site_id && n.date === date && n.periode === periode
      );
    }

    if (!need && bloc_operation_id && besoin_operation_id) {
      console.log(`  ♻️ FALLBACK BLOC utilisé`);
      const BLOC_SITE_ID = '86f1047f-c4ff-441f-a064-42ee2f8ef37a';
      
      assignedCount++;
      updates.push({
        id: capacite.id,
        site_id: BLOC_SITE_ID,
        planning_genere_bloc_operatoire_id: bloc_operation_id,
        besoin_operation_id: besoin_operation_id,
      });
      processedCapaciteIds.add(capacite.id);
      continue;
    }

    if (!need) {
      console.warn(`⚠️ Besoin non trouvé pour ${varName}`);
      continue;
    }

    assignedCount++;

    const BLOC_SITE_ID = '86f1047f-c4ff-441f-a064-42ee2f8ef37a';
    const update: any = {
      id: capacite.id,
      site_id: site_id,
      planning_genere_bloc_operatoire_id: null,
      besoin_operation_id: null,
    };

    if (site_id === BLOC_SITE_ID) {
      if (bloc_operation_id) {
        update.planning_genere_bloc_operatoire_id = bloc_operation_id;
      }
      if (besoin_operation_id) {
        update.besoin_operation_id = besoin_operation_id;
      }
      
      if (!update.planning_genere_bloc_operatoire_id && need?.bloc_operation_id) {
        update.planning_genere_bloc_operatoire_id = need.bloc_operation_id;
      }
      if (!update.besoin_operation_id && need?.besoin_operation_id) {
        update.besoin_operation_id = need.besoin_operation_id;
      }
      
      console.log(`  🏥 BLOC assignation: bloc_op=${update.planning_genere_bloc_operatoire_id?.slice(0,8)}, besoin_op=${update.besoin_operation_id?.slice(0,8)}`);
    }

    processedCapaciteIds.add(capacite.id);
    updates.push(update);
  }

  const updatesWithBlocIds = updates.filter(u => u.planning_genere_bloc_operatoire_id !== null);
  console.log(`\n📝 Écriture de ${updates.length} assignations (${updatesWithBlocIds.length} BLOC)`);
  
  // Batch update
  let successCount = 0;
  let errorCount = 0;
  for (const update of updates) {
    const { error } = await supabase
      .from('capacite_effective')
      .update(update)
      .eq('id', update.id);
    
    if (error) {
      errorCount++;
      console.error(`❌ Erreur UPDATE ${update.id?.slice(0,8)}:`, error.message);
    } else {
      successCount++;
      if (update.planning_genere_bloc_operatoire_id) {
        console.log(`  ✅ BLOC UPDATE OK: capacite=${update.id?.slice(0, 8)}, bloc_op=${update.planning_genere_bloc_operatoire_id?.slice(0, 8)}`);
      }
    }
  }
  
  console.log(`\n✅ ${successCount}/${updates.length} assignations écrites avec succès`);
  if (errorCount > 0) console.error(`❌ ${errorCount} erreurs`);
  
  // Vérification post-écriture
  if (updatesWithBlocIds.length > 0) {
    console.log(`\n🔬 Vérification post-écriture (échantillon BLOC)...`);
    for (const update of updatesWithBlocIds.slice(0, 3)) {
      const { data: verif, error: verifError } = await supabase
        .from('capacite_effective')
        .select('id, planning_genere_bloc_operatoire_id, besoin_operation_id, site_id')
        .eq('id', update.id)
        .single();
      
      if (!verifError && verif) {
        const blocOk = verif.planning_genere_bloc_operatoire_id ? '✅' : '❌';
        const besoinOk = verif.besoin_operation_id ? '✅' : '❌';
        console.log(`  🔬 Capacite ${verif.id?.slice(0, 8)}: ${blocOk} bloc_op=${verif.planning_genere_bloc_operatoire_id?.slice(0,8) || 'NULL'}, ${besoinOk} besoin_op=${verif.besoin_operation_id?.slice(0,8) || 'NULL'}`);
      }
    }
  }
}
