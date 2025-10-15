import { supabase } from '@/integrations/supabase/client';

/**
 * Get available secretaries for a site assignment
 */
export async function getAvailableSecretariesForSite(
  date: string,
  periode: 'matin' | 'apres_midi',
  siteId: string
) {
  // Get all active secretaries who have this site in their profile
  const { data: secretaries, error: secError } = await supabase
    .from('secretaires')
    .select('id, first_name, name, sites_assignes')
    .eq('actif', true);

  if (secError) throw secError;

  // Filter those who have the site in their profile
  const eligibleSecs = (secretaries || []).filter(s => 
    s.sites_assignes && s.sites_assignes.includes(siteId)
  );

  // Get already assigned secretaries for this date/periode
  const { data: assignments, error: assignError } = await supabase
    .from('planning_genere_personnel')
    .select('secretaire_id')
    .eq('date', date)
    .eq('periode', periode)
    .not('secretaire_id', 'is', null);

  if (assignError) throw assignError;

  const assignedIds = new Set((assignments || []).map(a => a.secretaire_id));

  // Return only non-assigned secretaries, sorted alphabetically
  return eligibleSecs
    .filter(s => !assignedIds.has(s.id))
    .sort((a, b) => {
      const nameA = `${a.first_name} ${a.name}`.toLowerCase();
      const nameB = `${b.first_name} ${b.name}`.toLowerCase();
      return nameA.localeCompare(nameB, 'fr');
    });
}

/**
 * Get available secretaries for a bloc assignment based on type_besoin_bloc
 */
export async function getAvailableSecretariesForBloc(
  date: string,
  periode: 'matin' | 'apres_midi',
  typeBesoinBloc: string
) {
  let filter: any = { actif: true };

  // Apply specific filters based on type
  switch (typeBesoinBloc) {
    case 'instrumentiste':
      filter.instrumentaliste = true;
      break;
    case 'aide_salle':
      filter.aide_de_salle = true;
      break;
    case 'instrumentiste_aide_salle':
      // Either instrumentiste OR aide_de_salle
      break;
    case 'anesthesiste':
      filter.anesthesiste = true;
      break;
    case 'accueil_dermato':
      filter.bloc_dermato_accueil = true;
      break;
    case 'accueil_ophtalmo':
      filter.bloc_ophtalmo_accueil = true;
      break;
    default:
      filter.personnel_bloc_operatoire = true;
  }

  const { data: secretaries, error: secError } = await supabase
    .from('secretaires')
    .select('id, first_name, name, instrumentaliste, aide_de_salle, anesthesiste, bloc_dermato_accueil, bloc_ophtalmo_accueil, personnel_bloc_operatoire')
    .match(filter);

  if (secError) throw secError;

  let eligibleSecs = secretaries || [];

  // For instrumentiste_aide_salle, manually filter
  if (typeBesoinBloc === 'instrumentiste_aide_salle') {
    eligibleSecs = eligibleSecs.filter(s => s.instrumentaliste || s.aide_de_salle);
  }

  // Get already assigned secretaries for this date/periode
  const { data: assignments, error: assignError } = await supabase
    .from('planning_genere_personnel')
    .select('secretaire_id')
    .eq('date', date)
    .eq('periode', periode)
    .not('secretaire_id', 'is', null);

  if (assignError) throw assignError;

  const assignedIds = new Set((assignments || []).map(a => a.secretaire_id));

  // Return only non-assigned secretaries, sorted alphabetically
  return eligibleSecs
    .filter(s => !assignedIds.has(s.id))
    .sort((a, b) => {
      const nameA = `${a.first_name} ${a.name}`.toLowerCase();
      const nameB = `${b.first_name} ${b.name}`.toLowerCase();
      return nameA.localeCompare(nameB, 'fr');
    });
}

/**
 * Get assigned secretaries for a given site/date/periode
 */
export async function getAssignedSecretariesForSite(
  date: string,
  periode: 'matin' | 'apres_midi',
  siteId: string
) {
  const { data, error } = await supabase
    .from('planning_genere_personnel')
    .select(`
      id,
      secretaire_id,
      ordre,
      is_1r,
      is_2f,
      is_3f,
      secretaires!secretaire_id(first_name, name, sites_assignes)
    `)
    .eq('date', date)
    .eq('periode', periode)
    .eq('site_id', siteId)
    .eq('type_assignation', 'site')
    .not('secretaire_id', 'is', null)
    .order('ordre');

  if (error) throw error;
  return data || [];
}

/**
 * Get compatible secretaries for swapping with a given secretary
 * Both must be able to work at each other's sites
 */
export async function getCompatibleSecretariesForSwap(
  currentAssignmentId: string,
  date: string,
  periode: 'matin' | 'apres_midi'
): Promise<any[]> {
  // First, get the current assignment to know secretary and site
  const { data: currentAssignment, error: errorCurrent } = await supabase
    .from('planning_genere_personnel')
    .select(`
      id,
      secretaire_id,
      site_id,
      secretaires:secretaires!planning_genere_personnel_secretaire_id_fkey (
        id,
        first_name,
        name,
        sites_assignes
      )
    `)
    .eq('id', currentAssignmentId)
    .single();

  if (errorCurrent || !currentAssignment) {
    console.error('Error fetching current assignment:', errorCurrent);
    return [];
  }

  const currentSiteId = currentAssignment.site_id;
  const secretaryAId = currentAssignment.secretaire_id;
  const sitesA = currentAssignment.secretaires?.sites_assignes || [];

  // Get all secretaries assigned on the same date and periode, on DIFFERENT sites
  const { data: assignments, error: errorAssignments } = await supabase
    .from('planning_genere_personnel')
    .select(`
      id,
      secretaire_id,
      site_id,
      is_1r,
      is_2f,
      is_3f,
      sites:sites!planning_genere_personnel_site_id_fkey (
        id,
        nom
      ),
      secretaires:secretaires!planning_genere_personnel_secretaire_id_fkey (
        id,
        first_name,
        name,
        sites_assignes
      )
    `)
    .eq('date', date)
    .eq('periode', periode)
    .eq('type_assignation', 'site')
    .neq('secretaire_id', secretaryAId)
    .neq('site_id', currentSiteId); // Only different sites

  if (errorAssignments || !assignments) {
    console.error('Error fetching assignments:', errorAssignments);
    return [];
  }

  // Filter compatible secretaries:
  // - Secretary A can cover secretary B's site
  // - Secretary B can cover the current site
  const compatible = assignments
    .filter((assignment: any) => {
      if (!assignment.secretaires) return false;
      
      const sitesB = assignment.secretaires.sites_assignes || [];
      const siteB = assignment.site_id;

      // Check if A can cover B's site and B can cover current site
      const aCanCoverB = sitesA.includes(siteB);
      const bCanCoverCurrent = sitesB.includes(currentSiteId);

      return aCanCoverB && bCanCoverCurrent;
    })
    .map((assignment: any) => ({
      ...assignment.secretaires,
      assignment_id: assignment.id,
      site_nom: assignment.sites?.nom || '',
      is_1r: assignment.is_1r,
      is_2f: assignment.is_2f,
      is_3f: assignment.is_3f,
    }));

  return compatible.sort((a: any, b: any) => {
    const nameA = `${a.first_name} ${a.name}`.toLowerCase();
    const nameB = `${b.first_name} ${b.name}`.toLowerCase();
    return nameA.localeCompare(nameB);
  });
}

/**
 * Get full day assignments for a secretary on a specific date
 * Returns the IDs of morning and afternoon assignments if they exist as a full day
 */
export async function getFullDayAssignments(
  date: string,
  secretaryId: string
): Promise<{ morningId: string | null; afternoonId: string | null; isFullDay: boolean }> {
  const { data: assignments, error } = await supabase
    .from('planning_genere_personnel')
    .select('id, periode, site_id, type_assignation')
    .eq('date', date)
    .eq('secretaire_id', secretaryId)
    .in('periode', ['matin', 'apres_midi']);

  if (error) {
    console.error('Error fetching full day assignments:', error);
    return { morningId: null, afternoonId: null, isFullDay: false };
  }

  const matin = assignments?.find(a => a.periode === 'matin');
  const apresMidi = assignments?.find(a => a.periode === 'apres_midi');

  // It's a full day if both periods exist with the same site and type
  const isFullDay = !!(
    matin && 
    apresMidi && 
    matin.site_id === apresMidi.site_id &&
    matin.type_assignation === apresMidi.type_assignation
  );

  return {
    morningId: matin?.id || null,
    afternoonId: apresMidi?.id || null,
    isFullDay
  };
}
