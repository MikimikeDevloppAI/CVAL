import { CreneauBesoin, CreneauCapacite, AssignmentResult, OptimizationResult } from '@/types/planning';

interface Assignment {
  besoin: CreneauBesoin;
  capacites: CreneauCapacite[];
}

const CENTRE_ESPLANADE_SITE = 'Centre Esplanade - Ophtalmologie';

export function optimizePlanning(
  besoins: CreneauBesoin[],
  capacites: CreneauCapacite[]
): OptimizationResult {
  // Phase 1: Maximize basic satisfaction
  const assignments = phase1BasicSatisfaction(besoins, capacites);
  
  // Phase 2: Minimize penalties
  const optimizedAssignments = phase2MinimizePenalties(assignments, besoins);
  
  // Calculate scores
  const scoreBase = calculateBaseScore(optimizedAssignments);
  const penalites = calculatePenalties(optimizedAssignments);
  
  // Calculate stats
  const assignmentResults = convertToAssignmentResults(optimizedAssignments);
  const stats = {
    satisfait: assignmentResults.filter(a => a.status === 'satisfait').length,
    partiel: assignmentResults.filter(a => a.status === 'arrondi_inferieur').length,
    non_satisfait: assignmentResults.filter(a => a.status === 'non_satisfait').length,
  };
  
  return {
    assignments: assignmentResults,
    stats,
    score_base: scoreBase,
    penalites,
    score_total: scoreBase - (penalites.changement_site + penalites.multiple_fermetures + penalites.centre_esplanade_depassement),
  };
}

function phase1BasicSatisfaction(
  besoins: CreneauBesoin[],
  capacites: CreneauCapacite[]
): Assignment[] {
  const assignments: Assignment[] = [];
  const usedCapacites = new Set<string>();
  
  // Sort by priority: Bloc > Fermeture > Others
  const sortedBesoins = [...besoins].sort((a, b) => {
    if (a.type === 'bloc_operatoire' && b.type !== 'bloc_operatoire') return -1;
    if (a.type !== 'bloc_operatoire' && b.type === 'bloc_operatoire') return 1;
    if (a.site_fermeture && !b.site_fermeture) return -1;
    if (!a.site_fermeture && b.site_fermeture) return 1;
    return 0;
  });
  
  for (const besoin of sortedBesoins) {
    const matchingCapacites = capacites.filter(cap => 
      !usedCapacites.has(cap.id) &&
      cap.date === besoin.date &&
      cap.periode === besoin.periode &&
      cap.specialites.includes(besoin.specialite_id)
    );
    
    const nombreRequis = Math.ceil(besoin.nombre_secretaires_requis);
    let assignedCapacites: CreneauCapacite[] = [];
    
    // For fermeture sites, ensure 1R and 2F
    if (besoin.site_fermeture) {
      const capacites1R = matchingCapacites.filter(c => !c.backup_id);
      const capacites2F = matchingCapacites.filter(c => c.backup_id);
      
      if (capacites1R.length > 0 && capacites2F.length > 0) {
        assignedCapacites.push(capacites1R[0]);
        assignedCapacites.push(capacites2F[0]);
        usedCapacites.add(capacites1R[0].id);
        usedCapacites.add(capacites2F[0].id);
        
        // Add more if needed
        const remaining = nombreRequis - 2;
        for (let i = 0; i < remaining; i++) {
          const nextCap = matchingCapacites.find(c => !usedCapacites.has(c.id));
          if (nextCap) {
            assignedCapacites.push(nextCap);
            usedCapacites.add(nextCap.id);
          }
        }
      }
    } else {
      // Regular assignment
      for (let i = 0; i < nombreRequis && i < matchingCapacites.length; i++) {
        if (!usedCapacites.has(matchingCapacites[i].id)) {
          assignedCapacites.push(matchingCapacites[i]);
          usedCapacites.add(matchingCapacites[i].id);
        }
      }
    }
    
    assignments.push({
      besoin,
      capacites: assignedCapacites,
    });
  }
  
  return assignments;
}

function phase2MinimizePenalties(
  assignments: Assignment[],
  allBesoins: CreneauBesoin[]
): Assignment[] {
  // Try to swap assignments to minimize penalties
  let optimized = [...assignments];
  let improved = true;
  
  while (improved) {
    improved = false;
    const currentPenalties = calculatePenaltiesFromAssignments(optimized);
    
    // Try swapping capacites between assignments
    for (let i = 0; i < optimized.length; i++) {
      for (let j = i + 1; j < optimized.length; j++) {
        if (canSwap(optimized[i], optimized[j])) {
          const swapped = trySwap(optimized, i, j);
          const newPenalties = calculatePenaltiesFromAssignments(swapped);
          
          if (getTotalPenalty(newPenalties) < getTotalPenalty(currentPenalties)) {
            optimized = swapped;
            improved = true;
            break;
          }
        }
      }
      if (improved) break;
    }
  }
  
  return optimized;
}

function canSwap(a1: Assignment, a2: Assignment): boolean {
  // Same date and different periods
  return a1.besoin.date === a2.besoin.date && a1.besoin.periode !== a2.besoin.periode;
}

function trySwap(assignments: Assignment[], i: number, j: number): Assignment[] {
  const result = [...assignments];
  // Try swapping first capacite of each
  if (result[i].capacites.length > 0 && result[j].capacites.length > 0) {
    const temp = result[i].capacites[0];
    result[i].capacites[0] = result[j].capacites[0];
    result[j].capacites[0] = temp;
  }
  return result;
}

function calculateBaseScore(assignments: Assignment[]): number {
  let score = 0;
  for (const assignment of assignments) {
    const required = Math.ceil(assignment.besoin.nombre_secretaires_requis);
    const assigned = assignment.capacites.length;
    score += Math.min(assigned, required) / required;
  }
  return score;
}

function calculatePenaltiesFromAssignments(assignments: Assignment[]) {
  const capaciteUsage = new Map<string, { sites: Set<string>, dates: Set<string>, fermetures: number }>();
  
  for (const assignment of assignments) {
    for (const cap of assignment.capacites) {
      const key = cap.secretaire_id || cap.backup_id || '';
      if (!capaciteUsage.has(key)) {
        capaciteUsage.set(key, { sites: new Set(), dates: new Set(), fermetures: 0 });
      }
      const usage = capaciteUsage.get(key)!;
      usage.sites.add(assignment.besoin.site_id);
      usage.dates.add(assignment.besoin.date);
      if (assignment.besoin.site_fermeture) {
        usage.fermetures++;
      }
    }
  }
  
  let changementSite = 0;
  let multipleFermetures = 0;
  let centreEsplanadeDepassement = 0;
  
  // Check for site changes between morning and afternoon
  const secretairesBySite = new Map<string, Map<string, { matin?: string, apresMidi?: string }>>();
  
  for (const assignment of assignments) {
    for (const cap of assignment.capacites) {
      const key = cap.secretaire_id || cap.backup_id || '';
      if (!secretairesBySite.has(cap.date)) {
        secretairesBySite.set(cap.date, new Map());
      }
      const dayMap = secretairesBySite.get(cap.date)!;
      if (!dayMap.has(key)) {
        dayMap.set(key, {});
      }
      const periods = dayMap.get(key)!;
      if (cap.periode === 'matin') {
        periods.matin = assignment.besoin.site_id;
      } else {
        periods.apresMidi = assignment.besoin.site_id;
      }
    }
  }
  
  // Count site changes
  for (const [date, dayMap] of secretairesBySite) {
    for (const [secretaire, periods] of dayMap) {
      if (periods.matin && periods.apresMidi && periods.matin !== periods.apresMidi) {
        changementSite += 0.8;
      }
    }
  }
  
  // Count multiple fermetures
  for (const [secretaire, usage] of capaciteUsage) {
    if (usage.fermetures > 2) {
      multipleFermetures += (usage.fermetures - 2) * 0.6;
    }
  }
  
  // Check Centre Esplanade usage
  for (const assignment of assignments) {
    if (assignment.besoin.site_nom.includes(CENTRE_ESPLANADE_SITE)) {
      for (const cap of assignment.capacites) {
        const key = cap.secretaire_id || cap.backup_id || '';
        const usage = capaciteUsage.get(key);
        if (usage && usage.dates.size > 1) {
          centreEsplanadeDepassement += 0.5;
        }
      }
    }
  }
  
  return {
    changement_site: changementSite,
    multiple_fermetures: multipleFermetures,
    centre_esplanade_depassement: centreEsplanadeDepassement,
  };
}

function calculatePenalties(assignments: Assignment[]) {
  return calculatePenaltiesFromAssignments(assignments);
}

function getTotalPenalty(penalties: { changement_site: number, multiple_fermetures: number, centre_esplanade_depassement: number }): number {
  return penalties.changement_site + penalties.multiple_fermetures + penalties.centre_esplanade_depassement;
}

function convertToAssignmentResults(assignments: Assignment[]): AssignmentResult[] {
  return assignments.map(assignment => {
    const nombreRequis = Math.ceil(assignment.besoin.nombre_secretaires_requis);
    const nombreAssigne = assignment.capacites.length;
    
    let status: 'satisfait' | 'arrondi_inferieur' | 'non_satisfait';
    if (nombreAssigne >= nombreRequis) {
      status = 'satisfait';
    } else if (nombreAssigne >= Math.floor(assignment.besoin.nombre_secretaires_requis)) {
      status = 'arrondi_inferieur';
    } else {
      status = 'non_satisfait';
    }
    
    return {
      creneau_besoin_id: assignment.besoin.id,
      date: assignment.besoin.date,
      periode: assignment.besoin.periode,
      site_id: assignment.besoin.site_id,
      site_nom: assignment.besoin.site_nom,
      site_fermeture: assignment.besoin.site_fermeture,
      medecins: assignment.besoin.medecin_noms?.length > 0 ? assignment.besoin.medecin_noms : ['Bloc opératoire'],
      secretaires: assignment.capacites.map(c => ({
        id: c.secretaire_id || c.backup_id || '',
        nom: c.nom_complet,
        is_backup: !!c.backup_id,
        is_1r: false,
        is_2f: false,
      })),
      nombre_requis: nombreRequis,
      nombre_assigne: nombreAssigne,
      status,
    };
  });
}
