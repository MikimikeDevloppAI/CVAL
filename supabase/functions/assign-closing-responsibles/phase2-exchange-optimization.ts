import type { SecretaryScore } from './scoring.ts';
import { calculateGlobalMetrics, isMetricsBetter, cloneScores } from './scoring.ts';
import type { ClosingSiteForOptim } from './phase1-constraint-assignment.ts';

interface Exchange {
  type: '1R<->2F3F' | 'full_swap';
  site1: {
    site_id: string;
    site_nom: string;
    date: string;
    current_1r: string;
    current_2f3f: string;
    is_3f: boolean;
  };
  site2?: {
    site_id: string;
    site_nom: string;
    date: string;
    current_1r: string;
    current_2f3f: string;
    is_3f: boolean;
  };
  description: string;
}

export async function optimizePhase2(
  assignedSites: ClosingSiteForOptim[],
  currentWeekScores: Map<string, SecretaryScore>,
  has2F3FThisWeek: Set<string>,
  secretaries: any[],
  supabase: any
): Promise<void> {
  console.log('\n🔄 PHASE 2: Optimisation par échanges');
  
  const MAX_ITERATIONS = 50;
  let currentMetrics = calculateGlobalMetrics(currentWeekScores);
  
  console.log(`📊 Métriques initiales:`);
  console.log(`   🎯 Somme (score-3)² : ${currentMetrics.sum_squared_excess.toFixed(2)}`);
  console.log(`   Secrétaires > 3 : ${currentMetrics.count_over_3}`);
  console.log(`   Score max : ${currentMetrics.max_score.toFixed(2)}`);
  
  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    console.log(`\n🔁 Itération ${iteration}...`);
    
    const allExchanges = generateAllExchanges(
      assignedSites, currentWeekScores, has2F3FThisWeek, secretaries
    );
    
    console.log(`   ${allExchanges.length} échanges possibles`);
    
    if (allExchanges.length === 0) {
      console.log('   ℹ️ Aucun échange possible');
      break;
    }
    
    let bestExchange: {
      exchange: Exchange;
      newScores: Map<string, SecretaryScore>;
      newMetrics: any;
      newHas2F3F: Set<string>;
    } | null = null;
    
    for (const exchange of allExchanges) {
      const tempScores = cloneScores(currentWeekScores);
      const tempHas2F3F = new Set(has2F3FThisWeek);
      
      applyExchangeToScores(exchange, tempScores, tempHas2F3F);
      
      const newMetrics = calculateGlobalMetrics(tempScores);
      
      if (isMetricsBetter(newMetrics, currentMetrics)) {
        if (!bestExchange || isMetricsBetter(newMetrics, bestExchange.newMetrics)) {
          bestExchange = { exchange, newScores: tempScores, newMetrics, newHas2F3F: tempHas2F3F };
        }
      }
    }
    
    if (!bestExchange) {
      console.log('   ✅ Convergence atteinte');
      break;
    }
    
    console.log(`   ✅ ${bestExchange.exchange.description}`);
    console.log(`      Avant: Σ(score-3)² = ${currentMetrics.sum_squared_excess.toFixed(2)}`);
    console.log(`      Après: Σ(score-3)² = ${bestExchange.newMetrics.sum_squared_excess.toFixed(2)}`);
    
    await applyExchangeToDatabase(bestExchange.exchange, supabase, assignedSites);
    
    currentWeekScores = bestExchange.newScores;
    currentMetrics = bestExchange.newMetrics;
    has2F3FThisWeek = bestExchange.newHas2F3F;
  }
  
  console.log('\n✅ Phase 2 terminée');
  console.log(`📊 Métriques finales:`);
  console.log(`   🎯 Somme (score-3)² : ${currentMetrics.sum_squared_excess.toFixed(2)}`);
  console.log(`   Secrétaires > 3 : ${currentMetrics.count_over_3}`);
}

function generateAllExchanges(
  sites: ClosingSiteForOptim[],
  scores: Map<string, SecretaryScore>,
  has2F3F: Set<string>,
  secretaries: any[]
): Exchange[] {
  const exchanges: Exchange[] = [];
  
  for (const site of sites) {
    const current_1r = site.current_1r;
    const current_2f3f = site.current_2f3f;
    
    if (!current_1r || !current_2f3f) continue;
    
    if (has2F3F.has(current_1r)) continue;
    
    const sec1 = secretaries.find(s => s.id === current_1r);
    const sec2 = secretaries.find(s => s.id === current_2f3f);
    
    exchanges.push({
      type: '1R<->2F3F',
      site1: {
        site_id: site.site_id,
        site_nom: site.site_nom,
        date: site.date,
        current_1r,
        current_2f3f,
        is_3f: site.needs_3f
      },
      description: `${sec1?.first_name} ${sec1?.name} ↔ ${sec2?.first_name} ${sec2?.name} sur ${site.site_nom} (${site.date})`
    });
  }
  
  for (let i = 0; i < sites.length; i++) {
    for (let j = i + 1; j < sites.length; j++) {
      const site1 = sites[i];
      const site2 = sites[j];
      
      const current_1r_s1 = site1.current_1r;
      const current_2f3f_s1 = site1.current_2f3f;
      const current_1r_s2 = site2.current_1r;
      const current_2f3f_s2 = site2.current_2f3f;
      
      if (!current_1r_s1 || !current_2f3f_s1 || !current_1r_s2 || !current_2f3f_s2) continue;
      
      const sec1_present_both = site1.full_day_secretaries.includes(current_1r_s2) &&
                                site2.full_day_secretaries.includes(current_1r_s1);
      const sec2_present_both = site1.full_day_secretaries.includes(current_2f3f_s2) &&
                                site2.full_day_secretaries.includes(current_2f3f_s1);
      
      if (!sec1_present_both || !sec2_present_both) continue;
      
      const score_2f3f_s1 = scores.get(current_2f3f_s1);
      const score_2f3f_s2 = scores.get(current_2f3f_s2);
      
      const total_2f3f_s1 = (score_2f3f_s1?.count_2f || 0) + (score_2f3f_s1?.count_3f || 0);
      const total_2f3f_s2 = (score_2f3f_s2?.count_2f || 0) + (score_2f3f_s2?.count_3f || 0);
      
      if (total_2f3f_s1 > 1 || total_2f3f_s2 > 1) continue;
      
      exchanges.push({
        type: 'full_swap',
        site1: {
          site_id: site1.site_id,
          site_nom: site1.site_nom,
          date: site1.date,
          current_1r: current_1r_s1,
          current_2f3f: current_2f3f_s1,
          is_3f: site1.needs_3f
        },
        site2: {
          site_id: site2.site_id,
          site_nom: site2.site_nom,
          date: site2.date,
          current_1r: current_1r_s2,
          current_2f3f: current_2f3f_s2,
          is_3f: site2.needs_3f
        },
        description: `Échange complet ${site1.site_nom} (${site1.date}) ↔ ${site2.site_nom} (${site2.date})`
      });
    }
  }
  
  return exchanges;
}

function applyExchangeToScores(
  exchange: Exchange,
  scores: Map<string, SecretaryScore>,
  has2F3F: Set<string>
) {
  if (exchange.type === '1R<->2F3F') {
    const { current_1r, current_2f3f, is_3f } = exchange.site1;
    const points2F3F = is_3f ? 4 : 3;
    
    const score1R = scores.get(current_1r)!;
    const score2F3F = scores.get(current_2f3f)!;
    
    score1R.score = score1R.score - 1 + points2F3F;
    score1R.count_1r -= 1;
    if (is_3f) score1R.count_3f += 1; else score1R.count_2f += 1;
    
    score2F3F.score = score2F3F.score - points2F3F + 1;
    if (is_3f) score2F3F.count_3f -= 1; else score2F3F.count_2f -= 1;
    score2F3F.count_1r += 1;
    
    has2F3F.delete(current_2f3f);
    has2F3F.add(current_1r);
    
  } else if (exchange.type === 'full_swap' && exchange.site2) {
    const s1 = exchange.site1;
    const s2 = exchange.site2;
    
    const points2F3F_s1 = s1.is_3f ? 4 : 3;
    const points2F3F_s2 = s2.is_3f ? 4 : 3;
    
    const score_1r_s1 = scores.get(s1.current_1r)!;
    const score_1r_s2 = scores.get(s2.current_1r)!;
    
    score_1r_s1.score -= 1;
    score_1r_s1.count_1r -= 1;
    score_1r_s2.score += 1;
    score_1r_s2.count_1r += 1;
    
    score_1r_s2.score -= 1;
    score_1r_s2.count_1r -= 1;
    score_1r_s1.score += 1;
    score_1r_s1.count_1r += 1;
    
    const score_2f3f_s1 = scores.get(s1.current_2f3f)!;
    const score_2f3f_s2 = scores.get(s2.current_2f3f)!;
    
    score_2f3f_s1.score -= points2F3F_s1;
    if (s1.is_3f) score_2f3f_s1.count_3f -= 1; else score_2f3f_s1.count_2f -= 1;
    score_2f3f_s2.score += points2F3F_s1;
    if (s1.is_3f) score_2f3f_s2.count_3f += 1; else score_2f3f_s2.count_2f += 1;
    
    score_2f3f_s2.score -= points2F3F_s2;
    if (s2.is_3f) score_2f3f_s2.count_3f -= 1; else score_2f3f_s2.count_2f -= 1;
    score_2f3f_s1.score += points2F3F_s2;
    if (s2.is_3f) score_2f3f_s1.count_3f += 1; else score_2f3f_s1.count_2f += 1;
    
    has2F3F.delete(s1.current_2f3f);
    has2F3F.delete(s2.current_2f3f);
    has2F3F.add(s2.current_2f3f);
    has2F3F.add(s1.current_2f3f);
  }
}

async function applyExchangeToDatabase(exchange: Exchange, supabase: any, sites: ClosingSiteForOptim[]) {
  if (exchange.type === '1R<->2F3F') {
    const { site_id, date, current_1r, current_2f3f, is_3f } = exchange.site1;
    const role2F3F = is_3f ? 'is_3f' : 'is_2f';
    
    await supabase
      .from('capacite_effective')
      .update({ is_1r: false, is_2f: false, is_3f: false })
      .eq('date', date)
      .eq('site_id', site_id)
      .eq('actif', true);
    
    await supabase
      .from('capacite_effective')
      .update({ [role2F3F]: true })
      .eq('date', date)
      .eq('site_id', site_id)
      .eq('secretaire_id', current_1r)
      .eq('actif', true);
    
    await supabase
      .from('capacite_effective')
      .update({ is_1r: true })
      .eq('date', date)
      .eq('site_id', site_id)
      .eq('secretaire_id', current_2f3f)
      .eq('actif', true);
    
    const site = sites.find(s => s.site_id === site_id && s.date === date);
    if (site) {
      site.current_1r = current_2f3f;
      site.current_2f3f = current_1r;
    }
    
  } else if (exchange.type === 'full_swap' && exchange.site2) {
    const s1 = exchange.site1;
    const s2 = exchange.site2;
    
    await supabase
      .from('capacite_effective')
      .update({ is_1r: false, is_2f: false, is_3f: false })
      .eq('date', s1.date)
      .eq('site_id', s1.site_id)
      .eq('actif', true);
    
    await supabase
      .from('capacite_effective')
      .update({ is_1r: true })
      .eq('date', s1.date)
      .eq('site_id', s1.site_id)
      .eq('secretaire_id', s2.current_1r)
      .eq('actif', true);
    
    const role2F3F_s1 = s1.is_3f ? 'is_3f' : 'is_2f';
    await supabase
      .from('capacite_effective')
      .update({ [role2F3F_s1]: true })
      .eq('date', s1.date)
      .eq('site_id', s1.site_id)
      .eq('secretaire_id', s2.current_2f3f)
      .eq('actif', true);
    
    await supabase
      .from('capacite_effective')
      .update({ is_1r: false, is_2f: false, is_3f: false })
      .eq('date', s2.date)
      .eq('site_id', s2.site_id)
      .eq('actif', true);
    
    await supabase
      .from('capacite_effective')
      .update({ is_1r: true })
      .eq('date', s2.date)
      .eq('site_id', s2.site_id)
      .eq('secretaire_id', s1.current_1r)
      .eq('actif', true);
    
    const role2F3F_s2 = s2.is_3f ? 'is_3f' : 'is_2f';
    await supabase
      .from('capacite_effective')
      .update({ [role2F3F_s2]: true })
      .eq('date', s2.date)
      .eq('site_id', s2.site_id)
      .eq('secretaire_id', s1.current_2f3f)
      .eq('actif', true);
    
    const site1 = sites.find(s => s.site_id === s1.site_id && s.date === s1.date);
    const site2 = sites.find(s => s.site_id === s2.site_id && s.date === s2.date);
    if (site1 && site2) {
      const temp_1r = site1.current_1r;
      const temp_2f3f = site1.current_2f3f;
      site1.current_1r = site2.current_1r;
      site1.current_2f3f = site2.current_2f3f;
      site2.current_1r = temp_1r;
      site2.current_2f3f = temp_2f3f;
    }
  }
}
