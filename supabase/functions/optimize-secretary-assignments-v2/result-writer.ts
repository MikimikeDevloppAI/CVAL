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

  // Lister les variables assignées (=1)
  const assignedVars = Object.entries(solution)
    .filter(([k, v]) => k.startsWith('assign_') && v === 1)
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
    // Format attendu:
    // - Site needs: assign_{secretaire_id}_{site_id}_{date}_{periode}
    // - Bloc needs: assign_{secretaire_id}_{site_id}_{date}_{periode}_bloc_{bloc_operation_id}_{besoin_operation_id}
    
    // Detect period first
    let periode: 'matin' | 'apres_midi' | undefined;
    let coreSansPeriode: string = '';
    let bloc_operation_id: string | undefined;
    let besoin_operation_id: string | undefined;
    
    if (varName.includes('_apres_midi_bloc_')) {
      periode = 'apres_midi';
      // Regex plus permissif
      const match = varName.match(/^assign_(.+?)_apres_midi_bloc_([0-9a-fA-F-]{36})_([0-9a-fA-F-]{36})(?:$|_)/);
      if (match) {
        coreSansPeriode = match[1];
        const uuid1 = match[2].toLowerCase();
        const uuid2 = match[3].toLowerCase();
        
        if (isUuid(uuid1) && isUuid(uuid2)) {
          bloc_operation_id = uuid1;
          besoin_operation_id = uuid2;
          console.log(`  ✅ BLOC après-midi parsé OK: bloc_op=${bloc_operation_id.slice(0,8)}..., besoin_op=${besoin_operation_id.slice(0,8)}...`);
        } else {
          console.error(`  ❌ BLOC après-midi: UUIDs invalides!`);
        }
      } else {
        console.error(`  ❌ BLOC après-midi: Format REGEX invalide! varName=${varName.slice(0, 80)}...`);
        // Fallback
        const parts = varName.split('_apres_midi_bloc_');
        if (parts.length === 2) {
          coreSansPeriode = parts[0].slice('assign_'.length);
          const uuidMatches = parts[1].match(/([0-9a-fA-F-]{36})/g);
          if (uuidMatches && uuidMatches.length >= 2) {
            bloc_operation_id = uuidMatches[0].toLowerCase();
            besoin_operation_id = uuidMatches[1].toLowerCase();
            console.log(`    ✅ Fallback OK: bloc_op=${bloc_operation_id.slice(0,8)}, besoin_op=${besoin_operation_id.slice(0,8)}`);
          }
        }
      }
    } else if (varName.includes('_matin_bloc_')) {
      periode = 'matin';
      const match = varName.match(/^assign_(.+?)_matin_bloc_([0-9a-fA-F-]{36})_([0-9a-fA-F-]{36})(?:$|_)/);
      if (match) {
        coreSansPeriode = match[1];
        const uuid1 = match[2].toLowerCase();
        const uuid2 = match[3].toLowerCase();
        
        if (isUuid(uuid1) && isUuid(uuid2)) {
          bloc_operation_id = uuid1;
          besoin_operation_id = uuid2;
          console.log(`  ✅ BLOC matin parsé OK: bloc_op=${bloc_operation_id.slice(0,8)}..., besoin_op=${besoin_operation_id.slice(0,8)}...`);
        } else {
          console.error(`  ❌ BLOC matin: UUIDs invalides!`);
        }
      } else {
        console.error(`  ❌ BLOC matin: Format REGEX invalide!`);
        const parts = varName.split('_matin_bloc_');
        if (parts.length === 2) {
          coreSansPeriode = parts[0].slice('assign_'.length);
          const uuidMatches = parts[1].match(/([0-9a-fA-F-]{36})/g);
          if (uuidMatches && uuidMatches.length >= 2) {
            bloc_operation_id = uuidMatches[0].toLowerCase();
            besoin_operation_id = uuidMatches[1].toLowerCase();
            console.log(`    ✅ Fallback OK: bloc_op=${bloc_operation_id.slice(0,8)}, besoin_op=${besoin_operation_id.slice(0,8)}`);
          }
        }
      }
    } else if (varName.endsWith('_apres_midi')) {
      periode = 'apres_midi';
      const core = varName.slice('assign_'.length);
      coreSansPeriode = core.slice(0, -('_apres_midi').length);
    } else if (varName.endsWith('_matin')) {
      periode = 'matin';
      const core = varName.slice('assign_'.length);
      coreSansPeriode = core.slice(0, -('_matin').length);
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
