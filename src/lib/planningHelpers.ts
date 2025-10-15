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
  secretaryAId: string,
  date: string,
  periode: 'matin' | 'apres_midi'
) {
  // Get secretary A's profile
  const { data: secA, error: secAError } = await supabase
    .from('secretaires')
    .select('sites_assignes')
    .eq('id', secretaryAId)
    .single();

  if (secAError) throw secAError;

  const sitesOfA = secA.sites_assignes || [];

  // Get secretary A's assignments for this date
  const { data: assignmentsA, error: assignmentsAError } = await supabase
    .from('planning_genere_personnel')
    .select('site_id')
    .eq('secretaire_id', secretaryAId)
    .eq('date', date)
    .eq('type_assignation', 'site');

  if (assignmentsAError) throw assignmentsAError;

  const sitesWhereAWorks = assignmentsA.map(a => a.site_id);

  // Get all other secretaries working this day
  const { data: candidatesB, error: candidatesBError } = await supabase
    .from('planning_genere_personnel')
    .select(`
      secretaire_id,
      site_id,
      secretaires!secretaire_id(id, first_name, name, sites_assignes)
    `)
    .eq('date', date)
    .eq('type_assignation', 'site')
    .neq('secretaire_id', secretaryAId)
    .not('secretaire_id', 'is', null);

  if (candidatesBError) throw candidatesBError;

  // Build a map of secretary B -> sites where B works
  const secBSitesMap = new Map<string, Set<string>>();
  const secBInfoMap = new Map<string, any>();

  for (const assignment of candidatesB || []) {
    const secId = assignment.secretaire_id;
    if (!secId) continue;

    if (!secBSitesMap.has(secId)) {
      secBSitesMap.set(secId, new Set());
      secBInfoMap.set(secId, assignment.secretaires);
    }
    if (assignment.site_id) {
      secBSitesMap.get(secId)!.add(assignment.site_id);
    }
  }

  // Filter compatible secretaries
  const compatible = [];
  for (const [secBId, sitesWhereWorks] of secBSitesMap.entries()) {
    const secBInfo = secBInfoMap.get(secBId);
    if (!secBInfo) continue;

    const profileSitesB = secBInfo.sites_assignes || [];
    const sitesWhereBWorks = Array.from(sitesWhereWorks);

    // B must have in profile all sites where A works
    const bCanReplaceA = sitesWhereAWorks.every(siteA => profileSitesB.includes(siteA));

    // A must have in profile all sites where B works
    const aCanReplaceB = sitesWhereBWorks.every(siteB => sitesOfA.includes(siteB));

    if (bCanReplaceA && aCanReplaceB) {
      compatible.push({
        id: secBId,
        first_name: secBInfo.first_name,
        name: secBInfo.name,
      });
    }
  }

  // Sort alphabetically
  return compatible.sort((a, b) => {
    const nameA = `${a.first_name} ${a.name}`.toLowerCase();
    const nameB = `${b.first_name} ${b.name}`.toLowerCase();
    return nameA.localeCompare(nameB, 'fr');
  });
}
