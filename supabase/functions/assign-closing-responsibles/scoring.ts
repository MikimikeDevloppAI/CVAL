export interface SecretaryScore {
  id: string;
  name: string;
  score: number;
  count_1r: number;
  count_2f: number;
  count_3f: number;
}

export interface SecretaryPenalizedScore {
  id: string;
  name: string;
  base_score: number;
  count_1r: number;
  count_2f: number;
  count_3f: number;
  
  penalty_multiple_2f3f: number;
  penalty_overload: number;
  
  total_score: number;
  squared_score: number;
}

export interface GlobalOptimizationMetrics {
  sum_squared_scores: number;
  count_over_3: number;
  max_score: number;
  stddev: number;
  total_penalty: number;
}

export function calculatePenalizedScore(sec: SecretaryScore): SecretaryPenalizedScore {
  const base_score = (sec.count_1r * 1) + (sec.count_2f * 2) + (sec.count_3f * 3);
  
  const total_2f3f = sec.count_2f + sec.count_3f;
  const total_assignments = sec.count_1r + sec.count_2f + sec.count_3f;
  
  const penalty_multiple_2f3f = total_2f3f >= 2 ? (total_2f3f - 1) * 10 : 0;
  const penalty_overload = total_assignments >= 3 ? (total_assignments - 2) * 5 : 0;
  
  const total_score = base_score + penalty_multiple_2f3f + penalty_overload;
  
  const squared_score = total_score * total_score;
  
  return {
    id: sec.id,
    name: sec.name,
    base_score,
    count_1r: sec.count_1r,
    count_2f: sec.count_2f,
    count_3f: sec.count_3f,
    penalty_multiple_2f3f,
    penalty_overload,
    total_score,
    squared_score
  };
}

export function calculateGlobalMetrics(scores: Map<string, SecretaryScore>): GlobalOptimizationMetrics {
  const penalizedScores = Array.from(scores.values()).map(calculatePenalizedScore);
  
  const sum_squared_scores = penalizedScores.reduce((sum, s) => sum + s.squared_score, 0);
  const count_over_3 = penalizedScores.filter(s => s.total_score > 3).length;
  
  const scores_array = penalizedScores.map(s => s.total_score);
  const mean = scores_array.length > 0 ? scores_array.reduce((a, b) => a + b, 0) / scores_array.length : 0;
  const variance = scores_array.length > 0 
    ? scores_array.reduce((sum, score) => sum + Math.pow(score - mean, 2), 0) / scores_array.length 
    : 0;
  const stddev = Math.sqrt(variance);
  
  const max_score = scores_array.length > 0 ? Math.max(...scores_array) : 0;
  
  const total_penalty = penalizedScores.reduce(
    (sum, s) => sum + s.penalty_multiple_2f3f + s.penalty_overload, 
    0
  );
  
  return {
    sum_squared_scores,
    count_over_3,
    max_score,
    stddev,
    total_penalty
  };
}

export function isMetricsBetter(
  newMetrics: GlobalOptimizationMetrics,
  currentMetrics: GlobalOptimizationMetrics
): boolean {
  return newMetrics.sum_squared_scores < currentMetrics.sum_squared_scores;
}

export function cloneScores(scores: Map<string, SecretaryScore>): Map<string, SecretaryScore> {
  const cloned = new Map<string, SecretaryScore>();
  for (const [key, value] of scores) {
    cloned.set(key, { ...value });
  }
  return cloned;
}
