import type { SecretaryScore } from './scoring.ts';
import { calculatePenalizedScore, calculateGlobalMetrics, cloneScores } from './scoring.ts';

export interface ClosingSiteForOptim {
  site_id: string;
  site_nom: string;
  date: string;
  full_day_secretaries: string[];
  needs_2f: boolean;
  needs_3f: boolean;
  eligible_count: number;
  current_1r?: string;
  current_2f3f?: string;
}

export async function assignPhase1(
  closingSites: ClosingSiteForOptim[],
  currentWeekScores: Map<string, SecretaryScore>,
  has2F3FThisWeek: Set<string>,
  secretaries: any[],
  supabase: any
): Promise<number> {
  console.log('\n🏗️ PHASE 1: Assignation initiale par contraintes');
  
  let assignmentsCount = 0;
  
  const sortedSites = [...closingSites].sort((a, b) => {
    if (a.eligible_count !== b.eligible_count) return a.eligible_count - b.eligible_count;
    return a.date.localeCompare(b.date);
  });
  
  console.log('\n📍 Étape 1A: Sites avec exactement 2 secrétaires');
  const sites2 = sortedSites.filter(s => s.eligible_count === 2);
  
  for (const site of sites2) {
    const assigned = await assignSite2Secretaries(
      site, currentWeekScores, has2F3FThisWeek, secretaries, supabase
    );
    if (assigned) assignmentsCount++;
  }
  
  console.log('\n📍 Étape 1B: Sites avec 3 secrétaires');
  const sites3 = sortedSites.filter(s => s.eligible_count === 3);
  
  for (const site of sites3) {
    const assigned = await assignSiteWithChoice(
      site, currentWeekScores, has2F3FThisWeek, secretaries, supabase
    );
    if (assigned) assignmentsCount++;
  }
  
  console.log('\n📍 Étape 1C: Sites avec 4+ secrétaires');
  const sites4plus = sortedSites.filter(s => s.eligible_count >= 4);
  
  for (const site of sites4plus) {
    const assigned = await assignSiteWithChoice(
      site, currentWeekScores, has2F3FThisWeek, secretaries, supabase
    );
    if (assigned) assignmentsCount++;
  }
  
  console.log(`\n✅ Phase 1 terminée: ${assignmentsCount} sites assignés`);
  return assignmentsCount;
}

async function assignSite2Secretaries(
  site: ClosingSiteForOptim,
  scores: Map<string, SecretaryScore>,
  has2F3F: Set<string>,
  secretaries: any[],
  supabase: any
): Promise<boolean> {
  const [sec1_id, sec2_id] = site.full_day_secretaries;
  
  const sec1_has_2f3f = has2F3F.has(sec1_id);
  const sec2_has_2f3f = has2F3F.has(sec2_id);
  
  let responsable_2f3f: string;
  let responsable_1r: string;
  
  if (sec1_has_2f3f && sec2_has_2f3f) {
    console.log(`  ❌ ${site.site_nom} (${site.date}): impossible (les 2 ont déjà 2F/3F)`);
    return false;
  } else if (sec1_has_2f3f) {
    responsable_2f3f = sec2_id;
    responsable_1r = sec1_id;
  } else if (sec2_has_2f3f) {
    responsable_2f3f = sec1_id;
    responsable_1r = sec2_id;
  } else {
    const score1 = scores.get(sec1_id);
    const score2 = scores.get(sec2_id);
    
    const defaultScore = { id: '', name: '', score: 0, count_1r: 0, count_2f: 0, count_3f: 0 };
    const penalized1 = calculatePenalizedScore(score1 || { ...defaultScore, id: sec1_id });
    const penalized2 = calculatePenalizedScore(score2 || { ...defaultScore, id: sec2_id });
    
    if (penalized1.total_score <= penalized2.total_score) {
      responsable_2f3f = sec1_id;
      responsable_1r = sec2_id;
    } else {
      responsable_2f3f = sec2_id;
      responsable_1r = sec1_id;
    }
  }
  
  return await applyAssignment(
    site, responsable_1r, responsable_2f3f, scores, has2F3F, secretaries, supabase
  );
}

async function assignSiteWithChoice(
  site: ClosingSiteForOptim,
  scores: Map<string, SecretaryScore>,
  has2F3F: Set<string>,
  secretaries: any[],
  supabase: any
): Promise<boolean> {
  const eligible_2f3f = site.full_day_secretaries.filter(id => !has2F3F.has(id));
  
  if (eligible_2f3f.length === 0) {
    console.log(`  ❌ ${site.site_nom} (${site.date}): toutes ont déjà 2F/3F`);
    return false;
  }
  
  let bestCombo: { 
    responsable_1r: string; 
    responsable_2f3f: string; 
    sum_squared_scores: number;
  } | null = null;
  
  for (const candidate_2f3f of eligible_2f3f) {
    for (const candidate_1r of site.full_day_secretaries) {
      if (candidate_1r === candidate_2f3f) continue;
      
      const tempScores = cloneScores(scores);
      simulateAssignment(site, candidate_1r, candidate_2f3f, tempScores);
      
      const metrics = calculateGlobalMetrics(tempScores);
      
      if (!bestCombo || metrics.sum_squared_scores < bestCombo.sum_squared_scores) {
        bestCombo = {
          responsable_1r: candidate_1r,
          responsable_2f3f: candidate_2f3f,
          sum_squared_scores: metrics.sum_squared_scores
        };
      }
    }
  }
  
  if (!bestCombo) return false;
  
  return await applyAssignment(
    site, bestCombo.responsable_1r, bestCombo.responsable_2f3f, 
    scores, has2F3F, secretaries, supabase
  );
}

function simulateAssignment(
  site: ClosingSiteForOptim,
  responsable_1r: string,
  responsable_2f3f: string,
  scores: Map<string, SecretaryScore>
) {
  const points2F3F = site.needs_3f ? 3 : 2;
  
  if (!scores.has(responsable_1r)) {
    scores.set(responsable_1r, { id: responsable_1r, name: '', score: 0, count_1r: 0, count_2f: 0, count_3f: 0 });
  }
  if (!scores.has(responsable_2f3f)) {
    scores.set(responsable_2f3f, { id: responsable_2f3f, name: '', score: 0, count_1r: 0, count_2f: 0, count_3f: 0 });
  }
  
  const score1R = scores.get(responsable_1r)!;
  score1R.score += 1;
  score1R.count_1r += 1;
  
  const score2F3F = scores.get(responsable_2f3f)!;
  score2F3F.score += points2F3F;
  if (site.needs_3f) score2F3F.count_3f += 1;
  else score2F3F.count_2f += 1;
}

async function applyAssignment(
  site: ClosingSiteForOptim,
  responsable_1r: string,
  responsable_2f3f: string,
  scores: Map<string, SecretaryScore>,
  has2F3F: Set<string>,
  secretaries: any[],
  supabase: any
): Promise<boolean> {
  const role2F3F = site.needs_3f ? 'is_3f' : 'is_2f';
  
  await supabase
    .from('capacite_effective')
    .update({ is_1r: true })
    .eq('date', site.date)
    .eq('site_id', site.site_id)
    .eq('secretaire_id', responsable_1r)
    .eq('actif', true);
  
  await supabase
    .from('capacite_effective')
    .update({ [role2F3F]: true })
    .eq('date', site.date)
    .eq('site_id', site.site_id)
    .eq('secretaire_id', responsable_2f3f)
    .eq('actif', true);
  
  simulateAssignment(site, responsable_1r, responsable_2f3f, scores);
  has2F3F.add(responsable_2f3f);
  
  site.current_1r = responsable_1r;
  site.current_2f3f = responsable_2f3f;
  
  const sec1R = secretaries.find(s => s.id === responsable_1r);
  const sec2F3F = secretaries.find(s => s.id === responsable_2f3f);
  console.log(`  ✓ ${site.site_nom} (${site.date}): ${sec1R?.first_name} ${sec1R?.name} (1R) + ${sec2F3F?.first_name} ${sec2F3F?.name} (${site.needs_3f ? '3F' : '2F'})`);
  
  return true;
}
