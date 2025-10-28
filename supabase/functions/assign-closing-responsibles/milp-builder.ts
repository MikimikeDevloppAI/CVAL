// MILP Model Builder for Closing Responsibles Assignment
// Guarantees optimal assignment with hard constraint: no secretary gets 2F/3F twice in a week

export interface ClosingSite {
  site_id: string;
  site_nom: string;
  date: string;
  needs_2f: boolean;
  needs_3f: boolean;
  current_1r?: string;
  current_2f?: string;
  current_3f?: string;
  total_secretaries: number;
}

export interface SecretaryForMILP {
  id: string;
  name: string;
  current_week_assignments: {
    count_1r: number;
    count_2f: number;
    count_3f: number;
  };
}

interface SecretaryScoreInternal {
  id: string;
  name: string;
  score: number;
  count_1r: number;
  count_2f: number;
  count_3f: number;
}

// Scoring weights
const CONTINUITY_BONUS = 50;
const OVERLOAD_PENALTY_BASE = 100;
const LIGHT_PENALTY_2_ASSIGN = 10;
const DOUBLE_2F_PENALTY = 1000;

export function buildClosingMILPModel(
  sites: ClosingSite[],
  secretaries: SecretaryForMILP[],
  weekScores: Map<string, any> // Accept any to be flexible with the calling code
) {
  console.log('🔨 Building MILP model...');
  
  const model: any = {
    optimize: 'objective',
    opType: 'max',
    constraints: {},
    variables: {},
    binaries: {}
  };

  // ============================================================
  // GENERATE VARIABLES
  // ============================================================
  
  let varCount = 0;
  
  for (const site of sites) {
    for (const sec of secretaries) {
      // Variable pour 1R
      const var1R = `x_${sec.id}_${site.date}_${site.site_id}_1R`;
      const score1R = calculateAssignmentScore(sec, site, '1R', weekScores);
      
      model.variables[var1R] = { objective: score1R };
      model.binaries[var1R] = 1;
      varCount++;
      
      // Variable pour 2F (si nécessaire)
      if (site.needs_2f) {
        const var2F = `x_${sec.id}_${site.date}_${site.site_id}_2F`;
        const score2F = calculateAssignmentScore(sec, site, '2F', weekScores);
        
        model.variables[var2F] = { objective: score2F };
        model.binaries[var2F] = 1;
        varCount++;
      }
      
      // Variable pour 3F (si nécessaire)
      if (site.needs_3f) {
        const var3F = `x_${sec.id}_${site.date}_${site.site_id}_3F`;
        const score3F = calculateAssignmentScore(sec, site, '3F', weekScores);
        
        model.variables[var3F] = { objective: score3F };
        model.binaries[var3F] = 1;
        varCount++;
      }
    }
  }
  
  console.log(`   ✓ ${varCount} variables créées`);
  
  // ============================================================
  // CONSTRAINT C1: Un seul rôle par secrétaire par jour
  // ============================================================
  
  const datesSet = new Set(sites.map(s => s.date));
  let c1Count = 0;
  
  for (const sec of secretaries) {
    for (const date of datesSet) {
      const constraintName = `one_role_${sec.id}_${date}`;
      model.constraints[constraintName] = { max: 1 };
      
      for (const site of sites.filter(s => s.date === date)) {
        const var1R = `x_${sec.id}_${site.date}_${site.site_id}_1R`;
        if (!model.variables[var1R][constraintName]) {
          model.variables[var1R][constraintName] = 1;
        }
        
        if (site.needs_2f) {
          const var2F = `x_${sec.id}_${site.date}_${site.site_id}_2F`;
          if (!model.variables[var2F][constraintName]) {
            model.variables[var2F][constraintName] = 1;
          }
        }
        
        if (site.needs_3f) {
          const var3F = `x_${sec.id}_${site.date}_${site.site_id}_3F`;
          if (!model.variables[var3F][constraintName]) {
            model.variables[var3F][constraintName] = 1;
          }
        }
      }
      c1Count++;
    }
  }
  
  console.log(`   ✓ ${c1Count} contraintes "un rôle/jour/secrétaire"`);
  
  // ============================================================
  // CONSTRAINT C2-C4: Un responsable par site par jour
  // ============================================================
  
  let c2c4Count = 0;
  
  for (const site of sites) {
    // C2: Un seul 1R
    const c1R = `one_1R_${site.date}_${site.site_id}`;
    model.constraints[c1R] = { equal: 1 };
    
    for (const sec of secretaries) {
      const var1R = `x_${sec.id}_${site.date}_${site.site_id}_1R`;
      if (!model.variables[var1R][c1R]) {
        model.variables[var1R][c1R] = 1;
      }
    }
    c2c4Count++;
    
    // C3: Un seul 2F (si nécessaire)
    if (site.needs_2f) {
      const c2F = `one_2F_${site.date}_${site.site_id}`;
      model.constraints[c2F] = { equal: 1 };
      
      for (const sec of secretaries) {
        const var2F = `x_${sec.id}_${site.date}_${site.site_id}_2F`;
        if (!model.variables[var2F][c2F]) {
          model.variables[var2F][c2F] = 1;
        }
      }
      c2c4Count++;
    }
    
    // C4: Un seul 3F (si nécessaire)
    if (site.needs_3f) {
      const c3F = `one_3F_${site.date}_${site.site_id}`;
      model.constraints[c3F] = { equal: 1 };
      
      for (const sec of secretaries) {
        const var3F = `x_${sec.id}_${site.date}_${site.site_id}_3F`;
        if (!model.variables[var3F][c3F]) {
          model.variables[var3F][c3F] = 1;
        }
      }
      c2c4Count++;
    }
  }
  
  console.log(`   ✓ ${c2c4Count} contraintes "un responsable/site/jour"`);
  
  // ============================================================
  // CONSTRAINT C5: Pas de 2F/3F deux fois dans la semaine (PRIORITAIRE)
  // ============================================================
  
  let c5Count = 0;
  
  for (const sec of secretaries) {
    const constraintName = `no_double_2F_${sec.id}`;
    model.constraints[constraintName] = { max: 1 };
    
    for (const site of sites) {
      if (site.needs_2f) {
        const var2F = `x_${sec.id}_${site.date}_${site.site_id}_2F`;
        if (!model.variables[var2F][constraintName]) {
          model.variables[var2F][constraintName] = 1;
        }
      }
      
      if (site.needs_3f) {
        const var3F = `x_${sec.id}_${site.date}_${site.site_id}_3F`;
        if (!model.variables[var3F][constraintName]) {
          model.variables[var3F][constraintName] = 1;
        }
      }
    }
    c5Count++;
  }
  
  console.log(`   ✓ ${c5Count} contraintes "max 1×2F/3F par secrétaire" (CRITIQUE)`);
  
  return { model, variables: model.variables };
}

function calculateAssignmentScore(
  sec: SecretaryForMILP,
  site: ClosingSite,
  role: '1R' | '2F' | '3F',
  weekScores: Map<string, any> // Accept any to be flexible
): number {
  let score = 0;
  
  // Base score selon le rôle (pour équilibrer)
  const baseScores = { '1R': 1, '2F': 2, '3F': 3 };
  score += baseScores[role];
  
  // Bonus de continuité (+50 si c'était déjà cette personne)
  const currentRole = role === '1R' ? site.current_1r :
                      role === '2F' ? site.current_2f :
                      site.current_3f;
  
  if (currentRole === sec.id) {
    score += CONTINUITY_BONUS;
  }
  
  // Pénalité si la secrétaire a déjà beaucoup d'assignations
  const weekScore = weekScores.get(sec.id);
  if (weekScore) {
    const totalAssignments = weekScore.count_1r + weekScore.count_2f + weekScore.count_3f;
    
    // Pénalité exponentielle si ≥3 assignations
    if (totalAssignments >= 3) {
      const overload = totalAssignments - 2;
      score -= overload * OVERLOAD_PENALTY_BASE;
    } else if (totalAssignments === 2) {
      score -= LIGHT_PENALTY_2_ASSIGN;
    }
    
    // Pénalité supplémentaire si la secrétaire a déjà un 2F/3F et on lui assigne un autre
    if ((role === '2F' || role === '3F') && (weekScore.count_2f > 0 || weekScore.count_3f > 0)) {
      score -= DOUBLE_2F_PENALTY; // Pénalité massive (devrait être bloqué par C5, mais au cas où)
    }
  }
  
  return score;
}
