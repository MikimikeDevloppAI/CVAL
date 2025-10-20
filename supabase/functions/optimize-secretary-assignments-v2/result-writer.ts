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
  // Détection BLOC robuste: 2 DERNIERS segments sont des UUIDs (avec ou sans "_bloc_")
  const blocAssignedVars = assignedVars.filter(v => {
    const p = v.split('_');
    return p.length >= 7 && isUuid(p[p.length - 2]) && isUuid(p[p.length - 1]);
  });
  const siteAssignedVars = assignedVars.filter(v => {
    const p = v.split('_');
    return !(p.length >= 7 && isUuid(p[p.length - 2]) && isUuid(p[p.length - 1]));
  });
  
  console.log(`\n📦 Variables BLOC détectées (structure): ${blocAssignedVars.length}`);
  if (blocAssignedVars.length > 0) {
    console.log(`   Exemples (3 premiers):`, blocAssignedVars.slice(0, 3));
  }
  console.log(`\n🏢 Variables SITE détectées: ${siteAssignedVars.length}`);
  if (siteAssignedVars.length > 0) {
    console.log(`   Exemples:`, siteAssignedVars.slice(0, 3));
  }
  
  const processedCapaciteIds = new Set<string>();

  // Parcours des variables assignées
  for (const varName of assignedVars) {
    // Format attendu:
    // - Site needs: assign_{secretaire_id}_{site_id}_{date}_{periodCode} où periodCode = 1 ou 2
    // - Bloc needs: assign_{secretaire_id}_{site_id}_{date}_{periodCode}_{bloc_operation_id}_{besoin_operation_id}
    
    const parts = varName.split('_');
    
    // Validation de base: doit commencer par 'assign' et avoir au moins 5 parties
    if (parts.length < 5 || parts[0] !== 'assign') {
      console.warn(`⚠️ Format invalide: ${varName}`);
      continue;
    }

    const secretaire_id = parts[1];
    const site_id = parts[2];
    const dateStr = parts[3];
    const periodToken = parts[4]; // '1', '2', 'matin', 'apres_midi'
    
    // Validation des UUIDs de base
    if (!isUuid(secretaire_id) || !isUuid(site_id)) {
      console.warn(`⚠️ UUIDs invalides dans: ${varName}`);
      continue;
    }
    
    // Normalisation période: accepte '1'/'2' ET 'matin'/'apres_midi'
    const periode: 'matin' | 'apres_midi' = 
      (periodToken === '1' || periodToken === 'matin') ? 'matin' : 'apres_midi';
    
    // Détection BLOC robuste: 2 DERNIERS segments = UUIDs (avec ou sans "_bloc_")
    let bloc_operation_id: string | undefined;
    let besoin_operation_id: string | undefined;
    
    const last = parts[parts.length - 1];
    const prev = parts[parts.length - 2];
    const isBloc = parts.length >= 7 && isUuid(prev) && isUuid(last);
    
    if (isBloc) {
      bloc_operation_id = prev.toLowerCase();
      besoin_operation_id = last.toLowerCase();
      console.log(`  🏥 BLOC détecté: var=${varName}`);
      console.log(`     → parts.length=${parts.length}, période=${periodToken}→${periode}, bloc_op=${bloc_operation_id.slice(0,8)}, besoin_op=${besoin_operation_id.slice(0,8)}`);
    } else {
      console.log(`  🏢 SITE: var=${varName}, parts.length=${parts.length}, période=${periodToken}→${periode}`);
    }

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
      console.log(`  ♻️ FALLBACK BLOC: besoin non trouvé mais IDs parsés, écriture directe`);
      
      assignedCount++;
      updates.push({
        id: capacite.id,
        site_id: site_id, // Utilise le site_id parsé du varName
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

    const update: any = {
      id: capacite.id,
      site_id: site_id,
    };

    // Écriture inconditionnelle des IDs BLOC si parsés
    if (bloc_operation_id && besoin_operation_id) {
      update.planning_genere_bloc_operatoire_id = bloc_operation_id;
      update.besoin_operation_id = besoin_operation_id;
      console.log(`  ✅ BLOC IDs assignés: bloc_op=${bloc_operation_id.slice(0,8)}, besoin_op=${besoin_operation_id.slice(0,8)}`);
    } else if (need?.bloc_operation_id && need?.besoin_operation_id) {
      // Fallback: récupérer depuis le need si pas dans le varName
      update.planning_genere_bloc_operatoire_id = need.bloc_operation_id;
      update.besoin_operation_id = need.besoin_operation_id;
      console.log(`  ♻️ BLOC IDs depuis need: bloc_op=${need.bloc_operation_id.slice(0,8)}, besoin_op=${need.besoin_operation_id.slice(0,8)}`);
    }

    processedCapaciteIds.add(capacite.id);
    updates.push(update);
  }

  const updatesWithBlocIds = updates.filter(u => !!u.planning_genere_bloc_operatoire_id && !!u.besoin_operation_id);
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
    
    // Compteur final
    const { data: finalCount } = await supabase
      .from('capacite_effective')
      .select('id', { count: 'exact', head: true })
      .eq('date', date)
      .not('planning_genere_bloc_operatoire_id', 'is', null)
      .not('besoin_operation_id', 'is', null);
    
    console.log(`\n🧾 Récap BLOC final: ${finalCount || 0} lignes avec IDs BLOC écrits pour ${date}`);
  }
}
