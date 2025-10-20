import type {
  SiteNeed,
  CapaciteEffective,
  WeekData,
  AssignmentSummary,
  DynamicContext
} from './types.ts';
import { ADMIN_SITE_ID } from './types.ts';
import { calculateDynamicScore } from './score-calculator.ts';

export function buildMILPModelSoft(
  date: string,
  needs: SiteNeed[],
  capacites: CapaciteEffective[],
  week_data: WeekData,
  week_assignments: AssignmentSummary[]
) {
  console.log(`🏗️ Construction du modèle MILP pour ${date}`);
  
  const model: any = {
    optimize: 'score_total',
    opType: 'max',
    constraints: {},
    variables: {},
    ints: {}
  };
  
  const todayCapacites = capacites.filter(c => c.date === date);
  
  // Dynamic context (snapshot)
  const context: DynamicContext = {
    week_assignments,
    today_assignments: new Map()
  };
  
  // ============================================================
  // VARIABLES AND COEFFICIENTS
  // ============================================================
  for (const need of needs) {
    const needId = `${need.site_id}_${need.date}_${need.periode}`;
    
    for (const cap of todayCapacites) {
      if (!cap.secretaire_id) continue;
      if (cap.demi_journee !== need.periode) continue;
      
      // Check eligibility
      const isAdminSite = need.site_id === ADMIN_SITE_ID;
      
      if (!isAdminSite) {
        const isEligible = week_data.secretaires_sites.some(
          ss => ss.secretaire_id === cap.secretaire_id && ss.site_id === need.site_id
        );
        
        // For bloc: also check secretaires_besoins_operations
        if (need.type === 'bloc_operatoire' && need.besoin_operation_id) {
          const hasCompetence = week_data.secretaires_besoins.some(
            sb => sb.secretaire_id === cap.secretaire_id && 
                  sb.besoin_operation_id === need.besoin_operation_id
          );
          if (!hasCompetence) continue;
        }
        
        if (!isEligible) continue;
      }
      
      // Binary variable
      const varName = `assign_${cap.secretaire_id}_${needId}`;
      model.ints[varName] = 1;
      
      // Calculate dynamic score
      const score = calculateDynamicScore(
        cap.secretaire_id,
        need,
        context,
        {
          besoins: week_data.secretaires_besoins,
          medecins: week_data.secretaires_medecins,
          sites: week_data.secretaires_sites
        },
        week_data.secretaires.find(s => s.id === cap.secretaire_id)!
      );
      
      // Coefficient in objective function
      model.variables[varName] = { score_total: score };
    }
  }
  
  // ============================================================
  // CONSTRAINT: Max nombre_max per need (HARD)
  // ============================================================
  for (const need of needs) {
    const needId = `${need.site_id}_${need.date}_${need.periode}`;
    model.constraints[`max_need_${needId}`] = { max: need.nombre_max };
    
    // Add all assignment variables for this need
    for (const cap of todayCapacites) {
      if (!cap.secretaire_id || cap.demi_journee !== need.periode) continue;
      
      const varName = `assign_${cap.secretaire_id}_${needId}`;
      if (model.variables[varName]) {
        model.constraints[`max_need_${needId}`][varName] = 1;
      }
    }
  }
  
  // ============================================================
  // CONSTRAINT: Max 1 assignment per secretary per half-day
  // ============================================================
  const secretairesByPeriode = new Map<string, string[]>();
  
  for (const need of needs) {
    for (const cap of todayCapacites) {
      if (!cap.secretaire_id || cap.demi_journee !== need.periode) continue;
      
      const key = `${cap.secretaire_id}_${need.periode}`;
      const varName = `assign_${cap.secretaire_id}_${need.site_id}_${need.date}_${need.periode}`;
      
      if (!model.variables[varName]) continue;
      
      if (!secretairesByPeriode.has(key)) {
        secretairesByPeriode.set(key, []);
      }
      secretairesByPeriode.get(key)!.push(varName);
    }
  }
  
  for (const [key, varNames] of secretairesByPeriode) {
    model.constraints[`max_one_${key}`] = { max: 1 };
    for (const varName of varNames) {
      model.constraints[`max_one_${key}`][varName] = 1;
    }
  }
  
  // ============================================================
  // CONSTRAINT: Closure sites = 2 full-day people
  // ============================================================
  const closureSites = week_data.sites.filter(s => s.fermeture);
  
  for (const site of closureSites) {
    const morningNeed = needs.find(
      n => n.site_id === site.id && n.date === date && n.periode === 'matin'
    );
    const afternoonNeed = needs.find(
      n => n.site_id === site.id && n.date === date && n.periode === 'apres_midi'
    );
    
    if (morningNeed && afternoonNeed && 
        morningNeed.medecins_ids.length > 0 && 
        afternoonNeed.medecins_ids.length > 0) {
      
      const fullDayVars: string[] = [];
      
      for (const cap of todayCapacites.filter(c => c.secretaire_id)) {
        const morningVar = `assign_${cap.secretaire_id}_${site.id}_${date}_matin`;
        const afternoonVar = `assign_${cap.secretaire_id}_${site.id}_${date}_apres_midi`;
        
        if (model.variables[morningVar] && model.variables[afternoonVar]) {
          const fullDayVar = `fullday_${cap.secretaire_id}_${site.id}_${date}`;
          model.ints[fullDayVar] = 1;
          model.variables[fullDayVar] = { score_total: 0 };
          
          // fullDayVar <= morningVar
          model.constraints[`fd_m_${fullDayVar}`] = { max: 0 };
          model.constraints[`fd_m_${fullDayVar}`][fullDayVar] = 1;
          model.constraints[`fd_m_${fullDayVar}`][morningVar] = -1;
          
          // fullDayVar <= afternoonVar
          model.constraints[`fd_a_${fullDayVar}`] = { max: 0 };
          model.constraints[`fd_a_${fullDayVar}`][fullDayVar] = 1;
          model.constraints[`fd_a_${fullDayVar}`][afternoonVar] = -1;
          
          // 2*fullDayVar >= morningVar + afternoonVar - 1
          model.constraints[`fd_sum_${fullDayVar}`] = { min: -1 };
          model.constraints[`fd_sum_${fullDayVar}`][fullDayVar] = -2;
          model.constraints[`fd_sum_${fullDayVar}`][morningVar] = 1;
          model.constraints[`fd_sum_${fullDayVar}`][afternoonVar] = 1;
          
          fullDayVars.push(fullDayVar);
        }
      }
      
      // Constraint: sum of fullDayVar >= 2
      if (fullDayVars.length >= 2) {
        model.constraints[`closure_${site.id}_${date}`] = { min: 2 };
        for (const fdVar of fullDayVars) {
          model.constraints[`closure_${site.id}_${date}`][fdVar] = 1;
        }
      }
    }
  }
  
  console.log(`✅ Modèle MILP construit: ${Object.keys(model.variables).length} variables, ${Object.keys(model.constraints).length} contraintes`);
  
  return model;
}
