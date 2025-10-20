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
    console.log(`   Exemples:`, blocAssignedVars.slice(0, 3));
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
      const parts = varName.split('_apres_midi_bloc_');
      coreSansPeriode = parts[0].slice('assign_'.length);
      // Extract bloc_operation_id and besoin_operation_id
      const blocParts = parts[1].split('_');
      if (blocParts.length >= 2) {
        bloc_operation_id = blocParts[0];
        besoin_operation_id = blocParts[1];
      } else {
        besoin_operation_id = parts[1]; // fallback for old format
      }
    } else if (varName.includes('_matin_bloc_')) {
      periode = 'matin';
      const parts = varName.split('_matin_bloc_');
      coreSansPeriode = parts[0].slice('assign_'.length);
      // Extract bloc_operation_id and besoin_operation_id
      const blocParts = parts[1].split('_');
      if (blocParts.length >= 2) {
        bloc_operation_id = blocParts[0];
        besoin_operation_id = blocParts[1];
      } else {
        besoin_operation_id = parts[1]; // fallback for old format
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

    // 🔍 DIAGNOSTIC 2: Log du parsing de la variable
    console.log(`\n🔍 Traitement variable:`, {
      varName: varName.slice(0, 60) + (varName.length > 60 ? '...' : ''),
      parsed: {
        secretaire_id: secretaire_id?.slice(0, 8),
        site_id_from_var: site_id?.slice(0, 8),
        dateStr,
        periode,
        bloc_operation_id: bloc_operation_id?.slice(0, 8),
        besoin_operation_id: besoin_operation_id?.slice(0, 8)
      }
    });

    if (!secretaire_id || !site_id || !dateStr) {
      console.warn(`⚠️ Parsing invalide pour ${varName} → {secretaire_id:${secretaire_id}}, {site_id:${site_id}}, {date:${dateStr}}`);
      continue;
    }

    if (dateStr !== date) {
      console.warn(`⚠️ Mismatch de date (var=${dateStr} vs param=${date}) pour ${varName}`);
    }

    // 🔍 DIAGNOSTIC 3: Recherche de la capacité correspondante
    console.log(`  🔎 Recherche capacité (by secretaire_id/date/periode)...`);
    const capacite = capacites.find(
      (c) =>
        c.secretaire_id === secretaire_id &&
        c.date === date &&
        c.demi_journee === periode
    );

    if (!capacite) {
      console.warn(`⚠️ Capacité non trouvée pour ${varName}`);
      const caps = capacites
        .filter((c) => c.secretaire_id === secretaire_id && c.date === date)
        .map((c) => ({ id: c.id?.slice(0, 8), demi_journee: c.demi_journee, site_id: (c as any).site_id?.slice(0, 8) }))
        .slice(0, 5);
      console.warn(`   🔍 Capacités disponibles ce jour pour ${secretaire_id?.slice(0, 8)}:`, caps);
      continue;
    }

    // 🔍 DIAGNOSTIC 4: Capacité trouvée
    console.log(`  ✅ Capacité trouvée:`, {
      capacite_id: capacite.id?.slice(0, 8),
      demi_journee: capacite.demi_journee,
      site_id: (capacite as any).site_id?.slice(0, 8),
      confirm: 'UPDATE ciblé par id (pas d\'insert)'
    });

    // 🔍 DIAGNOSTIC 5: Recherche du besoin correspondant
    // For bloc needs, match by bloc_operation_id + besoin_operation_id + date + periode
    let need;
    if (bloc_operation_id && besoin_operation_id) {
      console.log(`  🎯 BLOC need recherché:`, {
        bloc_operation_id: bloc_operation_id?.slice(0, 8),
        besoin_operation_id: besoin_operation_id?.slice(0, 8),
        date,
        periode
      });
      need = needs.find(
        (n) => n.type === 'bloc_operatoire' && 
               n.bloc_operation_id === bloc_operation_id &&
               n.besoin_operation_id === besoin_operation_id &&
               n.date === date && 
               n.periode === periode
      );
      if (!need) {
        console.warn(`  ⚠️ BLOC need non trouvé dans la liste des needs`);
        const blocNeedsForDay = needs
          .filter((n) => n.type === 'bloc_operatoire' && n.date === date)
          .map((n) => ({ 
            periode: n.periode, 
            bloc_op: n.bloc_operation_id?.slice(0, 8), 
            besoin_op: n.besoin_operation_id?.slice(0, 8),
            nombre_max: n.nombre_max
          }));
        console.warn(`     Besoins BLOC du jour:`, blocNeedsForDay);
      }
    } else {
      // For site needs: match by site_id + date + periode
      console.log(`  🎯 SITE need recherché:`, {
        site_id: site_id?.slice(0, 8),
        date,
        periode
      });
      need = needs.find(
        (n) => n.site_id === site_id && n.date === date && n.periode === periode
      );
    }

    if (!need) {
      console.warn(`⚠️ Besoin non trouvé pour ${varName}`);
      
      // FALLBACK for BLOC assignments: use parsed IDs directly
      if (bloc_operation_id && besoin_operation_id) {
        console.log(`  ♻️ FALLBACK BLOC utilisé: besoin non trouvé mais IDs parsés disponibles`);
        const BLOC_SITE_ID = '86f1047f-c4ff-441f-a064-42ee2f8ef37a';
        
        assignedCount++;
        const update: any = {
          id: capacite.id,
          site_id: BLOC_SITE_ID,
          planning_genere_bloc_operatoire_id: bloc_operation_id,
          besoin_operation_id: besoin_operation_id,
        };
        
        // 🔍 DIAGNOSTIC 6: Log update préparé
        console.log(`  📝 Update préparé (FALLBACK BLOC):`, {
          capacite_id: capacite.id?.slice(0, 8),
          site_id_final: BLOC_SITE_ID?.slice(0, 8),
          planning_genere_bloc_operatoire_id: bloc_operation_id?.slice(0, 8),
          besoin_operation_id: besoin_operation_id?.slice(0, 8)
        });
        
        if (processedCapaciteIds.has(capacite.id)) {
          console.warn(`  ⚠️ Duplicate update target: ${capacite.id?.slice(0, 8)}`);
        }
        processedCapaciteIds.add(capacite.id);
        
        updates.push(update);
        continue;
      }
      
      // For non-bloc needs, log and skip
      if (bloc_operation_id) {
        const blocNeeds = needs
          .filter((n) => n.type === 'bloc_operatoire' && n.date === date)
          .map((n) => ({ 
            periode: n.periode, 
            bloc_operation_id: n.bloc_operation_id, 
            besoin_operation_id: n.besoin_operation_id,
            nombre_max: n.nombre_max
          }))
          .slice(0, 10);
        console.warn(`   🔍 Besoins BLOC connus ce jour:`, blocNeeds);
      } else {
        const dayNeedsForSite = needs
          .filter((n) => n.site_id === site_id && n.date === date)
          .map((n) => ({ periode: n.periode, type: n.type, nombre_max: n.nombre_max }))
          .slice(0, 10);
        console.warn(`   🔍 Besoins connus ce jour pour site ${site_id}:`, dayNeedsForSite);
      }
      continue;
    }

    assignedCount++;

    // Préparer l'update
    const BLOC_SITE_ID = '86f1047f-c4ff-441f-a064-42ee2f8ef37a';
    const update: any = {
      id: capacite.id,
      site_id: need.type === 'bloc_operatoire' ? BLOC_SITE_ID : site_id,
      planning_genere_bloc_operatoire_id: null,
      besoin_operation_id: null,
    };

    // Si c'est un besoin de bloc, assigner les IDs
    if (need.type === 'bloc_operatoire') {
      if (need.bloc_operation_id) {
        update.planning_genere_bloc_operatoire_id = need.bloc_operation_id;
      }
      if (need.besoin_operation_id) {
        update.besoin_operation_id = need.besoin_operation_id;
      }
    }

    // 🔍 DIAGNOSTIC 6: Log update préparé complet
    console.log(`  📝 Update préparé:`, {
      capacite_id: capacite.id?.slice(0, 8),
      site_id_final: update.site_id?.slice(0, 8),
      planning_genere_bloc_operatoire_id: update.planning_genere_bloc_operatoire_id?.slice(0, 8),
      besoin_operation_id: update.besoin_operation_id?.slice(0, 8),
      need_type: need?.type
    });

    if (processedCapaciteIds.has(capacite.id)) {
      console.warn(`  ⚠️ Duplicate update target: ${capacite.id?.slice(0, 8)}`);
    }
    processedCapaciteIds.add(capacite.id);

    updates.push(update);
  }

  // 🔍 DIAGNOSTIC 7: Résumé avant écriture
  console.log(`\n📝 Écriture de ${updates.length} assignations dans capacite_effective`);
  
  const updatesWithBlocIds = updates.filter(u => u.planning_genere_bloc_operatoire_id !== null);
  const updatesWithoutBlocIds = updates.filter(u => u.planning_genere_bloc_operatoire_id === null);
  const distinctCapaciteIds = new Set(updates.map(u => u.id));
  
  console.log(`  📊 Updates avec IDs BLOC: ${updatesWithBlocIds.length}`);
  console.log(`  📊 Updates sans IDs BLOC (sites réguliers): ${updatesWithoutBlocIds.length}`);
  console.log(`  📊 Nombre de capacites distinctes ciblées: ${distinctCapaciteIds.size}`);
  console.log(`  ✅ 0 inserts planifiés (UPDATE uniquement via id)`);
  
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
      // 🔍 DIAGNOSTIC 8: Log des 3 premiers updates réussis
      if (successCount <= 3) {
        console.log(`  ✅ UPDATE OK [${successCount}]:`, {
          capacite_id: update.id?.slice(0, 8),
          site_id: update.site_id?.slice(0, 8),
          bloc_id: update.planning_genere_bloc_operatoire_id?.slice(0, 8) || 'null',
          besoin_id: update.besoin_operation_id?.slice(0, 8) || 'null'
        });
      }
    }
  }
  
  console.log(`\n✅ ${successCount}/${updates.length} assignations écrites avec succès`);
  
  // 🔍 DIAGNOSTIC 9: Vérification post-écriture pour BLOC
  if (updatesWithBlocIds.length > 0) {
    console.log(`\n🔬 Vérification post-écriture (échantillon BLOC)...`);
    const sampleBlocUpdates = updatesWithBlocIds.slice(0, 3);
    for (const update of sampleBlocUpdates) {
      const { data: verif, error: verifError } = await supabase
        .from('capacite_effective')
        .select('id, planning_genere_bloc_operatoire_id, besoin_operation_id, site_id')
        .eq('id', update.id)
        .single();
      
      if (verifError) {
        console.error(`  ❌ Erreur lecture capacite ${update.id}:`, verifError);
      } else {
        console.log(`  🔬 Vérif capacite ${verif.id?.slice(0, 8)}:`, {
          bloc_op: verif.planning_genere_bloc_operatoire_id?.slice(0, 8),
          besoin_op: verif.besoin_operation_id?.slice(0, 8),
          site_id: verif.site_id?.slice(0, 8)
        });
      }
    }
  }
}
