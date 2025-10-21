import { supabase } from '@/integrations/supabase/client';

export interface ExchangeCapacite {
  id: string;
  secretaire_id: string;
  site_id: string;
  besoin_operation_id: string | null;
  planning_genere_bloc_operatoire_id: string | null;
  is_1r: boolean;
  is_2f: boolean;
  is_3f: boolean;
  demi_journee: 'matin' | 'apres_midi';
}

export interface SecretaireForExchange {
  secretaire_id: string;
  nom: string;
  site_nom: string;
  periode: 'matin' | 'apres_midi' | 'journee';
  capacites: ExchangeCapacite[];
  is_1r: boolean;
  is_2f: boolean;
  is_3f: boolean;
}

/**
 * Fetch available secretaries for exchange based on site and competency compatibility
 */
export async function fetchAvailableSecretairesForExchange(
  date: string,
  currentSecretaireId: string,
  currentSiteId: string,
  exchangeType: 'journee' | 'matin' | 'apres_midi',
  currentBesoinOperationId?: string | null
): Promise<SecretaireForExchange[]> {
  try {
    const ADMIN_SITE_ID = '00000000-0000-0000-0000-000000000001';
    
    // Get site info to check if it's bloc opératoire
    const { data: currentSiteData } = await supabase
      .from('sites')
      .select('nom')
      .eq('id', currentSiteId)
      .single();
    
    const isCurrentSiteBlocOp = currentSiteData?.nom?.toLowerCase().includes('bloc opératoire') || false;
    const isCurrentSiteAdmin = currentSiteId === ADMIN_SITE_ID;

    // Fetch current secretaire's compatible sites and besoins
    const { data: currentSecretaireSites } = await supabase
      .from('secretaires_sites')
      .select('site_id')
      .eq('secretaire_id', currentSecretaireId);

    const currentCompatibleSiteIds = currentSecretaireSites?.map(s => s.site_id) || [];

    // Fetch current secretaire's besoins operations if needed
    const { data: currentSecretaireBesoins } = await supabase
      .from('secretaires_besoins_operations')
      .select('besoin_operation_id')
      .eq('secretaire_id', currentSecretaireId);

    const currentBesoinIds = currentSecretaireBesoins?.map(b => b.besoin_operation_id) || [];

    // Fetch all capacites for the date
    const { data: capacites } = await supabase
      .from('capacite_effective')
      .select(`
        id,
        secretaire_id,
        site_id,
        besoin_operation_id,
        planning_genere_bloc_operatoire_id,
        is_1r,
        is_2f,
        is_3f,
        demi_journee,
        sites (nom),
        secretaires (first_name, name)
      `)
      .eq('date', date)
      .eq('actif', true)
      .neq('secretaire_id', currentSecretaireId);

    if (!capacites) return [];

    // Group by secretaire
    const secretairesMap = new Map<string, SecretaireForExchange>();

    for (const cap of capacites) {
      if (!cap.secretaires || !cap.sites) continue;

      const secretaireId = cap.secretaire_id!;
      const nom = `${cap.secretaires.first_name || ''} ${cap.secretaires.name || ''}`.trim();
      const siteNom = cap.sites.nom;

      if (!secretairesMap.has(secretaireId)) {
        secretairesMap.set(secretaireId, {
          secretaire_id: secretaireId,
          nom,
          site_nom: siteNom,
          periode: cap.demi_journee === 'matin' ? 'matin' : 'apres_midi',
          capacites: [],
          is_1r: cap.is_1r || false,
          is_2f: cap.is_2f || false,
          is_3f: cap.is_3f || false,
        });
      }

      const sec = secretairesMap.get(secretaireId)!;
      sec.capacites.push({
        id: cap.id,
        secretaire_id: secretaireId,
        site_id: cap.site_id,
        besoin_operation_id: cap.besoin_operation_id,
        planning_genere_bloc_operatoire_id: cap.planning_genere_bloc_operatoire_id,
        is_1r: cap.is_1r || false,
        is_2f: cap.is_2f || false,
        is_3f: cap.is_3f || false,
        demi_journee: cap.demi_journee as 'matin' | 'apres_midi',
      });

      // Update periode if both morning and afternoon
      if (sec.capacites.some(c => c.demi_journee === 'matin') && 
          sec.capacites.some(c => c.demi_journee === 'apres_midi')) {
        sec.periode = 'journee';
      }

      // Update role badges
      if (cap.is_1r) sec.is_1r = true;
      if (cap.is_2f) sec.is_2f = true;
      if (cap.is_3f) sec.is_3f = true;
    }

    // Filter based on exchange type and compatibility
    const filtered: SecretaireForExchange[] = [];

    for (const sec of Array.from(secretairesMap.values())) {
      // Check if secretaire has the required period
      if (exchangeType === 'journee' && sec.periode !== 'journee') continue;
      if (exchangeType === 'matin' && !sec.capacites.some(c => c.demi_journee === 'matin')) continue;
      if (exchangeType === 'apres_midi' && !sec.capacites.some(c => c.demi_journee === 'apres_midi')) continue;

      const otherSiteId = sec.capacites[0]?.site_id;
      const otherBesoinOperationId = sec.capacites[0]?.besoin_operation_id;

      // Check if other's site is admin or bloc opératoire
      const { data: otherSiteData } = await supabase
        .from('sites')
        .select('nom')
        .eq('id', otherSiteId)
        .single();
      
      const isOtherSiteBlocOp = otherSiteData?.nom?.toLowerCase().includes('bloc opératoire') || false;
      const isOtherSiteAdmin = otherSiteId === ADMIN_SITE_ID;

      // Get other secretaire's site preferences and besoins
      const { data: otherSecretaireSites } = await supabase
        .from('secretaires_sites')
        .select('site_id')
        .eq('secretaire_id', sec.secretaire_id);

      const otherCompatibleSiteIds = otherSecretaireSites?.map(s => s.site_id) || [];

      const { data: otherSecretaireBesoins } = await supabase
        .from('secretaires_besoins_operations')
        .select('besoin_operation_id')
        .eq('secretaire_id', sec.secretaire_id);

      const otherBesoinIds = otherSecretaireBesoins?.map(b => b.besoin_operation_id) || [];

      // RULE 1: Current secretaire can work at other's site
      // - If other site is admin or bloc opératoire: always OK
      // - Otherwise: check if in current secretaire's site preferences
      if (!isOtherSiteAdmin && !isOtherSiteBlocOp) {
        if (otherSiteId && !currentCompatibleSiteIds.includes(otherSiteId)) continue;
      }

      // RULE 2: For bloc opératoire, check besoins operations
      if (isOtherSiteBlocOp && otherBesoinOperationId) {
        if (!currentBesoinIds.includes(otherBesoinOperationId)) continue;
      }

      // RULE 3: Other secretaire can work at current site
      // - If current site is admin: always OK (no check needed)
      // - If current site is bloc opératoire: check besoins operations
      // - Otherwise: check if in other secretaire's site preferences
      if (isCurrentSiteAdmin) {
        // Admin site: everyone can work here, no check needed
      } else if (isCurrentSiteBlocOp) {
        // Bloc opératoire: check if other secretaire has the required besoin operation
        if (currentBesoinOperationId && !otherBesoinIds.includes(currentBesoinOperationId)) continue;
      } else {
        // Regular site: check site preferences
        if (!otherCompatibleSiteIds.includes(currentSiteId)) continue;
      }

      filtered.push(sec);
    }

    return filtered;
  } catch (error) {
    console.error('Error fetching available secretaires:', error);
    return [];
  }
}

/**
 * Exchange capacities between two secretaries
 */
export async function exchangeSecretaires(
  secretaireAId: string,
  secretaireBId: string,
  date: string,
  exchangeType: 'journee' | 'matin' | 'apres_midi'
): Promise<{ success: boolean; error?: string }> {
  try {
    // Fetch capacites for both secretaries
    const { data: capacitesA } = await supabase
      .from('capacite_effective')
      .select('*')
      .eq('secretaire_id', secretaireAId)
      .eq('date', date)
      .eq('actif', true);

    const { data: capacitesB } = await supabase
      .from('capacite_effective')
      .select('*')
      .eq('secretaire_id', secretaireBId)
      .eq('date', date)
      .eq('actif', true);

    if (!capacitesA || !capacitesB) {
      return { success: false, error: 'Capacités introuvables' };
    }

    // Filter based on exchange type
    let capsA = capacitesA;
    let capsB = capacitesB;

    if (exchangeType === 'matin') {
      capsA = capacitesA.filter(c => c.demi_journee === 'matin');
      capsB = capacitesB.filter(c => c.demi_journee === 'matin');
    } else if (exchangeType === 'apres_midi') {
      capsA = capacitesA.filter(c => c.demi_journee === 'apres_midi');
      capsB = capacitesB.filter(c => c.demi_journee === 'apres_midi');
    }

    if (capsA.length === 0 || capsB.length === 0) {
      return { success: false, error: 'Aucune capacité pour la période sélectionnée' };
    }

    // For each slot, exchange the data
    const updates = [];

    for (const capA of capsA) {
      const capB = capsB.find(c => c.demi_journee === capA.demi_journee);
      if (!capB) continue;

      // Determine which fields to exchange
      const fieldsToExchange: any = {
        site_id: true,
        besoin_operation_id: true,
        planning_genere_bloc_operatoire_id: true,
      };

      // Only exchange 1R/2F/3F for full day exchanges
      if (exchangeType === 'journee') {
        fieldsToExchange.is_1r = true;
        fieldsToExchange.is_2f = true;
        fieldsToExchange.is_3f = true;
      }

      // Prepare updates for A (receives B's data)
      const updateA: any = {};
      if (fieldsToExchange.site_id) updateA.site_id = capB.site_id;
      if (fieldsToExchange.besoin_operation_id) updateA.besoin_operation_id = capB.besoin_operation_id;
      if (fieldsToExchange.planning_genere_bloc_operatoire_id) updateA.planning_genere_bloc_operatoire_id = capB.planning_genere_bloc_operatoire_id;
      if (fieldsToExchange.is_1r) updateA.is_1r = capB.is_1r;
      if (fieldsToExchange.is_2f) updateA.is_2f = capB.is_2f;
      if (fieldsToExchange.is_3f) updateA.is_3f = capB.is_3f;

      // Prepare updates for B (receives A's data)
      const updateB: any = {};
      if (fieldsToExchange.site_id) updateB.site_id = capA.site_id;
      if (fieldsToExchange.besoin_operation_id) updateB.besoin_operation_id = capA.besoin_operation_id;
      if (fieldsToExchange.planning_genere_bloc_operatoire_id) updateB.planning_genere_bloc_operatoire_id = capA.planning_genere_bloc_operatoire_id;
      if (fieldsToExchange.is_1r) updateB.is_1r = capA.is_1r;
      if (fieldsToExchange.is_2f) updateB.is_2f = capA.is_2f;
      if (fieldsToExchange.is_3f) updateB.is_3f = capA.is_3f;

      updates.push(
        supabase.from('capacite_effective').update(updateA).eq('id', capA.id),
        supabase.from('capacite_effective').update(updateB).eq('id', capB.id)
      );
    }

    // Execute all updates
    const results = await Promise.all(updates);
    const hasError = results.some(r => r.error);

    if (hasError) {
      return { success: false, error: 'Erreur lors de l\'échange' };
    }

    return { success: true };
  } catch (error) {
    console.error('Error exchanging secretaires:', error);
    return { success: false, error: 'Erreur inattendue' };
  }
}
