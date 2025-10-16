import { supabase } from '@/integrations/supabase/client';

/**
 * Get available secretaries for a site assignment
 */
export async function getAvailableSecretariesForSite(
  date: string,
  periode: 'matin' | 'apres_midi',
  siteId: string
) {
  // Get secretaries who have this site assigned (any priority)
  const { data: secretarySites, error: siteError } = await supabase
    .from('secretaires_sites')
    .select(`
      secretaire_id,
      secretaires!inner (
        id,
        first_name,
        name,
        actif
      )
    `)
    .eq('site_id', siteId);

  if (siteError) throw siteError;

  // Filter only active secretaries
  const eligibleSecs = (secretarySites || [])
    .filter((ss: any) => ss.secretaires?.actif)
    .map((ss: any) => ss.secretaires);

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
    .filter((s: any) => !assignedIds.has(s.id))
    .sort((a: any, b: any) => {
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
    .select(`
      id, 
      first_name, 
      name,
      secretaires_besoins_operations(
        besoins_operations(code)
      )
    `)
    .eq('actif', true);

  if (secError) throw secError;

  let eligibleSecs = (secretaries || []).filter(s => {
    const besoins = s.secretaires_besoins_operations?.map(sb => sb.besoins_operations?.code) || [];
    
    switch (typeBesoinBloc) {
      case 'instrumentiste': return besoins.includes('instrumentiste');
      case 'aide_salle': return besoins.includes('aide_salle');
      case 'instrumentiste_aide_salle': 
        return besoins.includes('instrumentiste') || besoins.includes('aide_salle') || besoins.includes('instrumentiste_aide_salle');
      case 'anesthesiste': return besoins.includes('anesthesiste');
      case 'accueil_dermato': return besoins.includes('accueil_dermato');
      case 'accueil_ophtalmo': return besoins.includes('accueil_ophtalmo');
      default: return false;
    }
  });

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
      secretaires!secretaire_id(first_name, name)
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
 * Also includes administrative secretaries who can cover the current site
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
      type_assignation,
      secretaires:secretaires!planning_genere_personnel_secretaire_id_fkey (
        id,
        first_name,
        name
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

  // Get sites for secretary A from secretaires_sites
  const { data: sitesA, error: errorSitesA } = await supabase
    .from('secretaires_sites')
    .select('site_id')
    .eq('secretaire_id', secretaryAId);

  if (errorSitesA) {
    console.error('Error fetching sites for secretary A:', errorSitesA);
    return [];
  }

  const sitesAIds = (sitesA || []).map(s => s.site_id);

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
      type_assignation,
      sites:sites!planning_genere_personnel_site_id_fkey (
        id,
        nom
      ),
      secretaires:secretaires!planning_genere_personnel_secretaire_id_fkey (
        id,
        first_name,
        name
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

  // Get administrative secretaries
  const { data: adminAssignments, error: errorAdmin } = await supabase
    .from('planning_genere_personnel')
    .select(`
      id,
      secretaire_id,
      secretaires:secretaires!planning_genere_personnel_secretaire_id_fkey (
        id,
        first_name,
        name
      )
    `)
    .eq('date', date)
    .eq('periode', periode)
    .eq('type_assignation', 'administratif')
    .neq('secretaire_id', secretaryAId);

  if (errorAdmin) {
    console.error('Error fetching admin assignments:', errorAdmin);
  }

  // Get sites for all these secretaries
  const secretaryBIds = assignments.map((a: any) => a.secretaire_id);
  const adminSecretaryIds = (adminAssignments || []).map((a: any) => a.secretaire_id);
  const allSecretaryIds = [...secretaryBIds, ...adminSecretaryIds];

  const { data: sitesBData, error: errorSitesB } = await supabase
    .from('secretaires_sites')
    .select('secretaire_id, site_id')
    .in('secretaire_id', allSecretaryIds);

  if (errorSitesB) {
    console.error('Error fetching sites for secretaries B:', errorSitesB);
    return [];
  }

  // Build map: secretaire_id -> [site_ids]
  const sitesBMap = new Map<string, string[]>();
  for (const sb of (sitesBData || [])) {
    if (!sitesBMap.has(sb.secretaire_id)) {
      sitesBMap.set(sb.secretaire_id, []);
    }
    sitesBMap.get(sb.secretaire_id)!.push(sb.site_id);
  }

  // Filter compatible secretaries:
  // - Secretary A can cover secretary B's site
  // - Secretary B can cover the current site
  const compatible = assignments
    .filter((assignment: any) => {
      if (!assignment.secretaires) return false;
      
      const sitesB = sitesBMap.get(assignment.secretaire_id) || [];
      const siteB = assignment.site_id;

      // Check if A can cover B's site and B can cover current site
      const aCanCoverB = sitesAIds.includes(siteB);
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

  // Add compatible administrative secretaries
  // An admin secretary can swap if they can cover the current site
  const compatibleAdmin = (adminAssignments || [])
    .filter((assignment: any) => {
      if (!assignment.secretaires) return false;
      
      const sitesB = sitesBMap.get(assignment.secretaire_id) || [];
      
      // Check if the admin secretary can cover the current site
      return sitesB.includes(currentSiteId);
    })
    .map((assignment: any) => ({
      ...assignment.secretaires,
      assignment_id: assignment.id,
      site_nom: 'Administratif',
      is_1r: false,
      is_2f: false,
      is_3f: false,
    }));

  const allCompatible = [...compatible, ...compatibleAdmin];

  return allCompatible.sort((a: any, b: any) => {
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
