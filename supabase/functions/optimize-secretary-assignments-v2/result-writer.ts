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

  // Lister les variables assignées (=1)
  const assignedVars = Object.entries(solution)
    .filter(([k, v]) => k.startsWith('assign_') && v === 1)
    .map(([k]) => k);
  console.log(`  🔎 Variables assignées (=1): ${assignedVars.length}`);
  assignedVars.slice(0, 20).forEach((v, i) => console.log(`    [${i + 1}] ${v}`));

  // Parcours des variables assignées
  for (const varName of assignedVars) {
    // Format attendu: assign_{secretaire_id}_{site_id}_{date}_{periode}
    // Note: periode peut contenir un underscore ("apres_midi") → on détecte par suffixe
    let periode: 'matin' | 'apres_midi' | undefined;
    if (varName.endsWith('_apres_midi')) {
      periode = 'apres_midi';
    } else if (varName.endsWith('_matin')) {
      periode = 'matin';
    }

    if (!periode) {
      console.warn(`⚠️ Période introuvable dans le nom de variable: ${varName}`);
      continue;
    }

    const core = varName.slice('assign_'.length);
    const coreSansPeriode = core.slice(0, -('_' + periode).length);
    const [secretaire_id, site_id, dateStr] = coreSansPeriode.split('_');

    if (!secretaire_id || !site_id || !dateStr) {
      console.warn(`⚠️ Parsing invalide pour ${varName} → {secretaire_id:${secretaire_id}}, {site_id:${site_id}}, {date:${dateStr}}`);
      continue;
    }

    if (dateStr !== date) {
      console.warn(`⚠️ Mismatch de date (var=${dateStr} vs param=${date}) pour ${varName}`);
    }

    // Recherche de la capacité correspondante
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
        .map((c) => ({ id: c.id, demi_journee: c.demi_journee, site_id: (c as any).site_id }))
        .slice(0, 10);
      console.warn(`   🔍 Capacités disponibles ce jour pour ${secretaire_id}:`, caps);
      continue;
    }

    // Recherche du besoin correspondant
    const need = needs.find(
      (n) => n.site_id === site_id && n.date === date && n.periode === periode
    );

    if (!need) {
      console.warn(`⚠️ Besoin non trouvé pour ${varName}`);
      const dayNeedsForSite = needs
        .filter((n) => n.site_id === site_id && n.date === date)
        .map((n) => ({ periode: n.periode, type: n.type, nombre_max: n.nombre_max }))
        .slice(0, 10);
      console.warn(`   🔍 Besoins connus ce jour pour site ${site_id}:`, dayNeedsForSite);
      continue;
    }

    assignedCount++;

    // Préparer l'update
    const update: any = {
      id: capacite.id,
      site_id: site_id,
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

    console.log(`\n  ✅ Assignation ${assignedCount}:`, {
      secretaire_id,
      site_id,
      date,
      periode,
      capacite_id: capacite.id,
      need_type: need?.type,
      bloc_operation_id: (need as any)?.bloc_operation_id,
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
