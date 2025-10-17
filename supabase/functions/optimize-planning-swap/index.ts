import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SwapPayload {
  planning_id: string;
  selected_dates: string[];
  week_start: string;
  week_end: string;
  assignments: any[];
  blocsMap: Array<{ key: string; value: any }>;
  sites: any[];
  secretaires: any[];
  besoinsEffectifs: any[];
  secretairesSitesMap: Array<{ key: string; value: any[] }>;
  secretairesMedecinsMap: Array<{ key: string; value: any[] }>;
  capacitesMap: Array<{ key: string; value: any[] }>;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("🔄 ========== DÉBUT OPTIMISATION SWAP (6 PHASES + ADMIN EQUILIBRATING) ==========");
    
    const payload: SwapPayload = await req.json();
    const { 
      planning_id, 
      assignments, 
      blocsMap: blocsMapArray,
      sites, 
      secretaires,
      besoinsEffectifs,
      secretairesSitesMap: sitesMapArray,
      secretairesMedecinsMap: medecinsMapArray,
    } = payload;

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Reconstruire les Maps
    const blocsMap = new Map<string, any>(
      blocsMapArray.map(x => [x.key, x.value])
    );
    const secretairesSitesMap = new Map<string, any[]>(
      sitesMapArray.map(x => [x.key, x.value])
    );
    const secretairesMedecinsMap = new Map<string, any[]>(
      medecinsMapArray.map(x => [x.key, x.value])
    );
    
    console.log(`📦 ${assignments.length} assignations à optimiser`);
    console.log(`📦 ${blocsMapArray.length} opérations bloc`);
    
    // Sites constants - FIXED IDs provided by user
    const PORT_EN_TRUIE_ID = sites.find(s => s.nom.toLowerCase().includes('port'))?.id || '043899a1-a232-4c4b-9d7d-0eb44dad00ad';
    const BLOC_RESTRICTED_SITES = [
      '043899a1-a232-4c4b-9d7d-0eb44dad00ad',
      '7723c334-d06c-413d-96f0-be281d76520d'
    ];
    
    console.log(`🏥 Port-en-Truie ID: ${PORT_EN_TRUIE_ID}`);
    console.log(`🔒 BLOC Restricted Sites (Fixed IDs):`, BLOC_RESTRICTED_SITES);
    
    // Créer une copie mutable des assignations avec flag protection
    let currentAssignments = JSON.parse(JSON.stringify(assignments)).map((a: any) => ({
      ...a,
      protectedForClosure: false
    }));
    
    // ========== CONSOLIDATION PRÉSENCE BLOC ==========
    // Consolider dayBlocPresence depuis TOUTES les sources (assignments + blocsMap)
    const dayBlocPresence = new Map<string, Set<'matin' | 'apres_midi'>>();
    
    // Source 1: assignments avec type_assignation === 'bloc'
    for (const assignment of currentAssignments) {
      if (assignment.type_assignation === 'bloc' && assignment.secretaire_id) {
        const key = `${assignment.secretaire_id}|${assignment.date}`;
        if (!dayBlocPresence.has(key)) {
          dayBlocPresence.set(key, new Set());
        }
        dayBlocPresence.get(key)!.add(assignment.periode);
      }
    }
    
    // Source 2: blocsMap.personnel
    for (const [blocKey, blocData] of blocsMap.entries()) {
      const [date, periode] = blocKey.split('|');
      if (blocData.personnel && Array.isArray(blocData.personnel)) {
        for (const personnel of blocData.personnel) {
          if (personnel.secretaire_id) {
            const key = `${personnel.secretaire_id}|${date}`;
            if (!dayBlocPresence.has(key)) {
              dayBlocPresence.set(key, new Set());
            }
            dayBlocPresence.get(key)!.add(periode as 'matin' | 'apres_midi');
          }
        }
      }
    }
    
    console.log(`📊 dayBlocPresence consolidé: ${dayBlocPresence.size} entrées secrétaire/date avec présence bloc`);
    
    // Si aucune donnée bloc n'a été transmise, récupérer depuis la base pour ce planning
    if (dayBlocPresence.size === 0) {
      const { data: blocPersonnel, error: blocFetchError } = await supabase
        .from('planning_genere_personnel')
        .select('secretaire_id,date,periode,type_assignation,planning_genere_bloc_operatoire_id')
        .eq('planning_id', planning_id)
        .not('secretaire_id', 'is', null)
        .or('type_assignation.eq.bloc,planning_genere_bloc_operatoire_id.not.is.null');
      
      if (blocFetchError) {
        console.warn('⚠️ Impossible de récupérer les présences bloc depuis la base:', blocFetchError.message);
      } else if (blocPersonnel) {
        for (const row of blocPersonnel) {
          const key = `${row.secretaire_id}|${row.date}`;
          if (!dayBlocPresence.has(key)) dayBlocPresence.set(key, new Set());
          dayBlocPresence.get(key)!.add(row.periode as 'matin' | 'apres_midi');
        }
        console.log(`📥 Présences bloc récupérées depuis la base: ${blocPersonnel.length} lignes`);
      }
    }
    
    // ========== HELPERS ==========
    
    const getSecretaryName = (secId: string): string => {
      const sec = secretaires.find(s => s.id === secId);
      return sec ? `${sec.first_name || ''} ${sec.name || ''}`.trim() : secId.slice(0, 8);
    };
    
    const getSiteName = (siteId: string | null): string => {
      if (!siteId) return 'admin';
      const site = sites.find(s => s.id === siteId);
      return site?.nom || siteId.slice(0, 8);
    };
    
    const getAssignmentTypeName = (assignment: any): string => {
      if (assignment.type_assignation === 'bloc') return 'BLOC';
      if (assignment.type_assignation === 'administratif') return 'admin';
      if (assignment.type_assignation === 'site') return getSiteName(assignment.site_id);
      return assignment.type_assignation;
    };
    
    const isAssignedForPriorityDoctor = (assignment: any): boolean => {
      if (assignment.type_assignation !== 'site' || !assignment.site_id || !assignment.secretaire_id) return false;
      const medecinsOnSite = besoinsEffectifs.filter(b =>
        b.site_id === assignment.site_id &&
        b.date === assignment.date &&
        (b.demi_journee === assignment.periode || b.demi_journee === 'toute_journee') &&
        b.type === 'medecin'
      );
      for (const besoin of medecinsOnSite) {
        if (besoin.medecin_id) {
          const rel = secretairesMedecinsMap.get(`${assignment.secretaire_id}_${besoin.medecin_id}`)?.[0];
          if (rel) {
            const p = typeof rel.priorite === 'string' ? parseInt(rel.priorite, 10) : rel.priorite;
            if (p === 1 || p === 2) return true;
          }
        }
      }
      return false;
    };

    const canCandidateReplaceCurrentOnPriorityDoctors = (
      currentSecId: string,
      candidateSecId: string,
      siteAssignment: any
    ): boolean => {
      if (siteAssignment.type_assignation !== 'site' || !siteAssignment.site_id) return true;
      const medecinsOnSite = besoinsEffectifs.filter(b =>
        b.site_id === siteAssignment.site_id &&
        b.date === siteAssignment.date &&
        (b.demi_journee === siteAssignment.periode || b.demi_journee === 'toute_journee') &&
        b.type === 'medecin'
      );
      for (const besoin of medecinsOnSite) {
        if (!besoin.medecin_id) continue;
        const relCurrent = secretairesMedecinsMap.get(`${currentSecId}_${besoin.medecin_id}`)?.[0];
        if (relCurrent) {
          const pCurrent = typeof relCurrent.priorite === 'string' ? parseInt(relCurrent.priorite, 10) : relCurrent.priorite;
          if (pCurrent === 1 || pCurrent === 2) {
            const relCand = secretairesMedecinsMap.get(`${candidateSecId}_${besoin.medecin_id}`)?.[0];
            if (!relCand) return false;
            const pCand = typeof relCand.priorite === 'string' ? parseInt(relCand.priorite, 10) : relCand.priorite;
            if (pCand > 3) return false;
          }
        }
      }
      return true;
    };
    
    const canGoToSite = (secId: string, siteId: string): boolean => {
      const sitesData = secretairesSitesMap.get(secId) || [];
      return sitesData.some(s => s.site_id === siteId);
    };
    
    const hasSiteChangeForPair = (matin?: any, aprem?: any): boolean => {
      if (!matin || !aprem) return false;
      
      if (matin.type_assignation === 'site' && aprem.type_assignation === 'site') {
        return matin.site_id !== aprem.site_id;
      }
      
      if ((matin.type_assignation === 'bloc' && aprem.type_assignation === 'site') ||
          (matin.type_assignation === 'site' && aprem.type_assignation === 'bloc')) {
        return true;
      }
      
      return false;
    };
    
    const getDayAssignments = (secId: string, date: string): { matin?: any; aprem?: any } => {
      const dayAssignments = currentAssignments.filter((a: any) => 
        a.secretaire_id === secId && a.date === date
      );
      
      return {
        matin: dayAssignments.find((a: any) => a.periode === 'matin'),
        aprem: dayAssignments.find((a: any) => a.periode === 'apres_midi')
      };
    };
    
    const getAssignmentDetails = (assignment: any): string => {
      const typeName = getAssignmentTypeName(assignment);
      return `${assignment.date} ${assignment.periode} - ${typeName}`;
    };
    
    // ========== VALIDATION FUNCTIONS (updated) ==========
    
    const validatePhase1Constraint = (): boolean => {
      // Utiliser dayBlocPresence consolidé au lieu de seulement assignments
      for (const [key, periods] of dayBlocPresence.entries()) {
        const [secId, date] = key.split('|');
        
        // Pour chaque période où cette secrétaire a du bloc
        for (const blocPeriod of periods) {
          const otherPeriod = blocPeriod === 'matin' ? 'apres_midi' : 'matin';
          
          // Chercher l'assignation de l'autre période
          const otherAssignment = currentAssignments.find((a: any) =>
            a.secretaire_id === secId &&
            a.date === date &&
            a.periode === otherPeriod
          );
          
          if (otherAssignment && 
              otherAssignment.type_assignation === 'site' &&
              BLOC_RESTRICTED_SITES.includes(otherAssignment.site_id)) {
            console.error(`❌ VIOLATION Phase 1: ${getSecretaryName(secId)} le ${date} a bloc (${blocPeriod}) + site restreint (${otherPeriod}: ${getSiteName(otherAssignment.site_id)})`);
            return false;
          }
        }
      }
      return true;
    };
    
    const validatePhase2Constraint = (): boolean => {
      const sitesWithClosure = sites.filter((s: any) => s.fermeture);
      const dates = Array.from(new Set(currentAssignments.map((a: any) => a.date))) as string[];
      
      for (const site of sitesWithClosure) {
        for (const date of dates) {
          // Compter les besoins en tenant compte de 'toute_journee'
          const medecinMatin = besoinsEffectifs.filter((b: any) =>
            b.site_id === site.id && b.date === date && 
            (b.demi_journee === 'matin' || b.demi_journee === 'toute_journee') && 
            b.type === 'medecin'
          );
          const medecinAprem = besoinsEffectifs.filter((b: any) =>
            b.site_id === site.id && b.date === date && 
            (b.demi_journee === 'apres_midi' || b.demi_journee === 'toute_journee') && 
            b.type === 'medecin'
          );
          
          if (medecinMatin.length === 0 || medecinAprem.length === 0) continue;
          
          const matinSecs = new Set<string>();
          const apremSecs = new Set<string>();
          
          currentAssignments
            .filter((a: any) => a.date === date && a.site_id === site.id && a.type_assignation === 'site')
            .forEach((a: any) => {
              if (a.periode === 'matin') matinSecs.add(a.secretaire_id);
              else apremSecs.add(a.secretaire_id);
            });
          
          const fullDaySecs = Array.from(matinSecs).filter((secId: string) => apremSecs.has(secId));
          
          if (fullDaySecs.length < 2) {
            console.error(`❌ VIOLATION Phase 2: ${site.nom} le ${date} a seulement ${fullDaySecs.length} personne(s) en journée complète`);
            return false;
          }
        }
      }
      return true;
    };
    
    const wouldCreatePhase1Violation = (assignA: any, assignB: any): boolean => {
      const snapshot = currentAssignments.map((a: any) => ({ ...a }));
      
      const snapA = snapshot.find((a: any) => 
        a.secretaire_id === assignA.secretaire_id && 
        a.date === assignA.date && 
        a.periode === assignA.periode &&
        a.type_assignation === assignA.type_assignation &&
        (assignA.site_id ? a.site_id === assignA.site_id : true)
      );
      const snapB = snapshot.find((a: any) => 
        a.secretaire_id === assignB.secretaire_id && 
        a.date === assignB.date && 
        a.periode === assignB.periode &&
        a.type_assignation === assignB.type_assignation &&
        (assignB.site_id ? a.site_id === assignB.site_id : true)
      );
      
      if (!snapA || !snapB) return false;
      
      const originalA = snapA.secretaire_id;
      const originalB = snapB.secretaire_id;
      
      snapA.secretaire_id = originalB;
      snapB.secretaire_id = originalA;
      
      // Vérifier les violations en utilisant dayBlocPresence
      const isViolation = [originalA, originalB].some(secId => {
        const dates = Array.from(new Set(
          snapshot.filter((a: any) => a.secretaire_id === secId).map((a: any) => a.date)
        )) as string[];
        
        for (const date of dates) {
          const blocKey = `${secId}|${date}`;
          const blocPeriods = dayBlocPresence.get(blocKey);
          
          if (!blocPeriods) continue;
          
          for (const blocPeriod of blocPeriods) {
            const otherPeriod = blocPeriod === 'matin' ? 'apres_midi' : 'matin';
            const otherAssignment = snapshot.find((a: any) =>
              a.secretaire_id === secId && a.date === date && a.periode === otherPeriod
            );
            
            if (otherAssignment &&
                otherAssignment.type_assignation === 'site' &&
                BLOC_RESTRICTED_SITES.includes(otherAssignment.site_id)) {
              return true;
            }
          }
        }
        return false;
      });
      
      return isViolation;
    };
    
    const wouldBreakClosureConstraint = (assignA: any, assignB: any): boolean => {
      // Only care about closure sites, and ensure they still meet the constraint (>= 2 full days)
      const closingSites = new Set((sites.filter((s: any) => s.fermeture)).map((s: any) => s.id));
      const affectedPairs: Array<{ siteId: string; date: string }> = [];

      if (assignA.type_assignation === 'site' && assignA.site_id && closingSites.has(assignA.site_id)) {
        affectedPairs.push({ siteId: assignA.site_id, date: assignA.date });
      }
      if (assignB.type_assignation === 'site' && assignB.site_id && closingSites.has(assignB.site_id)) {
        affectedPairs.push({ siteId: assignB.site_id, date: assignB.date });
      }

      if (affectedPairs.length === 0) return false;

      const pairKey = (p: { siteId: string; date: string }) => `${p.siteId}|${p.date}`;
      const uniquePairs = Array.from(new Map(affectedPairs.map(p => [pairKey(p), p])).values());

      const countFullDays = (siteId: string, date: string) => {
        const matinSecs = new Set<string>();
        const apremSecs = new Set<string>();
        currentAssignments
          .filter((a: any) => a.date === date && a.site_id === siteId && a.type_assignation === 'site')
          .forEach((a: any) => {
            if (a.periode === 'matin') matinSecs.add(a.secretaire_id);
            else apremSecs.add(a.secretaire_id);
          });
        return Array.from(matinSecs).filter((secId: string) => apremSecs.has(secId)).length;
      };

      // Helper: does this site-date require closure (open matin and aprem for medecins)?
      const requiresClosure = (siteId: string, date: string) => {
        const medecinMatin = besoinsEffectifs.filter((b: any) =>
          b.site_id === siteId && b.date === date &&
          (b.demi_journee === 'matin' || b.demi_journee === 'toute_journee') &&
          b.type === 'medecin'
        );
        const medecinAprem = besoinsEffectifs.filter((b: any) =>
          b.site_id === siteId && b.date === date &&
          (b.demi_journee === 'apres_midi' || b.demi_journee === 'toute_journee') &&
          b.type === 'medecin'
        );
        return medecinMatin.length > 0 && medecinAprem.length > 0;
      };

      const originalA = assignA.secretaire_id;
      const originalB = assignB.secretaire_id;
      assignA.secretaire_id = originalB;
      assignB.secretaire_id = originalA;

      let breaks = false;
      for (const p of uniquePairs) {
        // If the site isn't open full day, the closure constraint doesn't apply
        if (!requiresClosure(p.siteId, p.date)) continue;
        const afterCount = countFullDays(p.siteId, p.date);
        if (afterCount < 2) {
          breaks = true; // would break the closure rule
          break;
        }
      }

      assignA.secretaire_id = originalA;
      assignB.secretaire_id = originalB;

      return breaks;
    };
    
    const calculateTotalScore = (): number => {
      let totalScore = 0;
      
      const secretaryMetrics = new Map<string, {
        adminCount: number;
        siteChanges: number;
        portEnTruieCount: number;
      }>();
      
      for (const sec of secretaires) {
        const secAssignments = currentAssignments.filter((a: any) => a.secretaire_id === sec.id);
        const adminCount = secAssignments.filter((a: any) => a.type_assignation === 'administratif').length;
        
        const dates = Array.from(new Set(secAssignments.map((a: any) => a.date))) as string[];
        let siteChanges = 0;
        for (const date of dates) {
          const { matin, aprem } = getDayAssignments(sec.id, date);
          if (hasSiteChangeForPair(matin, aprem)) siteChanges++;
        }
        
        const portEnTruieCount = secAssignments.filter((a: any) =>
          a.type_assignation === 'site' && a.site_id === PORT_EN_TRUIE_ID
        ).length;
        
        secretaryMetrics.set(sec.id, { adminCount, siteChanges, portEnTruieCount });
      }
      
      for (const assignment of currentAssignments) {
        if (assignment.type_assignation === 'administratif') {
          totalScore += 100;
        } else if (assignment.type_assignation === 'site' && assignment.site_id) {
          const sitesData = secretairesSitesMap.get(assignment.secretaire_id) || [];
          const siteData = sitesData.find((s) => s.site_id === assignment.site_id);
          
          if (siteData) {
            const prio = typeof siteData.priorite === 'string' 
              ? parseInt(siteData.priorite, 10) 
              : siteData.priorite;
            
            if (prio === 1) totalScore += 1200;
            else if (prio === 2) totalScore += 1100;
            else if (prio === 3) totalScore += 1000;
          }
          
          const medecinsOnSite = besoinsEffectifs.filter(b =>
            b.site_id === assignment.site_id &&
            b.date === assignment.date &&
            (b.demi_journee === assignment.periode || b.demi_journee === 'toute_journee') &&
            b.type === 'medecin'
          );
          
          for (const besoin of medecinsOnSite) {
            if (besoin.medecin_id) {
              const medRelation = secretairesMedecinsMap.get(`${assignment.secretaire_id}_${besoin.medecin_id}`)?.[0];
              if (medRelation) {
                const prio = typeof medRelation.priorite === 'string' 
                  ? parseInt(medRelation.priorite, 10) 
                  : medRelation.priorite;
                if (prio === 1) totalScore += 2000;
                else if (prio === 2) totalScore += 1500;
                else if (prio === 3) totalScore += 100;
              }
            }
          }
        }
      }
      
      for (const sec of secretaires) {
        const metrics = secretaryMetrics.get(sec.id)!;
        
        const adminCount = metrics.adminCount;
        if (adminCount === 3) totalScore -= 180;
        else if (adminCount === 4) totalScore -= 260;
        else if (adminCount === 5) totalScore -= 350;
        else if (adminCount === 6) totalScore -= 450;
        else if (adminCount === 7) totalScore -= 670;
        else if (adminCount === 8) totalScore -= 800;
        else if (adminCount >= 9) totalScore -= 1000 * (adminCount - 8);
        
        totalScore -= metrics.siteChanges * 150;
        
        if (metrics.portEnTruieCount > 2) {
          totalScore -= (metrics.portEnTruieCount - 2) * 300;
        }
      }
      
      return totalScore;
    };
    
    const getClosureSnapshot = (): Map<string, { fullDayCount: number; partialCount: number }> => {
      const snapshot = new Map<string, { fullDayCount: number; partialCount: number }>();
      const sitesWithClosure = sites.filter((s: any) => s.fermeture);
      const dates = Array.from(new Set(currentAssignments.map((a: any) => a.date))) as string[];
      
      for (const site of sitesWithClosure) {
        for (const date of dates) {
          // Compter avec 'toute_journee'
          const medecinMatin = besoinsEffectifs.filter((b: any) =>
            b.site_id === site.id && b.date === date && 
            (b.demi_journee === 'matin' || b.demi_journee === 'toute_journee') && 
            b.type === 'medecin'
          );
          const medecinAprem = besoinsEffectifs.filter((b: any) =>
            b.site_id === site.id && b.date === date && 
            (b.demi_journee === 'apres_midi' || b.demi_journee === 'toute_journee') && 
            b.type === 'medecin'
          );
          
          if (medecinMatin.length === 0 || medecinAprem.length === 0) continue;
          
          const matinSecs = new Set<string>();
          const apremSecs = new Set<string>();
          
          currentAssignments
            .filter((a: any) => a.date === date && a.site_id === site.id && a.type_assignation === 'site')
            .forEach((a: any) => {
              if (a.periode === 'matin') matinSecs.add(a.secretaire_id);
              else apremSecs.add(a.secretaire_id);
            });
          
          const fullDaySecs = Array.from(matinSecs).filter((secId: string) => apremSecs.has(secId));
          const partialSecs = new Set([...Array.from(matinSecs), ...Array.from(apremSecs)])
            .size - fullDaySecs.length;
          
          const key = `${site.id}|${date}`;
          snapshot.set(key, { fullDayCount: fullDaySecs.length, partialCount: partialSecs });
        }
      }
      
      return snapshot;
    };
    
    // ========== PHASE 1: BLOC + SITES RESTREINTS (Updated with consolidated dayBlocPresence) ==========
    
    console.log("\n🚨 ========== PHASE 1: BLOC + SITES RESTREINTS ==========");
    
    const phase1Violations: Array<{
      secId: string;
      secName: string;
      date: string;
      blocPeriod: 'matin' | 'apres_midi';
      restrictedSitePeriod: 'matin' | 'apres_midi';
      restrictedSiteId: string;
      restrictedSiteName: string;
    }> = [];
    
    // Détecter TOUTES les violations en utilisant dayBlocPresence consolidé
    for (const [key, periods] of dayBlocPresence.entries()) {
      const [secId, date] = key.split('|');
      
      for (const blocPeriod of periods) {
        const otherPeriod = blocPeriod === 'matin' ? 'apres_midi' : 'matin';
        
        const otherAssignment = currentAssignments.find((a: any) =>
          a.secretaire_id === secId &&
          a.date === date &&
          a.periode === otherPeriod
        );
        
        if (otherAssignment && 
            otherAssignment.type_assignation === 'site' &&
            BLOC_RESTRICTED_SITES.includes(otherAssignment.site_id)) {
          phase1Violations.push({
            secId,
            secName: getSecretaryName(secId),
            date,
            blocPeriod,
            restrictedSitePeriod: otherPeriod,
            restrictedSiteId: otherAssignment.site_id,
            restrictedSiteName: getSiteName(otherAssignment.site_id)
          });
        }
      }
    }
    
    if (phase1Violations.length > 0) {
      console.log(`\n🚨 ${phase1Violations.length} violation(s) Phase 1 détectée(s):`);
      for (const v of phase1Violations) {
        console.log(`  ❌ ${v.secName} le ${v.date}: ${v.blocPeriod}=BLOC + ${v.restrictedSitePeriod}=${v.restrictedSiteName}`);
      }
    } else {
      console.log("✅ Aucune violation Phase 1 détectée");
    }
    
    const phase1Swaps: Array<{
      violatedSecName: string;
      date: string;
      swappedPeriod: string;
      swappedWith: string;
      swappedType: string;
      delta: number;
    }> = [];
    
    for (const violation of phase1Violations) {
      const restrictedAssignment = currentAssignments.find((a: any) =>
        a.secretaire_id === violation.secId &&
        a.date === violation.date &&
        a.periode === violation.restrictedSitePeriod
      );
      
      if (!restrictedAssignment) continue;
      
      const isPriority = isAssignedForPriorityDoctor(restrictedAssignment);
      
      const candidatesList = currentAssignments.filter((c: any) =>
        c.secretaire_id !== violation.secId &&
        c.date === violation.date &&
        c.periode === violation.restrictedSitePeriod &&
        c.type_assignation !== 'bloc' &&
        (c.type_assignation === 'administratif' || 
         (c.type_assignation === 'site' && !BLOC_RESTRICTED_SITES.includes(c.site_id)))
      );
      
      let bestCandidate: any = null;
      let bestDelta = -Infinity;
      
      for (const candidate of candidatesList) {
        if (wouldCreatePhase1Violation(restrictedAssignment, candidate)) continue;
        if (wouldBreakClosureConstraint(restrictedAssignment, candidate)) continue;
        
        if (isPriority && !canCandidateReplaceCurrentOnPriorityDoctors(violation.secId, candidate.secretaire_id, restrictedAssignment)) {
          continue;
        }
        
        const scoreBefore = calculateTotalScore();
        
        const tempA = restrictedAssignment.secretaire_id;
        const tempB = candidate.secretaire_id;
        restrictedAssignment.secretaire_id = tempB;
        candidate.secretaire_id = tempA;
        
        const scoreAfter = calculateTotalScore();
        const delta = scoreAfter - scoreBefore;
        
        restrictedAssignment.secretaire_id = tempA;
        candidate.secretaire_id = tempB;
        
        if (delta > bestDelta) {
          bestDelta = delta;
          bestCandidate = candidate;
        }
      }
      
      if (bestCandidate) {
        const tempA = restrictedAssignment.secretaire_id;
        const tempB = bestCandidate.secretaire_id;
        restrictedAssignment.secretaire_id = tempB;
        bestCandidate.secretaire_id = tempA;
        
        phase1Swaps.push({
          violatedSecName: violation.secName,
          date: violation.date,
          swappedPeriod: violation.restrictedSitePeriod,
          swappedWith: getSecretaryName(tempA),
          swappedType: getAssignmentTypeName(bestCandidate),
          delta: bestDelta
        });
        
        console.log(`  ✅ Correction: ${violation.secName} ↔ ${getSecretaryName(tempA)} (${violation.date} ${violation.restrictedSitePeriod}), Δ=${bestDelta.toFixed(0)}`);
      } else {
        console.log(`  ⚠️ Aucun swap trouvé pour ${violation.secName} le ${violation.date} ${violation.restrictedSitePeriod}`);
      }
    }
    
    if (phase1Swaps.length > 0) {
      console.log(`\n✅ ${phase1Swaps.length} swap(s) Phase 1 appliqué(s):`);
      for (const swap of phase1Swaps) {
        console.log(`  🔄 ${swap.violatedSecName} ↔ ${swap.swappedWith} | ${swap.date} ${swap.swappedPeriod} | type=${swap.swappedType} | Δ=${swap.delta.toFixed(0)}`);
      }
    }
    
    const phase1Valid = validatePhase1Constraint();
    console.log(`\n${phase1Valid ? '✅' : '❌'} Phase 1 finale: ${phase1Valid ? 'VALIDE' : 'INVALIDE'}`);
    
    // ========== PHASE 2: FERMETURE (jour par jour avec 'toute_journee' support) ==========
    
    console.log("\n🔒 ========== PHASE 2: FERMETURE (jour par jour) ==========");
    
    const sitesWithClosure = sites.filter((s: any) => s.fermeture);
    const allDates = Array.from(new Set(currentAssignments.map((a: any) => a.date))).sort() as string[];
    
    console.log(`📋 Sites avec fermeture: ${sitesWithClosure.map((s: any) => s.nom).join(', ')}`);
    
    // État AVANT Phase 2
    console.log("\n📊 État AVANT Phase 2:");
    for (const site of sitesWithClosure) {
      for (const date of allDates) {
        const medecinMatin = besoinsEffectifs.filter((b: any) =>
          b.site_id === site.id && b.date === date && 
          (b.demi_journee === 'matin' || b.demi_journee === 'toute_journee') && 
          b.type === 'medecin'
        );
        const medecinAprem = besoinsEffectifs.filter((b: any) =>
          b.site_id === site.id && b.date === date && 
          (b.demi_journee === 'apres_midi' || b.demi_journee === 'toute_journee') && 
          b.type === 'medecin'
        );
        
        if (medecinMatin.length === 0 || medecinAprem.length === 0) {
          console.log(`  ⏭️ ${site.nom} ${date}: pas ouvert toute la journée (matin=${medecinMatin.length}, aprem=${medecinAprem.length})`);
          continue;
        }
        
        const matinSecs = new Set<string>();
        const apremSecs = new Set<string>();
        
        currentAssignments
          .filter((a: any) => a.date === date && a.site_id === site.id && a.type_assignation === 'site')
          .forEach((a: any) => {
            if (a.periode === 'matin') matinSecs.add(a.secretaire_id);
            else apremSecs.add(a.secretaire_id);
          });
        
        const fullDaySecs = Array.from(matinSecs).filter((secId: string) => apremSecs.has(secId));
        
        console.log(`  📍 ${site.nom} ${date}: ${fullDaySecs.length} journée(s) complète(s) (matin=${matinSecs.size}, aprem=${apremSecs.size})`);
      }
    }
    
    let phase2SwapsCount = 0;
    
    // Traiter jour par jour
    for (const date of allDates) {
      for (const site of sitesWithClosure) {
        const medecinMatin = besoinsEffectifs.filter((b: any) =>
          b.site_id === site.id && b.date === date && 
          (b.demi_journee === 'matin' || b.demi_journee === 'toute_journee') && 
          b.type === 'medecin'
        );
        const medecinAprem = besoinsEffectifs.filter((b: any) =>
          b.site_id === site.id && b.date === date && 
          (b.demi_journee === 'apres_midi' || b.demi_journee === 'toute_journee') && 
          b.type === 'medecin'
        );
        
        if (medecinMatin.length === 0 || medecinAprem.length === 0) continue;
        
        const matinSecs = new Set<string>();
        const apremSecs = new Set<string>();
        
        currentAssignments
          .filter((a: any) => a.date === date && a.site_id === site.id && a.type_assignation === 'site')
          .forEach((a: any) => {
            if (a.periode === 'matin') matinSecs.add(a.secretaire_id);
            else apremSecs.add(a.secretaire_id);
          });
        
        const fullDaySecs = Array.from(matinSecs).filter((secId: string) => apremSecs.has(secId));
        
        if (fullDaySecs.length >= 2) continue;
        
        console.log(`\n🎯 Optimisation: ${site.nom} ${date} (${fullDaySecs.length}/2 journées complètes)`);
        
        // Stratégie 1: Swap sur le même site
        const partialMorning = Array.from(matinSecs).filter((secId: string) => !apremSecs.has(secId));
        const partialAfternoon = Array.from(apremSecs).filter((secId: string) => !matinSecs.has(secId));
        
        console.log(`  📊 Partiels: ${partialMorning.length} matin only, ${partialAfternoon.length} aprem only`);
        
        // Tentative de swaps simples sur le même site
        for (const secId of partialMorning) {
          const missingPeriod = 'apres_midi';
          const siteCandidates = currentAssignments.filter((c: any) =>
            c.date === date &&
            c.periode === missingPeriod &&
            c.type_assignation === 'site' &&
            c.site_id === site.id &&
            c.secretaire_id !== secId
          );
          
          for (const candidate of siteCandidates) {
            const currentAssignment = currentAssignments.find((a: any) =>
              a.secretaire_id === secId && a.date === date && a.periode === missingPeriod
            );
            
            if (!currentAssignment) continue;
            
            if (wouldCreatePhase1Violation(currentAssignment, candidate)) continue;
            if (wouldBreakClosureConstraint(currentAssignment, candidate)) continue;
            
            const scoreBefore = calculateTotalScore();
            const baselineBefore = getClosureSnapshot();
            const baselineKey = `${site.id}|${date}`;
            const baselineFullDaysBefore = baselineBefore.get(baselineKey)?.fullDayCount || 0;
            
            const tempA = currentAssignment.secretaire_id;
            const tempB = candidate.secretaire_id;
            currentAssignment.secretaire_id = tempB;
            candidate.secretaire_id = tempA;
            
            const scoreAfter = calculateTotalScore();
            const baselineAfter = getClosureSnapshot();
            const baselineFullDaysAfter = baselineAfter.get(baselineKey)?.fullDayCount || 0;
            
            const delta = scoreAfter - scoreBefore;
            const improvement = baselineFullDaysAfter - baselineFullDaysBefore;
            
            currentAssignment.secretaire_id = tempA;
            candidate.secretaire_id = tempB;
            
            if (improvement > 0 && delta >= -150) {
              currentAssignment.secretaire_id = tempB;
              candidate.secretaire_id = tempA;
              
              console.log(`  ✅ Swap même site: ${getSecretaryName(tempA)} ↔ ${getSecretaryName(tempB)} (${missingPeriod}), Δ=${delta.toFixed(0)}, improvement=+${improvement}`);
              phase2SwapsCount++;
              break;
            }
          }
        }

        // Fallback: si encore <2, tenter un équilibrage inter-site contrôlé (ne casse pas la fermeture ailleurs)
        {
          const matinSecsAfter = new Set<string>();
          const apremSecsAfter = new Set<string>();
          currentAssignments
            .filter((a: any) => a.date === date && a.type_assignation === 'site' && a.site_id === site.id)
            .forEach((a: any) => {
              if (a.periode === 'matin') matinSecsAfter.add(a.secretaire_id);
              else apremSecsAfter.add(a.secretaire_id);
            });
          const fullDaySecsAfter = Array.from(matinSecsAfter).filter((secId: string) => apremSecsAfter.has(secId));
          if (fullDaySecsAfter.length < 2) {
            // Recalcule des partiels
            const partialMorning2 = Array.from(matinSecsAfter).filter((secId: string) => !apremSecsAfter.has(secId));
            const partialAfternoon2 = Array.from(apremSecsAfter).filter((secId: string) => !matinSecsAfter.has(secId));

            // 1) Donner un après-midi à ceux qui n'ont que le matin
            for (const secId of partialMorning2) {
              const missingPeriod = 'apres_midi';
              const currentAssignment = currentAssignments.find((a: any) =>
                a.secretaire_id === secId && a.date === date && a.periode === missingPeriod
              );
              if (!currentAssignment) continue;

              const interSiteCandidates = currentAssignments.filter((c: any) =>
                c.date === date &&
                c.periode === missingPeriod &&
                c.type_assignation === 'site' &&
                c.secretaire_id !== secId &&
                c.site_id !== site.id
              );

              for (const candidate of interSiteCandidates) {
                if (wouldCreatePhase1Violation(currentAssignment, candidate)) continue;
                if (wouldBreakClosureConstraint(currentAssignment, candidate)) continue;

                const scoreBefore = calculateTotalScore();
                const baselineBefore = getClosureSnapshot();
                const baselineKey = `${site.id}|${date}`;
                const before = baselineBefore.get(baselineKey)?.fullDayCount || 0;

                const tempA = currentAssignment.secretaire_id;
                const tempB = candidate.secretaire_id;
                currentAssignment.secretaire_id = tempB;
                candidate.secretaire_id = tempA;

                const scoreAfter = calculateTotalScore();
                const baselineAfter = getClosureSnapshot();
                const after = baselineAfter.get(baselineKey)?.fullDayCount || 0;

                const delta = scoreAfter - scoreBefore;
                const improvement = after - before;

                currentAssignment.secretaire_id = tempA;
                candidate.secretaire_id = tempB;

                if (improvement > 0 && delta >= -150) {
                  currentAssignment.secretaire_id = tempB;
                  candidate.secretaire_id = tempA;
                  console.log(`  ✅ Swap inter-site: ${getSecretaryName(tempA)} ↔ ${getSecretaryName(tempB)} (${missingPeriod}), Δ=${delta.toFixed(0)}, +${improvement}`);
                  phase2SwapsCount++;
                  break;
                }
              }
            }

            // 2) Donner un matin à ceux qui n'ont que l'après-midi
            for (const secId of partialAfternoon2) {
              const missingPeriod = 'matin';
              const currentAssignment = currentAssignments.find((a: any) =>
                a.secretaire_id === secId && a.date === date && a.periode === missingPeriod
              );
              if (!currentAssignment) continue;

              const interSiteCandidates = currentAssignments.filter((c: any) =>
                c.date === date &&
                c.periode === missingPeriod &&
                c.type_assignation === 'site' &&
                c.secretaire_id !== secId &&
                c.site_id !== site.id
              );

              for (const candidate of interSiteCandidates) {
                if (wouldCreatePhase1Violation(currentAssignment, candidate)) continue;
                if (wouldBreakClosureConstraint(currentAssignment, candidate)) continue;

                const scoreBefore = calculateTotalScore();
                const baselineBefore = getClosureSnapshot();
                const baselineKey = `${site.id}|${date}`;
                const before = baselineBefore.get(baselineKey)?.fullDayCount || 0;

                const tempA = currentAssignment.secretaire_id;
                const tempB = candidate.secretaire_id;
                currentAssignment.secretaire_id = tempB;
                candidate.secretaire_id = tempA;

                const scoreAfter = calculateTotalScore();
                const baselineAfter = getClosureSnapshot();
                const after = baselineAfter.get(baselineKey)?.fullDayCount || 0;

                const delta = scoreAfter - scoreBefore;
                const improvement = after - before;

                currentAssignment.secretaire_id = tempA;
                candidate.secretaire_id = tempB;

                if (improvement > 0 && delta >= -150) {
                  currentAssignment.secretaire_id = tempB;
                  candidate.secretaire_id = tempA;
                  console.log(`  ✅ Swap inter-site: ${getSecretaryName(tempA)} ↔ ${getSecretaryName(tempB)} (${missingPeriod}), Δ=${delta.toFixed(0)}, +${improvement}`);
                  phase2SwapsCount++;
                  break;
                }
              }
            }
          }
        }
      }
    }
    
    // État APRÈS Phase 2
    console.log("\n📊 État APRÈS Phase 2:");
    for (const site of sitesWithClosure) {
      for (const date of allDates) {
        const medecinMatin = besoinsEffectifs.filter((b: any) =>
          b.site_id === site.id && b.date === date && 
          (b.demi_journee === 'matin' || b.demi_journee === 'toute_journee') && 
          b.type === 'medecin'
        );
        const medecinAprem = besoinsEffectifs.filter((b: any) =>
          b.site_id === site.id && b.date === date && 
          (b.demi_journee === 'apres_midi' || b.demi_journee === 'toute_journee') && 
          b.type === 'medecin'
        );
        
        if (medecinMatin.length === 0 || medecinAprem.length === 0) continue;
        
        const matinSecs = new Set<string>();
        const apremSecs = new Set<string>();
        
        currentAssignments
          .filter((a: any) => a.date === date && a.site_id === site.id && a.type_assignation === 'site')
          .forEach((a: any) => {
            if (a.periode === 'matin') matinSecs.add(a.secretaire_id);
            else apremSecs.add(a.secretaire_id);
          });
        
        const fullDaySecs = Array.from(matinSecs).filter((secId: string) => apremSecs.has(secId));
        
        console.log(`  📍 ${site.nom} ${date}: ${fullDaySecs.length} journée(s) complète(s)`);
      }
    }
    
    console.log(`\n✅ Phase 2: ${phase2SwapsCount} swap(s) appliqué(s)`);
    
    const phase2Valid = validatePhase2Constraint();
    console.log(`${phase2Valid ? '✅' : '⚠️'} Phase 2 finale: ${phase2Valid ? 'VALIDE' : 'PARTIEL (objectif 2 journées complètes)'}`);
    
    // Marquer les assignations critiques de Phase 2 comme protégées
    for (const site of sitesWithClosure) {
      for (const date of allDates) {
        const matinSecs = new Set<string>();
        const apremSecs = new Set<string>();
        
        currentAssignments
          .filter((a: any) => a.date === date && a.site_id === site.id && a.type_assignation === 'site')
          .forEach((a: any) => {
            if (a.periode === 'matin') matinSecs.add(a.secretaire_id);
            else apremSecs.add(a.secretaire_id);
          });
        
        const fullDaySecs = Array.from(matinSecs).filter((secId: string) => apremSecs.has(secId));
        
        // Protéger les assignations des secrétaires en journée complète
        for (const secId of fullDaySecs) {
          currentAssignments
            .filter((a: any) => 
              a.secretaire_id === secId && 
              a.date === date && 
              a.site_id === site.id && 
              a.type_assignation === 'site'
            )
            .forEach((a: any) => {
              a.protectedForClosure = true;
            });
        }
      }
    }
    
    console.log(`🔒 ${currentAssignments.filter((a: any) => a.protectedForClosure).length} assignations protégées pour fermeture`);
    
    // ========== PHASE 3: PRÉFÉRENCE ADMIN ==========
    
    console.log("\n📋 ========== PHASE 3: PRÉFÉRENCE ADMIN ==========");
    
    let phase3SwapsCount = 0;
    const preferredAdminSecs = secretaires.filter((s: any) => s.prefered_admin);
    
    for (const sec of preferredAdminSecs) {
      const secAssignments = currentAssignments.filter((a: any) => a.secretaire_id === sec.id);
      const adminCount = secAssignments.filter((a: any) => a.type_assignation === 'administratif').length;
      
      if (adminCount >= 2) continue;
      
      const nonAdminAssignments = secAssignments.filter((a: any) => a.type_assignation !== 'administratif');
      
      for (const nonAdmin of nonAdminAssignments) {
        const adminCandidates = currentAssignments.filter((c: any) =>
          c.date === nonAdmin.date &&
          c.periode === nonAdmin.periode &&
          c.type_assignation === 'administratif' &&
          c.secretaire_id !== sec.id
        );
        
        let bestCandidate: any = null;
        let bestDelta = -Infinity;
        
            for (const candidate of adminCandidates) {
              if (wouldCreatePhase1Violation(nonAdmin, candidate)) continue;
              if (wouldBreakClosureConstraint(nonAdmin, candidate)) continue;
              
              // Ne pas toucher aux assignations protégées Phase 2
              if (nonAdmin.protectedForClosure || candidate.protectedForClosure) continue;
              
              const scoreBefore = calculateTotalScore();
              
              // Pénalité -4000 pour changement de site dans la même journée
              let siteChangePenalty = 0;
              const { matin: nonAdminMatin, aprem: nonAdminAprem } = getDayAssignments(sec.id, nonAdmin.date);
              
              if (nonAdmin.periode === 'matin' && nonAdminAprem) {
                if (nonAdminAprem.type_assignation === 'site' && candidate.site_id !== nonAdminAprem.site_id) {
                  siteChangePenalty -= 4000;
                }
              } else if (nonAdmin.periode === 'apres_midi' && nonAdminMatin) {
                if (nonAdminMatin.type_assignation === 'site' && candidate.site_id !== nonAdminMatin.site_id) {
                  siteChangePenalty -= 4000;
                }
              }
              
              const tempA = nonAdmin.secretaire_id;
              const tempB = candidate.secretaire_id;
              nonAdmin.secretaire_id = tempB;
              candidate.secretaire_id = tempA;
              
              // Vérification globale: ne pas casser Phase 2
              const closureOK = validatePhase2Constraint();
              
              const scoreAfter = calculateTotalScore();
              const baseDelta = scoreAfter - scoreBefore;
              const delta = (closureOK ? baseDelta : -Infinity) + siteChangePenalty;
              
              nonAdmin.secretaire_id = tempA;
              candidate.secretaire_id = tempB;
              
              if (delta > bestDelta) {
                bestDelta = delta;
                bestCandidate = candidate;
              }
            }
        
        if (bestCandidate && bestDelta >= -150) {
          const tempA = nonAdmin.secretaire_id;
          const tempB = bestCandidate.secretaire_id;
          nonAdmin.secretaire_id = tempB;
          bestCandidate.secretaire_id = tempA;
          
          phase3SwapsCount++;
          
          const secAdminCount = currentAssignments.filter((a: any) => 
            a.secretaire_id === sec.id && a.type_assignation === 'administratif'
          ).length;
          
          if (secAdminCount >= 2) break;
        }
      }
    }
    
    console.log(`✅ Phase 3: ${phase3SwapsCount} swap(s) pour préférence admin`);
    
    // Phases 4-6 et équilibrage admin désactivés pour éviter les changements de site inutiles
    const phase4SwapsCount = 0;
    const phase5SwapsCount = 0;
    const phase6SwapsCount = 0;
    const adminPhaseSwapsCount = 0;

    
    console.log("\n🔍 ========== VALIDATION FINALE ==========");
    
    const finalPhase1Valid = validatePhase1Constraint();
    const finalPhase2Valid = validatePhase2Constraint();
    
    console.log(`Phase 1 (Bloc + Sites restreints): ${finalPhase1Valid ? '✅ VALIDE' : '❌ INVALIDE'}`);
    console.log(`Phase 2 (Fermeture): ${finalPhase2Valid ? '✅ VALIDE' : '⚠️ PARTIEL'}`);
    
    if (!finalPhase1Valid) {
      throw new Error("ERREUR CRITIQUE: Phase 1 invalide après toutes les phases. Abandon.");
    }
    
    // Si Phase 2 est invalide, afficher les violations détaillées
    if (!finalPhase2Valid) {
      console.log("\n⚠️ VIOLATIONS PHASE 2 PERSISTANTES:");
      for (const site of sitesWithClosure) {
        for (const date of allDates) {
          const medecinMatin = besoinsEffectifs.filter((b: any) =>
            b.site_id === site.id && b.date === date && 
            (b.demi_journee === 'matin' || b.demi_journee === 'toute_journee') && 
            b.type === 'medecin'
          );
          const medecinAprem = besoinsEffectifs.filter((b: any) =>
            b.site_id === site.id && b.date === date && 
            (b.demi_journee === 'apres_midi' || b.demi_journee === 'toute_journee') && 
            b.type === 'medecin'
          );
          
          if (medecinMatin.length === 0 || medecinAprem.length === 0) continue;
          
          const matinSecs = new Set<string>();
          const apremSecs = new Set<string>();
          
          currentAssignments
            .filter((a: any) => a.date === date && a.site_id === site.id && a.type_assignation === 'site')
            .forEach((a: any) => {
              if (a.periode === 'matin') matinSecs.add(a.secretaire_id);
              else apremSecs.add(a.secretaire_id);
            });
          
          const fullDaySecs = Array.from(matinSecs).filter((secId: string) => apremSecs.has(secId));
          
          if (fullDaySecs.length < 2) {
            console.log(`  ❌ ${site.nom} ${date}: ${fullDaySecs.length}/2 journées complètes`);
          }
        }
      }
    }
    
    const finalScore = calculateTotalScore();
    console.log(`\n📊 Score final: ${finalScore}`);
    
    // ========== PERSISTENCE ==========
    
    console.log("\n💾 ========== PERSISTENCE ==========");
    
    const { error: deleteError } = await supabase
      .from('planning_genere_personnel')
      .delete()
      .eq('planning_id', planning_id)
      .in('type_assignation', ['site','administratif']);
    
    if (deleteError) throw deleteError;
    
    const recordsToInsert = currentAssignments
      .filter((a: any) => a.type_assignation === 'site' || a.type_assignation === 'administratif')
      .map((a: any) => ({
        planning_id,
        date: a.date,
        periode: a.periode,
        secretaire_id: a.secretaire_id,
        site_id: a.site_id || null,
        type_assignation: a.type_assignation,
        planning_genere_bloc_operatoire_id: a.planning_genere_bloc_operatoire_id || null,
        besoin_operation_id: a.besoin_operation_id || null,
        ordre: a.ordre || 1,
        is_1r: false,
        is_2f: false,
        is_3f: false
      }));
    
    const { error: insertError } = await supabase
      .from('planning_genere_personnel')
      .insert(recordsToInsert);
    
    if (insertError) throw insertError;
    
    console.log(`✅ ${recordsToInsert.length} assignations (site/admin) insérées — lignes bloc préservées`);
    
    console.log("\n✅ ========== FIN OPTIMISATION SWAP ==========");
    
    return new Response(
      JSON.stringify({
        success: true,
        message: "Optimisation swap terminée avec succès",
        stats: {
          phase1_swaps: phase1Swaps.length,
          phase2_swaps: phase2SwapsCount,
          phase3_swaps: phase3SwapsCount,
          phase4_swaps: phase4SwapsCount,
          phase5_swaps: phase5SwapsCount,
          phase6_swaps: phase6SwapsCount,
          admin_equilibrating_swaps: adminPhaseSwapsCount,
          total_swaps: phase1Swaps.length + phase2SwapsCount + phase3SwapsCount + phase4SwapsCount + phase5SwapsCount + phase6SwapsCount + adminPhaseSwapsCount,
          final_score: finalScore,
          phase1_valid: finalPhase1Valid,
          phase2_valid: finalPhase2Valid
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error: any) {
    console.error("❌ Erreur:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
